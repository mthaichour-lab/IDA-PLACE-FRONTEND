'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { ExchangeEvent, ExchangeThread } from '@/components/shared/ExchangeThread';
import { FolioHeader } from '@/components/FolioHeader';
import { MembershipTab } from '@/components/commission/MembershipTab';
import { AttachmentsPanel } from '@/components/documents/AttachmentsPanel';
import { CoChip } from '@/components/ui/CoChip';
import { Kpi, KpiRow } from '@/components/ui/Kpi';
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
import { buildRecoursExchangeEvents, oppositionBody } from '@/lib/recours-timeline';
import {
  CommissionCase,
  CommissionCaseStatus,
  CommissionPenaltyResult,
  CommissionPvSignResult,
  CommissionSummary,
  CompanyView,
  DocumentView,
  OppositionMotif,
  Paginated,
  RecoursItem,
  Sanction,
  SanctionStatus,
} from '@/lib/types';

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

/** SEC-06 : montants à deux décimales au plus — centimes affichés seulement s'il y en a. */
function centimes(amount: number): { minimumFractionDigits: number; maximumFractionDigits: number } {
  const digits = Number.isInteger(amount) ? 0 : 2;
  return { minimumFractionDigits: digits, maximumFractionDigits: digits };
}

function formatDzd(amount: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'DZD', ...centimes(amount) }).format(amount);
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
  const meCompany = isCompanyActor(me) ? me?.company : undefined;

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

  /**
   * Compteur de l'onglet Sanctions dans la capture de référence (bandeau
   * d'onglets) : la liste réelle (`GET /commission/sanctions`, déjà
   * existante côté back) est désormais chargée indépendamment de l'onglet
   * actif — seule cette façon d'avoir le total réel pour le badge de
   * l'onglet avant même de l'avoir ouvert (même liste, réutilisée ensuite
   * par le tableau de l'onglet Sanctions, pas de second fetch).
   */
  const sanctionsQuery = useQuery({
    queryKey: ['commission', 'sanctions', sanctionsPage],
    queryFn: () => apiGet<Paginated<Sanction>>('/commission/sanctions', { page: sanctionsPage, pageSize: PAGE_SIZE }),
  });

  const sanctionRows = sanctionsQuery.data?.items ?? [];

  /** Noms/couleurs réels des compagnies (SEC-26/SEC-50) — cartes des parties du panneau de détail. */
  const companiesQuery = useQuery({
    queryKey: ['referential', 'companies', 'all'],
    queryFn: () => apiGet<Paginated<CompanyView>>('/referential/companies', { page: 1, pageSize: 100 }),
  });
  const companyByCode = useMemo(() => new Map((companiesQuery.data?.items ?? []).map((c) => [c.code, c])), [companiesQuery.data]);

  /**
   * Recours lié (`GET /recours/:id`) — alimente le fil d'échanges partagé
   * (`ExchangeThread`) avec les MÊMES évènements réels qu'`/exchanges`
   * (Annexe 2/3/4), et les phrases réelles des cartes « Assureur direct »/
   * « Assureur tiers » (motif d'opposition/contestation du recours, jamais
   * un champ `CommissionCase` inventé). Accessible à la Commission (rôle
   * place) comme aux parties au recours (`RecoursService.getForUser`).
   */
  const linkedRecoursQuery = useQuery({
    queryKey: ['recours', 'detail', selected?.recoursId],
    queryFn: () => apiGet<RecoursItem>(apiPath`/recours/${selected!.recoursId}`),
    enabled: !!selected,
  });

  const motifsQuery = useQuery({
    queryKey: ['referential', 'opposition-motifs'],
    queryFn: () => apiGet<OppositionMotif[]>('/referential/opposition-motifs'),
    enabled: !!selected,
  });
  const motifLabels = useMemo(() => new Map((motifsQuery.data ?? []).map((m) => [m.code, m.label])), [motifsQuery.data]);

  /**
   * Pièces du dossier (`GET /documents?commissionCaseId=X`) — même clé de
   * requête que `AttachmentsPanel` (cache partagé, pas de second fetch) :
   * sert le compte total affiché près de l'en-tête ET le fil de pièces
   * échangées (nom réel du déposant `uploadedBy`, jamais un nom inventé).
   */
  const documentsQuery = useQuery({
    queryKey: ['documents', 'commissionCase', selected?.id],
    queryFn: () => apiGet<DocumentView[]>('/documents', { commissionCaseId: selected!.id }),
    enabled: !!selected,
  });
  const documents = documentsQuery.data ?? [];

  // Sélection par défaut de la première affaire visible (fidélité à la
  // capture) — seulement quand rien n'est encore sélectionné.
  useEffect(() => {
    if (tab === 'role' && !selected && pageRows.length > 0) setSelected(pageRows[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, pageRows, selected]);

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

  function changeTab(next: string) {
    setTab(next as CommissionTab);
  }

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
  const linkedRecours = linkedRecoursQuery.data;

  /**
   * Phrase réelle de la carte « Assureur direct » (compagnie `from` du
   * recours lié = `CommissionCase.companyA`) : les DEUX annexes citées sont
   * garanties réelles pour un dossier en commission (un recours n'atteint
   * l'état COMMISSION qu'après une contestation, Art. `transmettre_commission`,
   * `recours.rules.ts`) — vérifié sur `linkedRecours.contestation`, jamais
   * supposé sans lire le champ.
   */
  function directPartySummary(): string | undefined {
    if (!linkedRecours) return undefined;
    const parts = [t('commission.party.demandIndemnisation')];
    if (linkedRecours.contestation) parts.push(t('commission.party.contesteOpposition'));
    return parts.join(' ');
  }

  /** Phrase réelle de la carte « Assureur tiers » (compagnie `to` = `companyB`) — motif d'opposition RÉEL, jamais fabriqué. */
  function tiersPartySummary(): string | undefined {
    if (!linkedRecours?.opposition) return undefined;
    const body = oppositionBody(linkedRecours.opposition, motifLabels);
    return body ? `${t('commission.party.oppose')} ${body}` : undefined;
  }

  const threadEvents = useMemo<ExchangeEvent[]>(() => {
    const events: ExchangeEvent[] = linkedRecours ? buildRecoursExchangeEvents(linkedRecours, { t, motifLabels, meCompany }) : [];
    const documentEvents: ExchangeEvent[] = documents.map((d) => ({
      key: d.id,
      at: d.uploadedAt,
      side: 'center',
      tone: 'neutral',
      authorLabel: d.uploadedBy,
      label: t('documents.attachments.title'),
      attachments: [{ id: d.id, filename: d.filename, sizeBytes: d.sizeBytes }],
    }));
    return [...events, ...documentEvents];
  }, [linkedRecours, documents, t, motifLabels, meCompany]);

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
              { key: 'role', label: t('commission.tab.role'), count: summaryQuery.data?.pendingCount },
              { key: 'sanctions', label: t('commission.tab.sanctions'), count: sanctionsQuery.data?.total },
              { key: 'membership', label: t('commission.tab.membership') },
            ]}
            activeKey={tab}
            onChange={changeTab}
          />
        </div>
      </div>

      {tab === 'membership' ? (
        <div className="sheet" style={{ marginTop: 'var(--s-5)' }}>
          <div className="sheet-body">
            <MembershipTab />
          </div>
        </div>
      ) : tab === 'sanctions' ? (
        <div className="sheet" style={{ marginTop: 'var(--s-5)' }}>
          <div className="sheet-body">
            {sanctionsQuery.isLoading ? (
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
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(360px, 460px)', gap: 'var(--s-5)', marginTop: 'var(--s-5)', alignItems: 'start' }}>
          <div className="sheet">
            <div className="sheet-body">
              {casesQuery.isLoading ? (
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
              )}
            </div>
          </div>

          <div className="sheet" style={{ position: 'sticky', top: 'var(--s-5)' }}>
            <div className="sheet-head">
              <strong>{selected ? `${t('commission.col.case')} ${selected.recoursId}` : t('commission.panel.title')}</strong>
              {selected ? <Tag tone={statusTone(selected.status)}>{t(`commission.status.${selected.status}` as TranslationKey)}</Tag> : null}
            </div>
            <div className="sheet-body">
              {!selected ? (
                <p style={{ color: 'var(--ink-3)' }}>{t('commission.panel.empty')}</p>
              ) : (
                <>
                  <div className="mono" style={{ fontSize: 'var(--k-fs-2xl)', fontWeight: 700, marginBottom: 'var(--s-4)' }}>
                    {formatDzd(selected.amount, locale)}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s-3)', marginBottom: 'var(--s-3)' }}>
                    <PartyCard
                      title={t('commission.party.direct')}
                      code={selected.companyA}
                      name={companyByCode.get(selected.companyA)?.name}
                      color={companyByCode.get(selected.companyA)?.color}
                      summary={directPartySummary()}
                    />
                    <PartyCard
                      title={t('commission.party.tiers')}
                      code={selected.companyB}
                      name={companyByCode.get(selected.companyB)?.name}
                      color={companyByCode.get(selected.companyB)?.color}
                      summary={tiersPartySummary()}
                    />
                  </div>

                  <p style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)', marginTop: 0, marginBottom: 'var(--s-4)' }}>
                    {documents.length} {t('commission.pieces.count')}
                  </p>

                  <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--s-3)', marginBottom: 'var(--s-4)' }}>
                    <Field label={t('commission.detail.recours')}>
                      <span className="mono">{selected.claimId}</span>
                    </Field>
                    <Field label={t('commission.detail.saisine')}>{new Date(selected.createdAt).toLocaleDateString(locale)}</Field>
                    <Field label={t('commission.col.scheduledAt')}>{new Date(selected.scheduledAt).toLocaleString(locale)}</Field>
                  </dl>

                  {selectedDecision?.penalty ? (
                    <p className="note warn">
                      <strong>{t(selectedDecision.penalty.status === 'PRONONCEE' ? 'commission.decision.penaltyIssued' : 'commission.decision.penaltyProposed')}</strong> : {formatDzd(selectedDecision.penalty.amount, locale)} — {selectedDecision.penalty.reason}
                    </p>
                  ) : null}
                  {selected.pv ? (
                    <p className="note ok">
                      <strong>{t('commission.decision.pvSigned')}</strong> : {new Date(selected.pv.signedAt).toLocaleString(locale)} ({selected.pv.ref})
                    </p>
                  ) : null}

                  <div style={{ marginBottom: 'var(--s-4)' }}>
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

                  <div style={{ marginBottom: 'var(--s-4)' }}>
                    <strong style={{ display: 'block', marginBottom: 'var(--s-2)', fontSize: 'var(--k-fs-s)' }}>{t('commission.thread.title')}</strong>
                    <ExchangeThread events={threadEvents} locale={locale} emptyLabel={t('commission.thread.empty')} />
                  </div>

                  {/*
                    QUESTIONS_UAR.md §9, décision Product Owner 2026-10-18 : pièces
                    manuelles (PV de commission) attachées à CE dossier — jamais à un
                    Recours depuis cet écran (voir `AttachmentsPanel`).
                  */}
                  <div style={{ paddingTop: 'var(--s-4)', borderTop: '1px solid var(--rule)' }}>
                    <strong style={{ display: 'block', marginBottom: 'var(--s-2)', fontSize: 'var(--k-fs-s)' }}>{t('commission.detail.attachments')}</strong>
                    <AttachmentsPanel commissionCaseId={selected.id} />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)' }}>{label}</dt>
      <dd style={{ margin: 0 }}>{children}</dd>
    </div>
  );
}

/** Carte d'une partie au dossier (Créancier/assureur direct = `companyA`, débiteur/assureur tiers = `companyB`) — nom/couleur réels (SEC-26/SEC-50), phrase réelle optionnelle (voir `directPartySummary`/`tiersPartySummary`). */
function PartyCard({ title, code, name, color, summary }: { title: string; code: string; name?: string; color?: string; summary?: string }) {
  return (
    <div style={{ border: '1px solid var(--rule)', borderRadius: 'var(--k-r-s)', padding: 'var(--s-3)' }}>
      <div style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)', marginBottom: 4 }}>{title}</div>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
        <CoChip code={code} color={color} /> {name ?? code}
      </div>
      {summary ? (
        <p style={{ margin: '6px 0 0', fontSize: 'var(--k-fs-s)', color: 'var(--ink-2)' }}>{summary}</p>
      ) : null}
    </div>
  );
}
