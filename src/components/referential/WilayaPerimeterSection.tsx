'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Column, Table } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { apiGet, apiPath, apiPut } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { useApiErrorMessage } from '@/lib/error-message';
import { WilayaRef } from '@/lib/types';
import { FormStack, LabeledInput, LabeledSelect, PrimaryButton, QueryState, RowAction, SubTitle } from './fields';

const PAGE_SIZE = 6; // pagination fixe 6/p — A.5

/** `GET /referential/wilayas` — champs de périmètre additifs (décision PO §3), absents quand non renseignés. */
export interface WilayaPerimeter extends WilayaRef {
  effectiveFrom?: string;
  parentCode?: string;
}

interface PerimeterForm {
  code: string;
  effectiveFrom: string;
  parentCode: string;
}

/**
 * Corps de `PUT /referential/wilayas/:code` (UpdateWilayaPerimeterDto) :
 * champs modifiés seulement ; un champ vidé est envoyé à `null` (effacement
 * prévu par le DTO).
 */
export function perimeterBody(current: WilayaPerimeter | undefined, f: PerimeterForm): { effectiveFrom?: string | null; parentCode?: string | null } {
  const body: { effectiveFrom?: string | null; parentCode?: string | null } = {};
  if (f.effectiveFrom !== (current?.effectiveFrom ?? '')) body.effectiveFrom = f.effectiveFrom || null;
  if (f.parentCode !== (current?.parentCode ?? '')) body.parentCode = f.parentCode || null;
  return body;
}

/**
 * « Périmètre des wilayas » (écran 12, section Populations de référence) :
 * date d'entrée en vigueur et wilaya mère (`PUT /referential/wilayas/:code`,
 * privilège `params`). Le périmètre conditionne la validité des populations
 * saisies plus haut : la liste des populations est rechargée après chaque
 * modification.
 */
export function WilayaPerimeterSection() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { hasPrivilege } = useAuth();
  const errorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const canEdit = hasPrivilege('params');

  const [page, setPage] = useState(1);
  const [form, setForm] = useState<PerimeterForm | null>(null);
  const [lockedCode, setLockedCode] = useState(false);

  const wilayasQuery = useQuery({
    queryKey: ['referential', 'wilayas'],
    queryFn: () => apiGet<WilayaPerimeter[]>('/referential/wilayas'),
  });
  const wilayas = wilayasQuery.data ?? [];
  const byCode = useMemo(() => new Map(wilayas.map((w) => [w.code, w])), [wilayas]);
  const label = (code: string) => {
    const name = byCode.get(code)?.name;
    return name ? `${code} — ${name}` : code;
  };
  const withPerimeter = wilayas.filter((w) => w.effectiveFrom || w.parentCode);

  const save = useMutation({
    mutationFn: (f: PerimeterForm) => apiPut<WilayaPerimeter>(apiPath`/referential/wilayas/${f.code}`, perimeterBody(byCode.get(f.code), f)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['referential', 'wilayas'] });
      // La validité d'une population dépend du périmètre actuel de sa wilaya.
      void queryClient.invalidateQueries({ queryKey: ['referential', 'wilaya-populations'] });
      toast(t('referential.wilaya.toast.saved'), 'ok');
      setForm(null);
    },
    onError: (err: unknown) => toast(errorMessage(err, t('referential.toast.error')), 'ko'),
  });

  function open(code: string, locked: boolean) {
    const w = byCode.get(code);
    setForm({ code, effectiveFrom: w?.effectiveFrom ?? '', parentCode: w?.parentCode ?? '' });
    setLockedCode(locked);
  }

  const columns: Column<WilayaPerimeter>[] = [
    { key: 'wilaya', header: t('referential.wilaya.col.wilaya'), render: (r) => label(r.code) },
    { key: 'effectiveFrom', header: t('referential.wilaya.col.effectiveFrom'), render: (r) => (r.effectiveFrom ? <span className="mono">{r.effectiveFrom}</span> : '—') },
    { key: 'parent', header: t('referential.wilaya.col.parent'), render: (r) => (r.parentCode ? label(r.parentCode) : '—') },
  ];
  if (canEdit) {
    columns.push({
      key: 'actions',
      header: t('referential.col.actions'),
      render: (r) => (
        <RowAction ariaLabel={`${t('referential.wilaya.perimeter.editRow')} ${label(r.code)}`} onClick={() => open(r.code, true)}>
          {t('referential.action.edit')}
        </RowAction>
      ),
    });
  }

  const none = { value: '', label: t('referential.field.none') };
  const wilayaOptions = [{ value: '', label: '—', disabled: true }, ...wilayas.map((w) => ({ value: w.code, label: label(w.code) }))];
  const parentOptions = [none, ...wilayas.filter((w) => w.code !== form?.code).map((w) => ({ value: w.code, label: label(w.code) }))];
  const changed = !!form?.code && Object.keys(perimeterBody(byCode.get(form.code), form)).length > 0;

  return (
    <section aria-label={t('referential.wilaya.perimeter.title')} style={{ marginTop: 'var(--s-5)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--s-2)', flexWrap: 'wrap' }}>
        <SubTitle>{t('referential.wilaya.perimeter.title')}</SubTitle>
        {canEdit ? (
          <PrimaryButton
            disabled={wilayas.length === 0}
            onClick={() => {
              setForm({ code: '', effectiveFrom: '', parentCode: '' });
              setLockedCode(false);
            }}
          >
            {t('referential.wilaya.perimeter.edit')}
          </PrimaryButton>
        ) : null}
      </div>
      <p style={{ marginTop: 0, fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)' }}>{t('referential.wilaya.perimeter.intro')}</p>
      <QueryState isLoading={wilayasQuery.isLoading} error={wilayasQuery.error} onRetry={() => wilayasQuery.refetch()}>
        {withPerimeter.length === 0 ? (
          <p style={{ fontSize: 'var(--k-fs-s)', color: 'var(--ink-3)', margin: 0 }}>{t('referential.wilaya.perimeter.empty')}</p>
        ) : (
          <Table columns={columns} rows={withPerimeter.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)} page={page} total={withPerimeter.length} pageSize={PAGE_SIZE} onPageChange={setPage} getRowKey={(r) => r.code} />
        )}
      </QueryState>

      <Modal
        open={!!form}
        title={form?.code && lockedCode ? `${t('referential.wilaya.perimeter.edit.title')} — ${label(form.code)}` : t('referential.wilaya.perimeter.edit.title')}
        onClose={() => setForm(null)}
        footer={
          <PrimaryButton disabled={save.isPending || !changed} onClick={() => form && save.mutate(form)}>
            {t('referential.action.save')}
          </PrimaryButton>
        }
      >
        {form ? (
          <FormStack>
            <LabeledSelect label={t('referential.wilaya.col.wilaya')} value={form.code} required disabled={lockedCode} options={wilayaOptions} onChange={(v) => open(v, false)} />
            <LabeledInput
              label={t('referential.wilaya.field.effectiveFrom')}
              type="date"
              value={form.effectiveFrom}
              disabled={!form.code}
              onChange={(v) => setForm((f) => (f ? { ...f, effectiveFrom: v } : f))}
            />
            <LabeledSelect
              label={t('referential.wilaya.col.parent')}
              value={form.parentCode}
              disabled={!form.code}
              options={parentOptions}
              onChange={(v) => setForm((f) => (f ? { ...f, parentCode: v } : f))}
            />
          </FormStack>
        ) : null}
      </Modal>
    </section>
  );
}
