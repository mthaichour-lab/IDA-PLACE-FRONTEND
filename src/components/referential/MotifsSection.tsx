'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Column, Table } from '@/components/ui/Table';
import { Tag } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { apiGet, apiPath, apiPost, apiPut } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { ConstatCircumstance, EligibilityMotif, OppositionMotif } from '@/lib/types';
import { apiErrorMessage, FormStack, Hint, LabeledCheckbox, LabeledInput, PrimaryButton, QueryState, RowAction, RowActions, SubTitle } from './fields';
import { ValidationTag } from './ValidationTag';

const PAGE_SIZE = 6; // pagination fixe 6/p — A.5

const BLOCK_STYLE: React.CSSProperties = { marginBottom: 'var(--s-5)' };
const BLOCK_HEAD_STYLE: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--s-2)', flexWrap: 'wrap' };

interface MotifForm {
  code: string;
  label: string;
  forbidden: boolean;
  sourceRef: string;
}

const EMPTY_MOTIF: MotifForm = { code: '', label: '', forbidden: false, sourceRef: '' };

/**
 * « Barème & motifs » (écran 12), décision PO §1 : trois blocs distincts —
 * motifs d'inéligibilité du moteur, 17 circonstances du constat amiable,
 * motifs d'opposition. Aucun code « 17 cas / RG-01 » n'est affiché.
 */
export function MotifsSection({ eligibilityQuery }: { eligibilityQuery: ReturnType<typeof useQuery<EligibilityMotif[]>> }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const { hasPrivilege } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = hasPrivilege('params');
  const canValidate = hasPrivilege('validateRef');

  const [eligibilityPage, setEligibilityPage] = useState(1);
  const [circumstancesPage, setCircumstancesPage] = useState(1);
  const [motifsPage, setMotifsPage] = useState(1);

  const circumstancesQuery = useQuery({
    queryKey: ['referential', 'constat-circumstances'],
    queryFn: () => apiGet<ConstatCircumstance[]>('/referential/constat-circumstances'),
  });
  const motifsQuery = useQuery({
    queryKey: ['referential', 'opposition-motifs'],
    queryFn: () => apiGet<OppositionMotif[]>('/referential/opposition-motifs'),
  });

  const [editCircumstance, setEditCircumstance] = useState<ConstatCircumstance | null>(null);
  const [circumstanceForm, setCircumstanceForm] = useState({ labelFr: '', labelAr: '' });
  const [motifModal, setMotifModal] = useState<{ mode: 'create' } | { mode: 'edit'; code: string } | null>(null);
  const [motifForm, setMotifForm] = useState<MotifForm>(EMPTY_MOTIF);

  const onError = (err: unknown) => toast(apiErrorMessage(err, t('referential.toast.error'), t), 'ko');

  const saveCircumstance = useMutation({
    mutationFn: ({ number, labelFr, labelAr }: { number: number; labelFr: string; labelAr: string }) =>
      apiPut<ConstatCircumstance>(apiPath`/referential/constat-circumstances/${number}`, { labelFr, labelAr }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['referential', 'constat-circumstances'] });
      toast(t('referential.toast.saved'), 'ok');
      setEditCircumstance(null);
    },
    onError,
  });

  const validateCircumstance = useMutation({
    // SEC-30 : révision lue renvoyée (409 REVISION_PERIMEE si le libellé a changé depuis).
    mutationFn: ({ number, revision }: { number: number; revision?: number }) =>
      apiPost<ConstatCircumstance>(apiPath`/referential/constat-circumstances/${number}/validate`, revision !== undefined ? { revision } : undefined),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['referential', 'constat-circumstances'] });
      toast(t('referential.toast.validated'), 'ok');
    },
    onError,
  });

  const saveMotif = useMutation({
    mutationFn: (form: MotifForm) =>
      motifModal?.mode === 'edit'
        ? apiPut<OppositionMotif>(apiPath`/referential/opposition-motifs/${motifModal.code}`, { label: form.label, forbidden: form.forbidden, sourceRef: form.sourceRef || undefined })
        : apiPost<OppositionMotif>('/referential/opposition-motifs', { code: form.code, label: form.label, forbidden: form.forbidden, sourceRef: form.sourceRef || undefined }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['referential', 'opposition-motifs'] });
      toast(t('referential.toast.saved'), 'ok');
      setMotifModal(null);
    },
    onError,
  });

  const validateMotif = useMutation({
    mutationFn: ({ code, revision }: { code: string; revision?: number }) =>
      apiPost<OppositionMotif>(apiPath`/referential/opposition-motifs/${code}/validate`, revision !== undefined ? { revision } : undefined),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['referential', 'opposition-motifs'] });
      toast(t('referential.toast.validated'), 'ok');
    },
    onError,
  });

  const eligibility = eligibilityQuery.data ?? [];
  const circumstances = circumstancesQuery.data ?? [];
  const motifs = motifsQuery.data ?? [];

  const eligibilityColumns: Column<EligibilityMotif>[] = [
    { key: 'article', header: t('referential.motifs.col.article'), render: (r) => <span className="mono">{r.article}</span> },
    { key: 'label', header: t('referential.motifs.col.label'), render: (r) => r.label },
  ];

  const circumstanceColumns: Column<ConstatCircumstance>[] = [
    { key: 'number', header: t('referential.circumstances.col.number'), render: (r) => <span className="mono">{r.number}</span> },
    { key: 'labelFr', header: t('referential.circumstances.col.labelFr'), render: (r) => r.labelFr },
    { key: 'labelAr', header: t('referential.circumstances.col.labelAr'), render: (r) => (r.labelAr ? <span dir="rtl">{r.labelAr}</span> : '—') },
    { key: 'status', header: t('referential.company.status'), render: (r) => <ValidationTag status={r.status} /> },
  ];
  if (canEdit || canValidate) {
    circumstanceColumns.push({
      key: 'actions',
      header: t('referential.col.actions'),
      render: (r) => (
        <RowActions>
          {canEdit ? (
            <RowAction
              onClick={() => {
                setCircumstanceForm({ labelFr: r.labelFr, labelAr: r.labelAr ?? '' });
                setEditCircumstance(r);
              }}
            >
              {t('referential.action.edit')}
            </RowAction>
          ) : null}
          {canValidate && r.status !== 'VALIDE_UAR' ? (
            <RowAction disabled={validateCircumstance.isPending} onClick={() => validateCircumstance.mutate({ number: r.number, revision: r.revision })}>
              {t('referential.action.validate')}
            </RowAction>
          ) : null}
        </RowActions>
      ),
    });
  }

  const motifColumns: Column<OppositionMotif>[] = [
    { key: 'code', header: t('referential.oppositionMotifs.col.code'), render: (r) => <span className="mono">{r.code}</span> },
    { key: 'label', header: t('referential.motifs.col.label'), render: (r) => r.label },
    {
      key: 'usage',
      header: t('referential.oppositionMotifs.col.usage'),
      render: (r) => (r.forbidden ? <Tag tone="ko">{t('referential.oppositionMotifs.forbidden')}</Tag> : <Tag tone="ok">{t('referential.oppositionMotifs.admitted')}</Tag>),
    },
    { key: 'source', header: t('referential.field.sourceRef'), render: (r) => r.sourceRef ?? '—' },
    { key: 'status', header: t('referential.company.status'), render: (r) => <ValidationTag status={r.status} /> },
  ];
  if (canEdit || canValidate) {
    motifColumns.push({
      key: 'actions',
      header: t('referential.col.actions'),
      render: (r) => (
        <RowActions>
          {canEdit ? (
            <RowAction
              onClick={() => {
                setMotifForm({ code: r.code, label: r.label, forbidden: r.forbidden, sourceRef: r.sourceRef ?? '' });
                setMotifModal({ mode: 'edit', code: r.code });
              }}
            >
              {t('referential.action.edit')}
            </RowAction>
          ) : null}
          {canValidate && r.status !== 'VALIDE_UAR' ? (
            <RowAction disabled={validateMotif.isPending} onClick={() => validateMotif.mutate({ code: r.code, revision: r.revision })}>
              {t('referential.action.validate')}
            </RowAction>
          ) : null}
        </RowActions>
      ),
    });
  }

  return (
    <div className="sheet">
      <div className="sheet-head">
        <span>{t('referential.nav.motifs.title')}</span>
      </div>
      <div className="sheet-body">
        <section style={BLOCK_STYLE} aria-label={t('referential.motifs.eligibility.title')}>
          <SubTitle>
            {t('referential.motifs.eligibility.title')} ({eligibilityQuery.data ? eligibility.length : '…'})
          </SubTitle>
          <QueryState isLoading={eligibilityQuery.isLoading} error={eligibilityQuery.error} onRetry={() => eligibilityQuery.refetch()}>
            <Table
              columns={eligibilityColumns}
              rows={eligibility.slice((eligibilityPage - 1) * PAGE_SIZE, eligibilityPage * PAGE_SIZE)}
              page={eligibilityPage}
              total={eligibility.length}
              pageSize={PAGE_SIZE}
              onPageChange={setEligibilityPage}
              getRowKey={(r) => `${r.article}-${r.label}`}
            />
            <Hint>{t('referential.motifs.note')}</Hint>
          </QueryState>
        </section>

        <section style={BLOCK_STYLE} aria-label={t('referential.circumstances.title')}>
          <SubTitle>
            {t('referential.circumstances.title')} ({circumstancesQuery.data ? circumstances.length : '…'} {t('referential.circumstances.unit')})
          </SubTitle>
          <QueryState isLoading={circumstancesQuery.isLoading} error={circumstancesQuery.error} onRetry={() => circumstancesQuery.refetch()}>
            <Table
              columns={circumstanceColumns}
              rows={circumstances.slice((circumstancesPage - 1) * PAGE_SIZE, circumstancesPage * PAGE_SIZE)}
              page={circumstancesPage}
              total={circumstances.length}
              pageSize={PAGE_SIZE}
              onPageChange={setCircumstancesPage}
              getRowKey={(r) => String(r.number)}
            />
            <Hint>{t('referential.circumstances.note')}</Hint>
          </QueryState>
        </section>

        <section aria-label={t('referential.oppositionMotifs.title')}>
          <div style={BLOCK_HEAD_STYLE}>
            <SubTitle>{t('referential.oppositionMotifs.title')}</SubTitle>
            {canEdit ? (
              <PrimaryButton
                onClick={() => {
                  setMotifForm(EMPTY_MOTIF);
                  setMotifModal({ mode: 'create' });
                }}
              >
                {t('referential.oppositionMotifs.create')}
              </PrimaryButton>
            ) : null}
          </div>
          <QueryState isLoading={motifsQuery.isLoading} error={motifsQuery.error} onRetry={() => motifsQuery.refetch()}>
            <Table
              columns={motifColumns}
              rows={motifs.slice((motifsPage - 1) * PAGE_SIZE, motifsPage * PAGE_SIZE)}
              page={motifsPage}
              total={motifs.length}
              pageSize={PAGE_SIZE}
              onPageChange={setMotifsPage}
              getRowKey={(r) => r.code}
            />
            <Hint>{t('referential.oppositionMotifs.note')}</Hint>
          </QueryState>
        </section>
      </div>

      <Modal
        open={!!editCircumstance}
        title={`${t('referential.circumstances.edit.title')} ${editCircumstance?.number ?? ''}`}
        onClose={() => setEditCircumstance(null)}
        footer={
          <PrimaryButton
            disabled={saveCircumstance.isPending || !circumstanceForm.labelFr.trim()}
            onClick={() => editCircumstance && saveCircumstance.mutate({ number: editCircumstance.number, ...circumstanceForm })}
          >
            {t('referential.action.save')}
          </PrimaryButton>
        }
      >
        <FormStack>
          <LabeledInput label={t('referential.circumstances.col.labelFr')} value={circumstanceForm.labelFr} onChange={(v) => setCircumstanceForm((f) => ({ ...f, labelFr: v }))} />
          <LabeledInput label={t('referential.circumstances.col.labelAr')} value={circumstanceForm.labelAr} onChange={(v) => setCircumstanceForm((f) => ({ ...f, labelAr: v }))} />
          <Hint>{t('referential.revalidationHint')}</Hint>
        </FormStack>
      </Modal>

      <Modal
        open={!!motifModal}
        title={motifModal?.mode === 'edit' ? t('referential.oppositionMotifs.edit.title') : t('referential.oppositionMotifs.create')}
        onClose={() => setMotifModal(null)}
        footer={
          <PrimaryButton
            disabled={saveMotif.isPending || !motifForm.label.trim() || (motifModal?.mode === 'create' && !/^[A-Z0-9_]{2,64}$/.test(motifForm.code))}
            onClick={() => saveMotif.mutate(motifForm)}
          >
            {t('referential.action.save')}
          </PrimaryButton>
        }
      >
        <FormStack>
          <LabeledInput
            label={t('referential.oppositionMotifs.field.code')}
            value={motifForm.code}
            disabled={motifModal?.mode === 'edit'}
            onChange={(v) => setMotifForm((f) => ({ ...f, code: v.toUpperCase() }))}
          />
          <LabeledInput label={t('referential.motifs.col.label')} value={motifForm.label} onChange={(v) => setMotifForm((f) => ({ ...f, label: v }))} />
          <LabeledInput label={t('referential.field.sourceRef')} value={motifForm.sourceRef} onChange={(v) => setMotifForm((f) => ({ ...f, sourceRef: v }))} />
          <LabeledCheckbox label={t('referential.oppositionMotifs.field.forbidden')} checked={motifForm.forbidden} onChange={(v) => setMotifForm((f) => ({ ...f, forbidden: v }))} />
          {motifModal?.mode === 'edit' ? <Hint>{t('referential.revalidationHint')}</Hint> : null}
        </FormStack>
      </Modal>
    </div>
  );
}
