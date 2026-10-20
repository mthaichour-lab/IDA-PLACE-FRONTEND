'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
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
import { buildCsv, downloadCsv } from '@/lib/csv';
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
  MembershipRequest,
  OppositionMotif,
  Paginated,
  RecoursItem,
  Sanction,
  SanctionStatus,
} from '@/lib/types';

const PAGE_SIZE = 6; // pagination fixe 6/p — A.5

/**
 * Délai de conciliation de l'Art. 24 (15 jours à compter de la saisine,
 * `createdAt`) — MÊME constante que le back (`ART24_CONCILIATION_DAYS`,
 * `commission.service.ts`), qui s'en sert pour le KPI « Hors délai 15 j »
 * (`overdue15dCount`). La colonne « Conciliation (15 j) » n'en fait qu'un
 * calcul d'affichage (barre + jours restants), jamais un état métier.
 */
const ART24_CONCILIATION_DAYS = 15;
const DAY_MS = 86_400_000;

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

/** « 240 850 DA » (unité de la maquette). */
function formatDzd(amount: number, locale: string): string {
  return `${new Intl.NumberFormat(locale, centimes(amount)).format(amount)} DA`;
}

/** « 11 oct. 2026 ». */
function formatDay(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Référence courte affichée (8 premiers caractères de l'identifiant réel, valeur complète en infobulle) — même idiome que `/monthly`. */
function shortRef(id: string): string {
  return id.slice(0, 8);
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

  /**
   * Compteur de l'onglet « Adhésions & retraits » (maquette) : total RÉEL
   * des demandes (`GET /commission/membership-requests`, page de 1 ligne —
   * seul `total` est lu). Clé sous `['commission', 'membership']` : la
   * création/décision d'une demande (`MembershipTab`) l'invalide aussi.
   */
  const membershipCountQuery = useQuery({
    queryKey: ['commission', 'membership', 'count'],
    queryFn: () => apiGet<Paginated<MembershipRequest>>('/commission/membership-requests', { page: 1, pageSize: 1 }),
  });

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
      {
        key: 'case',
        header: t('commission.col.case'),
        render: (r) => (
          <span className="cm-ref">
            <span className="mono" title={r.id}>
              {shortRef(r.id)}
            </span>
            <span className="mono cm-ref-sub" title={r.recoursId}>
              {shortRef(r.recoursId)}
            </span>
          </span>
        ),
      },
      {
        key: 'parties',
        header: t('commission.col.parties'),
        render: (r) => (
          <span className="cm-parties">
            <CoChip code={r.companyA} color={companyByCode.get(r.companyA)?.color} name={companyByCode.get(r.companyA)?.name} />
            <span aria-hidden="true">/</span>
            <CoChip code={r.companyB} color={companyByCode.get(r.companyB)?.color} name={companyByCode.get(r.companyB)?.name} />
          </span>
        ),
      },
      { key: 'amount', header: t('commission.col.amount'), render: (r) => <span className="mono cm-amount">{formatDzd(r.amount, locale)}</span> },
      { key: 'status', header: t('commission.col.status'), render: (r) => <PhaseTag status={r.status} label={t(`commission.status.${r.status}` as TranslationKey)} /> },
      { key: 'conciliation', header: t('commission.col.conciliation'), render: (r) => <ConciliationCell row={r} t={t} locale={locale} /> },
    ],
    [t, locale, companyByCode],
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
      { key: 'orderedAt', header: t('commission.sanctions.col.orderedAt'), render: (s) => formatDay(s.orderedAt, locale) },
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
              className="btn-soft"
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
    <div className="cm-screen">
      <FolioHeader badge="Module E · §6.7" title={t('commission.title')} subtitle={t('commission.subtitle')} />

      <Tabs
        items={[
          { key: 'role', label: t('commission.tab.role'), count: summaryQuery.data?.pendingCount },
          { key: 'sanctions', label: t('commission.tab.sanctions'), count: sanctionsQuery.data?.total },
          { key: 'membership', label: t('commission.tab.membership'), count: membershipCountQuery.data?.total },
        ]}
        activeKey={tab}
        onChange={changeTab}
      />

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

      {tab === 'membership' ? (
        <div className="sheet">
          <div className="sheet-body">
            <MembershipTab />
          </div>
        </div>
      ) : tab === 'sanctions' ? (
        <div className="sheet">
          <div className="sheet-head">
            <span>{t('commission.sanctions.title')}</span>
            <span className="head-chip">{t('commission.sanctions.article')}</span>
          </div>
          <div className="sheet-body flush">
            {sanctionsQuery.isLoading ? (
              <p className="pad">{t('common.loading')}</p>
            ) : sanctionsQuery.error ? (
              <div className="pad">
                <div className="note ko" role="alert">
                  <span>{t('common.error')}</span>
                  <button type="button" onClick={() => sanctionsQuery.refetch()}>
                    {t('common.retry')}
                  </button>
                </div>
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
        <>
          <div className="sheet cm-role">
            <div className="sheet-head">
              <span>{t('commission.role.title')}</span>
              <span className="cm-head-actions">
                <button
                  type="button"
                  className="cm-ghost"
                  disabled={pageRows.length === 0}
                  title={t('common.exportExcel.note')}
                  onClick={() =>
                    downloadCsv(
                      `role-commission-p${page}.csv`,
                      buildCsv(
                        ['affaire', 'recours', 'compagnie_a', 'compagnie_b', 'enjeu', 'phase', 'saisine', 'seance_prevue'],
                        pageRows.map((r) => [r.id, r.recoursId, r.companyA, r.companyB, r.amount, r.status, r.createdAt, r.scheduledAt]),
                      ),
                    )
                  }
                >
                  <Download size={15} strokeWidth={2} aria-hidden="true" />
                  {t('common.exportExcel')}
                </button>
                <span className="head-chip">{t('commission.role.article')}</span>
              </span>
            </div>
            <div className="sheet-body flush">
              {casesQuery.isLoading ? (
                <p className="pad">{t('common.loading')}</p>
              ) : casesQuery.error ? (
                <div className="pad">
                  <div className="note ko" role="alert">
                    <span>{t('common.error')}</span>
                    <button type="button" onClick={() => casesQuery.refetch()}>
                      {t('common.retry')}
                    </button>
                  </div>
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
                  selectedKey={selected?.id}
                />
              )}
            </div>
          </div>

          <div className="sheet cm-detail">
            <div className="sheet-head">
              <span>
                {selected ? (
                  <>
                    {t('commission.detail.titlePrefix')}
                    <span className="mono" title={selected.id}>
                      {shortRef(selected.id)}
                    </span>
                  </>
                ) : (
                  t('commission.panel.title')
                )}
              </span>
              {selected ? <PhaseTag status={selected.status} label={t(`commission.status.${selected.status}` as TranslationKey)} /> : null}
            </div>
            <div className="sheet-body">
              {!selected ? (
                <p className="muted">{t('commission.panel.empty')}</p>
              ) : (
                <>
                  <div className="cm-meta">
                    <span>
                      {t('commission.col.scheduledAt')} : {new Date(selected.scheduledAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                    <span className="cm-meta-right">
                      {t('commission.detail.saisine')} {formatDay(selected.createdAt, locale)} · {t('commission.detail.deadline')}{' '}
                      {formatDay(new Date(new Date(selected.createdAt).getTime() + ART24_CONCILIATION_DAYS * DAY_MS).toISOString(), locale)}
                      <span className="head-chip">{t('commission.concil.article')}</span>
                    </span>
                  </div>

                  <div className="cm-parties-grid">
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

                  <div className="cm-thread-head">
                    <h3>{t('commission.thread.title')}</h3>
                    <span className="cm-count">
                      {documents.length} {t('commission.pieces.count')}
                    </span>
                  </div>
                  <div className="cm-thread">
                    <ExchangeThread events={threadEvents} locale={locale} emptyLabel={t('commission.thread.empty')} />
                  </div>

                  <div className="cm-decide">
                    <div className="cm-box">
                      <h3>{t('commission.action.penalty.title')}</h3>
                      <dl className="cm-dl">
                        <Field label={t('commission.col.amount')}>
                          <span className="mono">{formatDzd(selected.amount, locale)}</span>
                        </Field>
                        <Field label={t('commission.detail.recours')}>
                          <span className="mono" title={selected.claimId}>
                            {shortRef(selected.claimId)}
                          </span>
                        </Field>
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

                      {!canPenalty ? <p className="note warn">{t('commission.forbidden.penalty')}</p> : null}
                      {canPenalty && !selected.pv ? <p className="cm-hint">{t('commission.penalty.requiresPv')}</p> : null}

                      <div className="cm-form">
                        <label htmlFor="penalty-company">{t('commission.action.penalty.company')}</label>
                        <select id="penalty-company" value={penaltyCompany} onChange={(e) => setPenaltyCompany(e.target.value as 'A' | 'B')} disabled={!canPenalty}>
                          <option value="A">{selected.companyA}</option>
                          <option value="B">{selected.companyB}</option>
                        </select>

                        <label htmlFor="penalty-amount">{t('commission.action.penalty.amount')}</label>
                        <input
                          id="penalty-amount"
                          type="number"
                          min={0.01}
                          step={0.01}
                          aria-invalid={!!penaltyAmount && !isValidAmount(penaltyAmount)}
                          value={penaltyAmount}
                          onChange={(e) => setPenaltyAmount(e.target.value)}
                          disabled={!canPenalty}
                        />

                        <label htmlFor="penalty-reason">{t('commission.action.penalty.reason')}</label>
                        <input id="penalty-reason" type="text" value={penaltyReason} onChange={(e) => setPenaltyReason(e.target.value)} disabled={!canPenalty} />
                      </div>

                      <div className="cm-actions">
                        <button
                          type="button"
                          className="btn-outline"
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
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={!canSignPv || selected.status !== 'PRONONCE' || !!selected.pv || pvSignMutation.isPending}
                          onClick={() => pvSignMutation.mutate(selected.id)}
                        >
                          {t('commission.action.pvSign')}
                        </button>
                      </div>
                      {!canSignPv ? <p className="note warn">{t('commission.forbidden.pvSign')}</p> : null}
                      {canSignPv && !selected.pv ? (
                        <p className="cm-hint">{selected.status === 'PRONONCE' ? t('commission.pvSign.fourEyesHint') : t('commission.pvSign.requiresDecision')}</p>
                      ) : null}
                    </div>

                    {/*
                      QUESTIONS_UAR.md §9, décision Product Owner 2026-10-18 : pièces
                      manuelles (PV de commission) attachées à CE dossier — jamais à un
                      Recours depuis cet écran (voir `AttachmentsPanel`).
                    */}
                    <div className="cm-box">
                      <h3>{t('commission.detail.attachments')}</h3>
                      <AttachmentsPanel commissionCaseId={selected.id} />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Phase d'une affaire (maquette) : pastille grise à point pour l'instruction/l'audience, cartouche teal bordé pour une affaire conciliée. */
function PhaseTag({ status, label }: { status: CommissionCaseStatus; label: string }) {
  return <span className={`cm-phase ${status === 'PRONONCE' ? 'done' : status === 'EN_DELIBERE' ? 'hearing' : 'open'}`}>{label}</span>;
}

type T = ReturnType<typeof useI18n>['t'];

/**
 * Colonne « Conciliation (15 j) » : délai de l'Art. 24 à compter de la
 * saisine (`createdAt`) — calcul d'affichage uniquement (même constante
 * que le back), l'état réel restant `status`. Une affaire tranchée affiche
 * sa date de décision réelle (`decidedAt`) et la durée écoulée.
 */
function ConciliationCell({ row, t, locale }: { row: CommissionCase; t: T; locale: string }) {
  const start = new Date(row.createdAt).getTime();
  if (row.status === 'PRONONCE' && row.decidedAt) {
    const days = Math.max(0, Math.round((new Date(row.decidedAt).getTime() - start) / DAY_MS));
    return (
      <span className="cm-decided">
        {t('commission.concil.decided')} {formatDay(row.decidedAt, locale)} ({days} {t('commission.concil.daysShort')})
      </span>
    );
  }
  const deadline = start + ART24_CONCILIATION_DAYS * DAY_MS;
  const now = Date.now();
  const percent = Math.round((Math.min(Math.max(0, now - start), deadline - start) / (deadline - start)) * 100);
  const remaining = Math.ceil((deadline - now) / DAY_MS);
  const overdue = remaining <= 0;
  const overdueDays = Math.max(1, Math.floor((now - deadline) / DAY_MS));
  return (
    <div className={`cm-concil${overdue ? ' ko' : ''}`}>
      <div className="cm-concil-top">
        <span className="cm-concil-label">
          {t('commission.concil.label')} <span>· {t('commission.concil.article')}</span>
        </span>
        <span className="mono cm-concil-left">
          {overdue
            ? `${t('commission.concil.overduePrefix')}${overdueDays} ${t(overdueDays > 1 ? 'commission.concil.days' : 'commission.concil.day')}`
            : `J-${remaining} · ${remaining} ${t('commission.concil.remaining')}`}
        </span>
      </div>
      <div className="cm-concil-track" role="presentation">
        <div style={{ width: `${overdue ? 100 : percent}%` }} />
      </div>
      <div className="cm-concil-dates mono">
        <span>{formatDay(row.createdAt, locale)}</span>
        <span>
          {t('commission.concil.deadline')} {formatDay(new Date(deadline).toISOString(), locale)}
        </span>
      </div>
    </div>
  );
}

/** Carte d'une partie au dossier (Créancier/assureur direct = `companyA`, débiteur/assureur tiers = `companyB`) — nom/couleur réels (SEC-26/SEC-50), phrase réelle optionnelle (voir `directPartySummary`/`tiersPartySummary`). */
function PartyCard({ title, code, name, color, summary }: { title: string; code: string; name?: string; color?: string; summary?: string }) {
  return (
    <div className="cm-party">
      <div className="cm-party-head">
        <CoChip code={code} color={color} name={name} />
        <div>
          <strong>{name ?? code}</strong>
          <span>{title}</span>
        </div>
      </div>
      {summary ? <p>{summary}</p> : null}
    </div>
  );
}
