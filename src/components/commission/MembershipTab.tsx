'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { CoChip } from '@/components/ui/CoChip';
import { Modal } from '@/components/ui/Modal';
import { Column, Table } from '@/components/ui/Table';
import { Tag, TagTone } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { TranslationKey } from '@/i18n/translations';
import { apiGet, apiPost } from '@/lib/api-client';
import { ApiError } from '@/lib/api-error';
import { useAuth } from '@/lib/auth-context';
import {
  CompanyView,
  CreateMembershipRequest,
  MEMBERSHIP_STATES,
  MEMBERSHIP_TYPES,
  MembershipRequest,
  MembershipState,
  MembershipType,
  Paginated,
} from '@/lib/types';

const PAGE_SIZE = 6;

const FIELD_STYLE: React.CSSProperties = {
  width: '100%',
  marginBottom: 'var(--s-2)',
  padding: '6px 10px',
  border: '1px solid var(--rule-strong)',
  borderRadius: 'var(--k-r-s)',
  font: 'inherit',
  background: 'var(--paper)',
  color: 'var(--ink)',
};

const LABEL_STYLE: React.CSSProperties = { display: 'block', fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)', marginBottom: 4 };

type MembershipAction = 'accept' | 'reject' | 'effective' | 'cancel';

function stateTone(state: MembershipState): TagTone {
  if (state === 'ACCEPTEE' || state === 'EFFECTIVE') return 'ok';
  if (state === 'REJETEE') return 'ko';
  if (state === 'RECUE') return 'warn';
  return 'a';
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatIsoDate(iso: string, locale: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString(locale, { timeZone: 'UTC' });
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.message ? err.message : fallback;
}

interface CreateForm {
  type: MembershipType;
  receivedAt: string;
  candidateName: string;
  agrementRef: string;
  companyId: string;
}

const emptyForm = (): CreateForm => ({ type: 'ADHESION', receivedAt: todayIso(), candidateName: '', agrementRef: '', companyId: '' });

export function MembershipTab() {
  const { t, locale } = useI18n();
  const { hasPrivilege } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const canManage = hasPrivilege('membership');

  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState<MembershipType | ''>('');
  const [stateFilter, setStateFilter] = useState<MembershipState | ''>('');
  const [selected, setSelected] = useState<MembershipRequest | null>(null);
  const [agrementRef, setAgrementRef] = useState('');
  const [decisionNote, setDecisionNote] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CreateForm>(emptyForm);

  const listQuery = useQuery({
    queryKey: ['commission', 'membership', { page, type: typeFilter, state: stateFilter }],
    queryFn: () =>
      apiGet<Paginated<MembershipRequest>>('/commission/membership-requests', {
        page,
        pageSize: PAGE_SIZE,
        type: typeFilter || undefined,
        state: stateFilter || undefined,
      }),
  });

  const companiesQuery = useQuery({
    queryKey: ['referential', 'companies', 'all'],
    queryFn: () => apiGet<Paginated<CompanyView>>('/referential/companies', { page: 1, pageSize: 100 }),
    enabled: createOpen && form.type === 'RETRAIT',
  });

  function openDetail(row: MembershipRequest) {
    setSelected(row);
    setAgrementRef(row.agrementRef ?? '');
    setDecisionNote('');
  }

  const createMutation = useMutation({
    mutationFn: (body: CreateMembershipRequest) => apiPost<MembershipRequest>('/commission/membership-requests', body),
    onSuccess: () => {
      setCreateOpen(false);
      setForm(emptyForm());
      toast(t('commission.membership.toast.createOk'), 'ok');
      void queryClient.invalidateQueries({ queryKey: ['commission', 'membership'] });
    },
    onError: (err: unknown) => toast(errorMessage(err, t('commission.membership.toast.error')), 'ko'),
  });

  const actionMutation = useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: MembershipAction; body: Record<string, string | undefined> }) =>
      apiPost<MembershipRequest>(`/commission/membership-requests/${id}/${action}`, body),
    onSuccess: (result) => {
      openDetail(result);
      toast(t('commission.membership.toast.actionOk'), 'ok');
      void queryClient.invalidateQueries({ queryKey: ['commission', 'membership'] });
    },
    onError: (err: unknown) => toast(errorMessage(err, t('commission.membership.toast.error')), 'ko'),
  });

  function runAction(action: MembershipAction) {
    if (!selected) return;
    const note = decisionNote.trim() || undefined;
    const body = action === 'accept' ? { agrementRef: agrementRef.trim() || undefined, decisionNote: note } : { decisionNote: note };
    actionMutation.mutate({ id: selected.id, action, body });
  }

  function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    const body: CreateMembershipRequest =
      form.type === 'ADHESION'
        ? { type: 'ADHESION', receivedAt: form.receivedAt, candidateName: form.candidateName.trim(), agrementRef: form.agrementRef.trim() || undefined }
        : { type: 'RETRAIT', receivedAt: form.receivedAt, companyId: form.companyId };
    createMutation.mutate(body);
  }

  const columns: Column<MembershipRequest>[] = useMemo(
    () => [
      { key: 'type', header: t('commission.membership.col.type'), render: (r) => t(`commission.membership.type.${r.type}` as TranslationKey) },
      {
        key: 'party',
        header: t('commission.membership.col.party'),
        render: (r) =>
          r.companyCode ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <CoChip code={r.companyCode} /> <span className="mono">{r.companyCode}</span>
            </span>
          ) : (
            r.candidateName ?? '—'
          ),
      },
      { key: 'receivedAt', header: t('commission.membership.col.receivedAt'), render: (r) => formatIsoDate(r.receivedAt, locale) },
      { key: 'effectiveDate', header: t('commission.membership.col.effectiveDate'), render: (r) => (r.effectiveDate ? formatIsoDate(r.effectiveDate, locale) : '—') },
      {
        key: 'state',
        header: t('commission.membership.col.state'),
        render: (r) => <Tag tone={stateTone(r.state)}>{t(`commission.membership.state.${r.state}` as TranslationKey)}</Tag>,
      },
    ],
    [t, locale],
  );

  const effectiveReached = selected?.effectiveDate ? todayIso() > selected.effectiveDate : false;
  const createValid = form.receivedAt && (form.type === 'ADHESION' ? form.candidateName.trim() !== '' : form.companyId !== '');

  return (
    <>
      <div style={{ display: 'flex', gap: 'var(--s-3)', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 'var(--s-3)' }}>
        <div>
          <label htmlFor="membership-type-filter" style={LABEL_STYLE}>
            {t('commission.membership.col.type')}
          </label>
          <select
            id="membership-type-filter"
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value as MembershipType | '');
              setPage(1);
            }}
            style={{ ...FIELD_STYLE, width: 'auto', marginBottom: 0 }}
          >
            <option value="">{t('commission.membership.filter.all')}</option>
            {MEMBERSHIP_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`commission.membership.type.${type}` as TranslationKey)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="membership-state-filter" style={LABEL_STYLE}>
            {t('commission.membership.col.state')}
          </label>
          <select
            id="membership-state-filter"
            value={stateFilter}
            onChange={(e) => {
              setStateFilter(e.target.value as MembershipState | '');
              setPage(1);
            }}
            style={{ ...FIELD_STYLE, width: 'auto', marginBottom: 0 }}
          >
            <option value="">{t('commission.membership.filter.all')}</option>
            {MEMBERSHIP_STATES.map((state) => (
              <option key={state} value={state}>
                {t(`commission.membership.state.${state}` as TranslationKey)}
              </option>
            ))}
          </select>
        </div>
        {canManage ? (
          <button type="button" className="tag a" style={{ border: 'none', cursor: 'pointer', marginInlineStart: 'auto' }} onClick={() => setCreateOpen(true)}>
            {t('commission.membership.new')}
          </button>
        ) : null}
      </div>

      {listQuery.isLoading ? (
        <p>{t('common.loading')}</p>
      ) : listQuery.error ? (
        <div className="note ko" role="alert">
          <span>{t('common.error')}</span>
          <button type="button" onClick={() => listQuery.refetch()}>
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <Table
          columns={columns}
          rows={listQuery.data?.items ?? []}
          page={page}
          total={listQuery.data?.total ?? 0}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          onRowClick={openDetail}
          getRowKey={(r) => r.id}
        />
      )}

      <Modal open={createOpen} title={t('commission.membership.new')} onClose={() => setCreateOpen(false)}>
        <form onSubmit={submitCreate}>
          <label htmlFor="membership-form-type" style={LABEL_STYLE}>
            {t('commission.membership.col.type')}
          </label>
          <select
            id="membership-form-type"
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as MembershipType }))}
            style={FIELD_STYLE}
          >
            {MEMBERSHIP_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`commission.membership.type.${type}` as TranslationKey)}
              </option>
            ))}
          </select>

          <label htmlFor="membership-form-received" style={LABEL_STYLE}>
            {t('commission.membership.col.receivedAt')}
          </label>
          <input
            id="membership-form-received"
            type="date"
            max={todayIso()}
            value={form.receivedAt}
            onChange={(e) => setForm((f) => ({ ...f, receivedAt: e.target.value }))}
            style={FIELD_STYLE}
          />

          {form.type === 'ADHESION' ? (
            <>
              <label htmlFor="membership-form-candidate" style={LABEL_STYLE}>
                {t('commission.membership.form.candidateName')}
              </label>
              <input
                id="membership-form-candidate"
                type="text"
                value={form.candidateName}
                onChange={(e) => setForm((f) => ({ ...f, candidateName: e.target.value }))}
                style={FIELD_STYLE}
              />
              <label htmlFor="membership-form-agrement" style={LABEL_STYLE}>
                {t('commission.membership.form.agrementRef')}
              </label>
              <input
                id="membership-form-agrement"
                type="text"
                value={form.agrementRef}
                onChange={(e) => setForm((f) => ({ ...f, agrementRef: e.target.value }))}
                style={FIELD_STYLE}
              />
            </>
          ) : (
            <>
              <label htmlFor="membership-form-company" style={LABEL_STYLE}>
                {t('commission.membership.form.company')}
              </label>
              <select
                id="membership-form-company"
                value={form.companyId}
                onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value }))}
                disabled={companiesQuery.isLoading}
                style={FIELD_STYLE}
              >
                <option value="">—</option>
                {(companiesQuery.data?.items ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </>
          )}

          <button
            type="submit"
            className="tag ok"
            style={{ border: 'none', cursor: createValid && !createMutation.isPending ? 'pointer' : 'not-allowed', marginTop: 'var(--s-2)' }}
            disabled={!createValid || createMutation.isPending}
          >
            {t('commission.membership.form.submit')}
          </button>
        </form>
      </Modal>

      <Modal
        open={!!selected}
        title={selected ? `${t(`commission.membership.type.${selected.type}` as TranslationKey)} — ${selected.companyCode ?? selected.candidateName ?? ''}` : ''}
        onClose={() => setSelected(null)}
      >
        {selected ? (
          <>
            <p>
              {t('commission.membership.col.state')} : <Tag tone={stateTone(selected.state)}>{t(`commission.membership.state.${selected.state}` as TranslationKey)}</Tag>
            </p>
            <p style={{ color: 'var(--ink-2)', fontSize: 'var(--k-fs-s)' }}>
              {t('commission.membership.col.receivedAt')} : {formatIsoDate(selected.receivedAt, locale)}
              {selected.effectiveDate ? (
                <>
                  {' · '}
                  {t('commission.membership.col.effectiveDate')} : {formatIsoDate(selected.effectiveDate, locale)}
                </>
              ) : null}
            </p>
            {selected.agrementRef ? (
              <p style={{ color: 'var(--ink-2)', fontSize: 'var(--k-fs-s)' }}>
                {t('commission.membership.form.agrementRef')} : <span className="mono">{selected.agrementRef}</span>
              </p>
            ) : null}
            <p style={{ color: 'var(--ink-2)', fontSize: 'var(--k-fs-s)' }}>
              {t('commission.membership.detail.createdBy')} : {selected.createdBy} · {new Date(selected.createdAt).toLocaleString(locale)}
            </p>
            {selected.decidedAt ? (
              <p style={{ color: 'var(--ink-2)', fontSize: 'var(--k-fs-s)' }}>
                {t('commission.membership.detail.decidedAt')} : {new Date(selected.decidedAt).toLocaleString(locale)}
                {selected.decidedBy ? ` · ${selected.decidedBy}` : ''}
                {selected.decisionNote ? ` — ${selected.decisionNote}` : ''}
              </p>
            ) : null}

            {canManage && selected.state === 'RECUE' ? (
              <div style={{ marginTop: 'var(--s-4)', paddingTop: 'var(--s-4)', borderTop: '1px solid var(--rule)' }}>
                {selected.type === 'ADHESION' ? (
                  <>
                    <label htmlFor="membership-accept-agrement" style={LABEL_STYLE}>
                      {t('commission.membership.form.agrementRef')}
                    </label>
                    <input id="membership-accept-agrement" type="text" value={agrementRef} onChange={(e) => setAgrementRef(e.target.value)} style={FIELD_STYLE} />
                  </>
                ) : null}

                <label htmlFor="membership-decision-note" style={LABEL_STYLE}>
                  {t('commission.membership.detail.decisionNote')}
                </label>
                <input id="membership-decision-note" type="text" value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} style={FIELD_STYLE} />

                {selected.type === 'ADHESION' ? (
                  <>
                    {!decisionNote.trim() ? (
                      <p style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)', marginTop: 0 }}>{t('commission.membership.action.rejectHint')}</p>
                    ) : null}
                    <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="tag ok"
                        style={{ border: 'none', cursor: 'pointer' }}
                        disabled={!agrementRef.trim() || actionMutation.isPending}
                        onClick={() => runAction('accept')}
                      >
                        {t('commission.membership.action.accept')}
                      </button>
                      <button
                        type="button"
                        className="tag ko"
                        style={{ border: 'none', cursor: 'pointer' }}
                        disabled={!decisionNote.trim() || actionMutation.isPending}
                        onClick={() => runAction('reject')}
                      >
                        {t('commission.membership.action.reject')}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {!effectiveReached && selected.effectiveDate ? (
                      <p className="note warn">
                        {t('commission.membership.action.effectiveHint')} {formatIsoDate(selected.effectiveDate, locale)}
                      </p>
                    ) : null}
                    <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="tag ok"
                        style={{ border: 'none', cursor: effectiveReached ? 'pointer' : 'not-allowed' }}
                        disabled={!effectiveReached || actionMutation.isPending}
                        onClick={() => runAction('effective')}
                      >
                        {t('commission.membership.action.effective')}
                      </button>
                      <button
                        type="button"
                        className="tag a"
                        style={{ border: 'none', cursor: 'pointer' }}
                        disabled={actionMutation.isPending}
                        onClick={() => runAction('cancel')}
                      >
                        {t('commission.membership.action.cancel')}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </>
        ) : null}
      </Modal>
    </>
  );
}
