'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { FolioHeader } from '@/components/FolioHeader';
import { MembershipTab } from '@/components/commission/MembershipTab';
import { AttachmentsPanel } from '@/components/documents/AttachmentsPanel';
import { CoChip } from '@/components/ui/CoChip';
import { Kpi, KpiRow } from '@/components/ui/Kpi';
import { Modal } from '@/components/ui/Modal';
import { Table, Column } from '@/components/ui/Table';
import { Tabs } from '@/components/ui/Tabs';
import { Tag, TagTone } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { TranslationKey } from '@/i18n/translations';
import { apiGet, apiPath, apiPost } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { useApiErrorMessage } from '@/lib/error-message';
import { isCompanyActor } from '@/lib/recours-actions';
import { CommissionCase, CommissionCaseStatus, CommissionPenaltyResult, CommissionPvSignResult, CommissionSummary, Paginated, Sanction, SanctionStatus } from '@/lib/types';

const PAGE_SIZE = 6; // pagination fixe 6/p — A.5

type CommissionTab = 'role' | 'sanctions' | 'membership';

function statusTone(status: CommissionCaseStatus): TagTone {
  if (status === 'PRONONCE') return 'ok';
  if (status === 'EN_DELIBERE') return 'warn';
  return 'a';
}

const SANCTION_STATUS_TONE: Record<SanctionStatus, TagTone> = { A_CONTRESIGNER: 'warn', PRONONCEE: 'ok' };

/** SEC-06 : montant strictement positif, deux décimales au plus. */
function isValidAmount(raw: string): boolean {
  return /^\d+(\.\d{1,2})?$/.test(raw.trim()) && Number(raw) > 0;
}

function formatDzd(amount: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'DZD', maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount.toLocaleString()} DA`;
  }
}

interface LocalDecision {
  penalty?: { amount: number; reason: string; orderedAt: string; status: SanctionStatus };
  pvSignedAt?: string;
}

export default function CommissionPage() {
  const { t, locale } = useI18n();
  const { me, hasPrivilege } = useAuth();
  const { toast } = useToast();
  const errorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<CommissionTab>('role');
  const [page, setPage] = useState(1);
  const [sanctionsPage, setSanctionsPage] = useState(1);
  const [selected, setSelected] = useState<CommissionCase | null>(null);
  const [penaltyCompany, setPenaltyCompany] = useState<'A' | 'B'>('A');
  const [penaltyAmount, setPenaltyAmount] = useState('');
  const [penaltyReason, setPenaltyReason] = useState('');
  // Les pénalités (`SanctionViewDto`) sont des enregistrements séparés liés
  // par `commissionCaseId`, pas un champ embarqué dans `CommissionCase` —
  // gardées localement pour l'affichage immédiat (session courante) ; le PV,
  // lui, est bien persisté et renvoyé dans la fiche (`selected.pv`) après
  // invalidation de la requête.
  const [decisions, setDecisions] = useState<Record<string, LocalDecision>>({});

  const canPenalty = hasPrivilege('penaltyOrder');
  const canSignPv = hasPrivilege('pvSign');
  // SEC-25/SEC-32 : le contreseing est un acte de commission (rôles place), par un autre membre que l'auteur.
  const canCountersign = !!me && !isCompanyActor(me) && (hasPrivilege('sanction') || hasPrivilege('penaltyOrder'));

  // KPI de synthèse additif (`GET /commission/summary`, codé par le Tech
  // Lead en parallèle sur ce sprint) — voir HANDOFF.md et `src/lib/types.ts`.
  const summaryQuery = useQuery({
    queryKey: ['commission', 'summary'],
    queryFn: () => apiGet<CommissionSummary>('/commission/summary'),
  });

  const casesQuery = useQuery({
    queryKey: ['commission', 'cases', page],
    queryFn: () => apiGet<Paginated<CommissionCase>>('/commission/cases', { page, pageSize: PAGE_SIZE }),
  });

  const pageRows = casesQuery.data?.items ?? [];

  // `GET /commission/sanctions` existe déjà côté back (réel) mais n'était
  // jusqu'ici tout simplement pas affiché côté front — pas une limite de
  // données, un oubli pur et simple (voir HANDOFF.md).
  const sanctionsQuery = useQuery({
    queryKey: ['commission', 'sanctions', sanctionsPage],
    queryFn: () => apiGet<Paginated<Sanction>>('/commission/sanctions', { page: sanctionsPage, pageSize: PAGE_SIZE }),
    enabled: tab === 'sanctions',
  });

  const sanctionRows = sanctionsQuery.data?.items ?? [];

  const penaltyMutation = useMutation({
    mutationFn: ({ id, companyCode, amount, reason }: { id: string; companyCode: string; amount: number; reason: string }) =>
      apiPost<CommissionPenaltyResult>(apiPath`/commission/cases/${id}/penalty`, { companyCode, amount, reason }),
    onSuccess: (result, variables) => {
      setDecisions((prev) => ({
        ...prev,
        [variables.id]: { ...prev[variables.id], penalty: { amount: result.amount ?? variables.amount, reason: result.reason, orderedAt: result.orderedAt, status: result.status ?? 'A_CONTRESIGNER' } },
      }));
      setPenaltyAmount('');
      setPenaltyReason('');
      void queryClient.invalidateQueries({ queryKey: ['commission', 'sanctions'] });
      // SEC-32 : une pénalité proposée n'est prononcée qu'après contreseing d'un second membre.
      toast(t(result.status === 'PRONONCEE' ? 'commission.toast.penaltyOk' : 'commission.toast.penaltyProposed'), 'ok');
    },
    onError: (err: unknown) => toast(errorMessage(err, t('commission.toast.penaltyError')), 'ko'),
  });

  const countersignMutation = useMutation({
    mutationFn: (id: string) => apiPost<Sanction>(apiPath`/commission/sanctions/${id}/countersign`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['commission', 'sanctions'] });
      toast(t('commission.toast.countersignOk'), 'ok');
    },
    onError: (err: unknown) => toast(errorMessage(err, t('commission.toast.countersignError')), 'ko'),
  });

  const pvSignMutation = useMutation({
    mutationFn: (id: string) => apiPost<CommissionPvSignResult>(apiPath`/commission/cases/${id}/pv-sign`, {}),
    onSuccess: (result) => {
      setSelected(result);
      void queryClient.invalidateQueries({ queryKey: ['commission', 'cases'] });
      toast(t('commission.toast.pvSignOk'), 'ok');
    },
    onError: (err: unknown) => toast(errorMessage(err, t('commission.toast.pvSignError')), 'ko'),
  });

  const columns: Column<CommissionCase>[] = useMemo(
    () => [
      { key: 'recoursId', header: t('commission.col.case'), render: (r) => <span className="mono">{r.recoursId}</span> },
      { key: 'status', header: t('commission.col.status'), render: (r) => <Tag tone={statusTone(r.status)}>{t(`commission.status.${r.status}` as TranslationKey)}</Tag> },
      { key: 'scheduledAt', header: t('commission.col.scheduledAt'), render: (r) => new Date(r.scheduledAt).toLocaleDateString(locale) },
    ],
    [t, locale],
  );

  const sanctionColumns: Column<Sanction>[] = useMemo(
    () => [
      {
        key: 'companyCode',
        header: t('commission.sanctions.col.company'),
        render: (s) => (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <CoChip code={s.companyCode} /> <span className="mono">{s.companyCode}</span>
          </span>
        ),
      },
      { key: 'amount', header: t('commission.sanctions.col.amount'), render: (s) => <span className="mono">{s.amount !== undefined ? formatDzd(s.amount, locale) : '—'}</span> },
      { key: 'reason', header: t('commission.sanctions.col.reason'), render: (s) => s.reason },
      { key: 'orderedAt', header: t('commission.sanctions.col.orderedAt'), render: (s) => new Date(s.orderedAt).toLocaleDateString(locale) },
      { key: 'orderedBy', header: t('commission.sanctions.col.orderedBy'), render: (s) => s.orderedBy },
      {
        key: 'status',
        header: t('commission.sanctions.col.status'),
        render: (s) => (
          <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
            <Tag tone={s.status ? SANCTION_STATUS_TONE[s.status] : 'a'}>{s.status ? t(`commission.sanctions.status.${s.status}` as TranslationKey) : '—'}</Tag>
            {s.countersignedBy ? (
              <span style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)' }}>
                {t('commission.sanctions.countersignedBy')} {s.countersignedBy}
              </span>
            ) : null}
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        render: (s) =>
          s.status === 'A_CONTRESIGNER' && canCountersign ? (
            <button
              type="button"
              className="tag ok"
              style={{ border: 'none', cursor: 'pointer' }}
              disabled={countersignMutation.isPending}
              onClick={() => countersignMutation.mutate(s.id)}
            >
              {t('commission.sanctions.countersign')}
            </button>
          ) : null,
      },
    ],
    [t, locale, canCountersign, countersignMutation],
  );

  const selectedDecision = selected ? decisions[selected.id] : undefined;

  return (
    <>
      <FolioHeader badge="Module E · §6.7" title={t('commission.title')} subtitle={t('commission.subtitle')} />

      {summaryQuery.isLoading ? (
        <p>{t('common.loading')}</p>
      ) : summaryQuery.error || !summaryQuery.data ? (
        <div className="note ko" role="alert">
          <span>{t('common.error')}</span>
          <button type="button" onClick={() => summaryQuery.refetch()}>
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <KpiRow>
          <Kpi value={summaryQuery.data.pendingCount} label={t('commission.kpi.pendingCount')} />
          <Kpi value={summaryQuery.data.overdue15dCount} label={t('commission.kpi.overdue15dCount')} />
          <Kpi value={summaryQuery.data.recoursFondesCount} label={t('commission.kpi.recoursFondesCount')} />
          <Kpi value={summaryQuery.data.oppositionsFondeesCount} label={t('commission.kpi.oppositionsFondeesCount')} />
        </KpiRow>
      )}

      <div className="sheet" style={{ marginTop: 'var(--s-5)' }}>
        <div className="sheet-body">
          <Tabs
            items={[
              { key: 'role', label: t('commission.tab.role') },
              { key: 'sanctions', label: t('commission.tab.sanctions') },
              { key: 'membership', label: t('commission.tab.membership') },
            ]}
            activeKey={tab}
            onChange={(key) => setTab(key as CommissionTab)}
          />

          {tab === 'role' ? (
            casesQuery.isLoading ? (
              <p>{t('common.loading')}</p>
            ) : casesQuery.error ? (
              <div className="note ko" role="alert">
                <span>{t('common.error')}</span>
                <button type="button" onClick={() => casesQuery.refetch()}>
                  {t('common.retry')}
                </button>
              </div>
            ) : (
              <Table
                columns={columns}
                rows={pageRows}
                page={page}
                total={casesQuery.data?.total ?? 0}
                pageSize={PAGE_SIZE}
                onPageChange={setPage}
                onRowClick={setSelected}
                getRowKey={(r) => r.id}
              />
            )
          ) : tab === 'membership' ? (
            <MembershipTab />
          ) : sanctionsQuery.isLoading ? (
            <p>{t('common.loading')}</p>
          ) : sanctionsQuery.error ? (
            <div className="note ko" role="alert">
              <span>{t('common.error')}</span>
              <button type="button" onClick={() => sanctionsQuery.refetch()}>
                {t('common.retry')}
              </button>
            </div>
          ) : (
            <Table
              columns={sanctionColumns}
              rows={sanctionRows}
              page={sanctionsPage}
              total={sanctionsQuery.data?.total ?? 0}
              pageSize={PAGE_SIZE}
              onPageChange={setSanctionsPage}
              getRowKey={(s) => s.id}
            />
          )}
        </div>
      </div>

      <Modal open={!!selected} title={selected ? `${t('commission.col.case')} ${selected.recoursId}` : ''} onClose={() => setSelected(null)}>
        {selected ? (
          <>
            <p>
              {t('commission.col.status')} : <Tag tone={statusTone(selected.status)}>{t(`commission.status.${selected.status}` as TranslationKey)}</Tag>
            </p>
            <p style={{ color: 'var(--ink-2)', fontSize: 'var(--k-fs-s)' }}>
              {t('commission.col.scheduledAt')} : {new Date(selected.scheduledAt).toLocaleString(locale)}
            </p>

            {selectedDecision?.penalty ? (
              <p className="note warn">
                <strong>{t(selectedDecision.penalty.status === 'PRONONCEE' ? 'commission.decision.penaltyIssued' : 'commission.decision.penaltyProposed')}</strong> : {new Intl.NumberFormat(locale, { style: 'currency', currency: 'DZD', maximumFractionDigits: 0 }).format(selectedDecision.penalty.amount)} — {selectedDecision.penalty.reason}
              </p>
            ) : null}
            {selected.pv ? (
              <p className="note ok">
                <strong>{t('commission.decision.pvSigned')}</strong> : {new Date(selected.pv.signedAt).toLocaleString(locale)} ({selected.pv.ref})
              </p>
            ) : null}

            <div style={{ marginTop: 'var(--s-4)', paddingTop: 'var(--s-4)', borderTop: '1px solid var(--rule)' }}>
              <strong style={{ display: 'block', marginBottom: 'var(--s-2)', fontSize: 'var(--k-fs-s)' }}>{t('commission.action.penalty.title')}</strong>
              {!canPenalty ? <p className="note warn">{t('commission.forbidden.penalty')}</p> : null}
              {canPenalty && !selected.pv ? (
                <p style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)' }}>{t('commission.penalty.requiresPv')}</p>
              ) : null}

              <label htmlFor="penalty-company" style={{ display: 'block', fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)', marginBottom: 4 }}>
                {t('commission.action.penalty.company')}
              </label>
              <select
                id="penalty-company"
                value={penaltyCompany}
                onChange={(e) => setPenaltyCompany(e.target.value as 'A' | 'B')}
                disabled={!canPenalty}
                style={{ width: '100%', marginBottom: 'var(--s-2)', padding: '6px 10px', border: '1px solid var(--rule-strong)', borderRadius: 'var(--k-r-s)', font: 'inherit', background: 'var(--paper)', color: 'var(--ink)' }}
              >
                <option value="A">{selected.companyA}</option>
                <option value="B">{selected.companyB}</option>
              </select>

              <label htmlFor="penalty-amount" style={{ display: 'block', fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)', marginBottom: 4 }}>
                {t('commission.action.penalty.amount')}
              </label>
              <input
                id="penalty-amount"
                type="number"
                min={0.01}
                step={0.01}
                aria-invalid={!!penaltyAmount && !isValidAmount(penaltyAmount)}
                value={penaltyAmount}
                onChange={(e) => setPenaltyAmount(e.target.value)}
                disabled={!canPenalty}
                style={{ width: '100%', marginBottom: 'var(--s-2)', padding: '6px 10px', border: '1px solid var(--rule-strong)', borderRadius: 'var(--k-r-s)', font: 'inherit', background: 'var(--paper)', color: 'var(--ink)' }}
              />

              <label htmlFor="penalty-reason" style={{ display: 'block', fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)', marginBottom: 4 }}>
                {t('commission.action.penalty.reason')}
              </label>
              <input
                id="penalty-reason"
                type="text"
                value={penaltyReason}
                onChange={(e) => setPenaltyReason(e.target.value)}
                disabled={!canPenalty}
                style={{ width: '100%', marginBottom: 'var(--s-3)', padding: '6px 10px', border: '1px solid var(--rule-strong)', borderRadius: 'var(--k-r-s)', font: 'inherit', background: 'var(--paper)', color: 'var(--ink)' }}
              />

              <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="tag warn"
                  style={{ border: 'none', cursor: canPenalty ? 'pointer' : 'not-allowed' }}
                  disabled={!canPenalty || !selected.pv || !isValidAmount(penaltyAmount) || !penaltyReason.trim() || penaltyMutation.isPending}
                  onClick={() =>
                    penaltyMutation.mutate({
                      id: selected.id,
                      companyCode: penaltyCompany === 'A' ? selected.companyA : selected.companyB,
                      amount: Number(penaltyAmount),
                      reason: penaltyReason,
                    })
                  }
                >
                  {t('commission.action.penalty.submit')}
                </button>

                {!canSignPv ? (
                  <span className="note warn" style={{ display: 'inline-flex' }}>
                    {t('commission.forbidden.pvSign')}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="tag ok"
                  style={{ border: 'none', cursor: canSignPv && selected.status === 'PRONONCE' && !selected.pv ? 'pointer' : 'not-allowed' }}
                  disabled={!canSignPv || selected.status !== 'PRONONCE' || !!selected.pv || pvSignMutation.isPending}
                  onClick={() => pvSignMutation.mutate(selected.id)}
                >
                  {t('commission.action.pvSign')}
                </button>
              </div>
              {canSignPv && !selected.pv ? (
                <p style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)', marginBottom: 0 }}>
                  {selected.status === 'PRONONCE' ? t('commission.pvSign.fourEyesHint') : t('commission.pvSign.requiresDecision')}
                </p>
              ) : null}
            </div>

            {/*
              QUESTIONS_UAR.md §9, décision Product Owner 2026-10-18 : pièces
              manuelles (PV de commission) attachées à CE dossier — jamais à un
              Recours depuis cet écran (voir `AttachmentsPanel`).
            */}
            <div style={{ marginTop: 'var(--s-4)', paddingTop: 'var(--s-4)', borderTop: '1px solid var(--rule)' }}>
              <strong style={{ display: 'block', marginBottom: 'var(--s-2)', fontSize: 'var(--k-fs-s)' }}>{t('commission.detail.attachments')}</strong>
              <AttachmentsPanel commissionCaseId={selected.id} />
            </div>
          </>
        ) : null}
      </Modal>
    </>
  );
}
