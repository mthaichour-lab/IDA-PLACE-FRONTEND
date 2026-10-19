'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Column, Table } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { TranslationKey } from '@/i18n/translations';
import { apiGet, apiPost } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { formatIsoDay } from '@/lib/iso-date';
import { IrsamBenchmark, IrsamIndicator } from '@/lib/types';
import { apiErrorMessage, FormStack, Hint, LabeledInput, LabeledSelect, PrimaryButton, QueryState, RowAction, RowActions } from './fields';
import { ValidationTag } from './ValidationTag';

const PAGE_SIZE = 6; // pagination fixe 6/p — A.5

const INDICATOR_LABELS: Record<IrsamIndicator, TranslationKey> = {
  DELAI_MOYEN_REGLEMENT_RECOURS_JOURS: 'referential.irsam.indicator.DELAI_MOYEN_REGLEMENT_RECOURS_JOURS',
};

interface IrsamForm {
  indicator: IrsamIndicator;
  value: string;
  periodFrom: string;
  periodTo: string;
  startEvent: string;
  endEvent: string;
  scope: string;
  sourceRef: string;
}

const EMPTY_FORM: IrsamForm = {
  indicator: 'DELAI_MOYEN_REGLEMENT_RECOURS_JOURS',
  value: '',
  periodFrom: '',
  periodTo: '',
  startEvent: '',
  endEvent: '',
  scope: '',
  sourceRef: '',
};

/**
 * « Référence IRSAM » (écran 12), décision PO §4 : saisie avec sa définition
 * de mesure (statut SAISI), validation UAR (quatre yeux) puis archivage.
 * Rien n'est pré-rempli ; seule une référence validée est comparée à l'écran 11.
 */
export function IrsamSection() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const { hasPrivilege } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = hasPrivilege('params');
  const canValidate = hasPrivilege('validateRef');

  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<IrsamForm>(EMPTY_FORM);

  const listQuery = useQuery({
    queryKey: ['referential', 'irsam-benchmarks'],
    queryFn: () => apiGet<IrsamBenchmark[]>('/referential/irsam-benchmarks'),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['referential', 'irsam-benchmarks'] });
    void queryClient.invalidateQueries({ queryKey: ['stats', 'summary'] });
  };
  const onError = (err: unknown) => toast(apiErrorMessage(err, t('referential.toast.error')), 'ko');

  const create = useMutation({
    mutationFn: (f: IrsamForm) =>
      apiPost<IrsamBenchmark>('/referential/irsam-benchmarks', {
        indicator: f.indicator,
        value: Number(f.value),
        periodFrom: f.periodFrom,
        periodTo: f.periodTo,
        measureDefinition: { startEvent: f.startEvent.trim(), endEvent: f.endEvent.trim(), scope: f.scope.trim() },
        sourceRef: f.sourceRef.trim(),
      }),
    onSuccess: () => {
      refresh();
      toast(t('referential.toast.saved'), 'ok');
      setCreateOpen(false);
    },
    onError,
  });

  const validate = useMutation({
    mutationFn: (id: string) => apiPost<IrsamBenchmark>(`/referential/irsam-benchmarks/${id}/validate`),
    onSuccess: () => {
      refresh();
      toast(t('referential.toast.validated'), 'ok');
    },
    onError,
  });

  const archive = useMutation({
    mutationFn: (id: string) => apiPost<IrsamBenchmark>(`/referential/irsam-benchmarks/${id}/archive`),
    onSuccess: () => {
      refresh();
      toast(t('referential.toast.saved'), 'ok');
    },
    onError,
  });

  const items = listQuery.data ?? [];
  const formComplete =
    form.value !== '' &&
    Number(form.value) >= 0 &&
    !!form.periodFrom &&
    !!form.periodTo &&
    form.periodFrom <= form.periodTo &&
    !!form.startEvent.trim() &&
    !!form.endEvent.trim() &&
    !!form.scope.trim() &&
    !!form.sourceRef.trim();

  const columns: Column<IrsamBenchmark>[] = [
    { key: 'indicator', header: t('referential.irsam.col.indicator'), render: (r) => t(INDICATOR_LABELS[r.indicator]) },
    { key: 'value', header: t('referential.irsam.col.value'), render: (r) => <span className="mono">{`${r.value} ${t('referential.convention.unit.days')}`}</span> },
    { key: 'period', header: t('referential.irsam.col.period'), render: (r) => `${formatIsoDay(r.periodFrom, locale, 'short')} – ${formatIsoDay(r.periodTo, locale, 'short')}` },
    {
      key: 'definition',
      header: t('referential.irsam.col.definition'),
      render: (r) => (
        <span style={{ fontSize: 'var(--k-fs-xs)' }}>
          {r.measureDefinition.startEvent} → {r.measureDefinition.endEvent} · {r.measureDefinition.scope}
        </span>
      ),
    },
    { key: 'source', header: t('referential.field.sourceRef'), render: (r) => r.sourceRef },
    { key: 'status', header: t('referential.company.status'), render: (r) => <ValidationTag status={r.status} /> },
  ];
  if (canValidate) {
    columns.push({
      key: 'actions',
      header: t('referential.col.actions'),
      render: (r) => (
        <RowActions>
          {r.status === 'SAISI' ? (
            <RowAction disabled={validate.isPending} onClick={() => validate.mutate(r.id)}>
              {t('referential.action.validate')}
            </RowAction>
          ) : null}
          {r.status !== 'ARCHIVE' ? (
            <RowAction disabled={archive.isPending} onClick={() => archive.mutate(r.id)}>
              {t('referential.irsam.archive')}
            </RowAction>
          ) : null}
        </RowActions>
      ),
    });
  }

  const set = (key: keyof IrsamForm) => (v: string) => setForm((f) => ({ ...f, [key]: v }));

  return (
    <div className="sheet">
      <div className="sheet-head">
        <span>{t('referential.nav.irsam.title')}</span>
        {canEdit ? (
          <PrimaryButton
            onClick={() => {
              setForm(EMPTY_FORM);
              setCreateOpen(true);
            }}
          >
            {t('referential.irsam.create')}
          </PrimaryButton>
        ) : null}
      </div>
      <div className="sheet-body">
        <QueryState isLoading={listQuery.isLoading} error={listQuery.error} onRetry={() => listQuery.refetch()}>
          {items.length === 0 ? (
            <div className="note warn" role="status">
              <span>{t('referential.irsam.empty')}</span>
            </div>
          ) : (
            <Table columns={columns} rows={items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)} page={page} total={items.length} pageSize={PAGE_SIZE} onPageChange={setPage} getRowKey={(r) => r.id} />
          )}
        </QueryState>
        <Hint>{t('referential.irsam.note')}</Hint>
      </div>

      <Modal
        open={createOpen}
        title={t('referential.irsam.create')}
        onClose={() => setCreateOpen(false)}
        footer={
          <PrimaryButton disabled={create.isPending || !formComplete} onClick={() => create.mutate(form)}>
            {t('referential.action.save')}
          </PrimaryButton>
        }
      >
        <FormStack>
          <LabeledSelect
            label={t('referential.irsam.col.indicator')}
            value={form.indicator}
            options={(Object.keys(INDICATOR_LABELS) as IrsamIndicator[]).map((k) => ({ value: k, label: t(INDICATOR_LABELS[k]) }))}
            onChange={(v) => setForm((f) => ({ ...f, indicator: v as IrsamIndicator }))}
          />
          <LabeledInput label={t('referential.irsam.field.value')} type="number" value={form.value} onChange={set('value')} />
          <LabeledInput label={t('referential.irsam.field.periodFrom')} type="date" value={form.periodFrom} onChange={set('periodFrom')} />
          <LabeledInput label={t('referential.irsam.field.periodTo')} type="date" value={form.periodTo} onChange={set('periodTo')} />
          <strong style={{ fontSize: 'var(--k-fs-s)' }}>{t('referential.irsam.col.definition')}</strong>
          <p style={{ margin: 0, fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)' }}>{t('referential.irsam.form.idaHint')}</p>
          <LabeledInput label={t('referential.irsam.field.startEvent')} value={form.startEvent} onChange={set('startEvent')} />
          <LabeledInput label={t('referential.irsam.field.endEvent')} value={form.endEvent} onChange={set('endEvent')} />
          <LabeledInput label={t('referential.irsam.field.scope')} value={form.scope} onChange={set('scope')} />
          <LabeledInput label={t('referential.field.sourceRef')} value={form.sourceRef} onChange={set('sourceRef')} />
        </FormStack>
      </Modal>
    </div>
  );
}
