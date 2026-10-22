'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleCheck, CircleSlash, Download, FileText } from 'lucide-react';
import { useMemo, useState } from 'react';
import { FolioHeader } from '@/components/FolioHeader';
import { CoChip } from '@/components/ui/CoChip';
import { Kpi, KpiRow } from '@/components/ui/Kpi';
import { Table, Column } from '@/components/ui/Table';
import { TruncationNote } from '@/components/ui/TruncationNote';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { apiGet, apiPath, apiPost } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { isCompanyActor } from '@/lib/recours-actions';
import { buildCsv, downloadCsv } from '@/lib/csv';
import { describeApiError } from '@/lib/error-message';
import { fetchAllPages } from '@/lib/paginate';
import {
  RecoursItem,
  SettlementMonthly,
  SettlementMonthlyAnnexe7,
  SettlementMonthlyAnnexe7Pair,
  SettlementMonthlyCompany,
  SettlementMonthlySummary,
} from '@/lib/types';

const PAGE_SIZE = 6; // pagination fixe 6/p — A.5

/** Montant + unité « DA » (maquette) — le nombre reste formaté par `Intl` (séparateurs de la langue). */
function formatDzd(amount: number, locale: string): string {
  try {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(amount)} DA`;
  } catch {
    return `${amount.toLocaleString()} DA`;
  }
}

/**
 * KPI « Montant de la synthèse » en notation compacte à partir du million
 * (« 1,62 M DA », maquette) — simple mise en forme du total renvoyé par
 * `/summary` ; le montant exact reste lisible en infobulle (`title`).
 */
function compactDzd(amount: number, locale: string): string {
  if (Math.abs(amount) < 1_000_000) return formatDzd(amount, locale);
  try {
    return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount / 1_000_000)} M DA`;
  } catch {
    return formatDzd(amount, locale);
  }
}

/** Date calendaire « AAAA-MM-JJ » (ou ISO) affichée « 5 nov. 2026 », lue en UTC pour ne jamais décaler le jour. */
function isoDate(iso: string, locale: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Horodatage « 6 oct. 2026 09:39 » (maquette). */
function dateTime(iso: string, locale: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })} ${d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`;
}

/** « octobre 2026 » pour la période « AAAA-MM » (titre, comme la maquette). */
function periodLabel(period: string, locale: string): string {
  const [y, m] = period.split('-').map(Number);
  if (!y || !m) return period;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Position d'affichage d'une échéance entre deux dates déjà connues (même
 * calcul que `CountdownBar`) — purement présentationnel, ne tranche aucune
 * règle Art. 16.
 */
function meterInfo(startAt: string, deadlineAt: string, now: Date = new Date()) {
  const start = new Date(startAt.length === 10 ? `${startAt}T00:00:00Z` : startAt).getTime();
  const end = new Date(deadlineAt.length === 10 ? `${deadlineAt}T00:00:00Z` : deadlineAt).getTime();
  const span = Math.max(1, end - start);
  const elapsed = Math.min(span, Math.max(0, now.getTime() - start));
  const percent = Math.round((elapsed / span) * 100);
  const remainingMs = end - now.getTime();
  const overdue = remainingMs <= 0;
  const remainingDays = Math.ceil(Math.abs(remainingMs) / (24 * 60 * 60 * 1000));
  const tone = overdue ? 'ko' : percent >= 75 ? 'warn' : 'pri';
  return { percent, overdue, remainingDays, tone };
}

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Premier jour calendaire de la période "AAAA-MM" — formatage pur, même convention que `computeInsertionDeadline` (back). */
function firstDayOfPeriodIso(period: string): string {
  return `${period}-01`;
}

/** Dernier jour calendaire de la période "AAAA-MM" — formatage pur (jour 0 du mois suivant), aucune règle métier inventée. */
function lastDayOfPeriodIso(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * Premier jour où la clôture est acceptée : le lendemain du dernier jour du
 * mois — même règle que le back (`isPeriodElapsed` : aujourd'hui UTC >
 * dernier jour), sinon 409 PERIODE_NON_ECHUE.
 */
function closableFromIso(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}

function isPeriodElapsed(period: string): boolean {
  return new Date().toISOString().slice(0, 10) > lastDayOfPeriodIso(period);
}

/**
 * Un recours réglé appartient-il au mois `period` (comparaison UTC
 * année/mois) ? Même convention que `isIsoDateInMonth` (back
 * `settlement.rules.ts`) — reproduite ici UNIQUEMENT pour regrouper
 * l'affichage des recours déjà renvoyés par `/recours` (jamais pour
 * recalculer un KPI : les totaux affichés restent ceux de
 * `/settlement/monthly/:period/summary`).
 */
function isInPeriod(iso: string, period: string): boolean {
  const d = new Date(iso);
  const [y, m] = period.split('-').map(Number);
  return d.getUTCFullYear() === y && d.getUTCMonth() + 1 === m;
}

type LotRow = RecoursItem & { included: boolean };

function lotRowsCsv(rows: LotRow[]): string {
  return buildCsv(
    ['recours', 'creancier', 'debiteur', 'regle_le', 'insere_le', 'montant', 'etat'],
    rows.map((r) => [r.id, r.from, r.to, r.settledAt ?? '', r.createdAt, r.amount, r.included ? 'INTEGRE' : 'EXCLU_OPPOSITION']),
  );
}

function annexe7Csv(pairs: SettlementMonthlyAnnexe7Pair[]): string {
  return buildCsv(
    ['creancier', 'debiteur', 'nombre', 'montant'],
    pairs.map((p) => [p.from, p.to, p.count, p.totalAmount]),
  );
}

function companiesCsv(companies: SettlementMonthlyCompany[]): string {
  return buildCsv(
    ['compagnie', 'recours_regles', 'montant_total', 'etat', 'cloture_le', 'bordereau'],
    companies.map((c) => [c.code, c.claimsCount, c.totalAmount, c.status, c.closedAt ?? '', c.bordereauRef ?? '']),
  );
}

export default function MonthlyPage() {
  const { t, locale } = useI18n();
  const { me, hasPrivilege } = useAuth();
  const { toast } = useToast();
  const lotCompany = isCompanyActor(me) ? me?.company : undefined;
  const queryClient = useQueryClient();

  const [period, setPeriod] = useState(currentPeriod);
  const [page, setPage] = useState(1);
  const [lotPage, setLotPage] = useState(1);
  const [annexe7Page, setAnnexe7Page] = useState(1);

  const canGenerate = hasPrivilege('synth');
  const elapsed = isPeriodElapsed(period);

  const monthlyQuery = useQuery({
    queryKey: ['settlement', 'monthly', period],
    queryFn: () => apiGet<SettlementMonthly>(apiPath`/settlement/monthly/${period}`),
  });

  // Compléments additifs (`/summary`, `/annexe7`) — voir HANDOFF.md et
  // `src/lib/types.ts` : `SettlementMonthly` ci-dessus reste le contrat figé
  // inchangé, ces deux endpoints vivent sur des routes séparées.
  const summaryQuery = useQuery({
    queryKey: ['settlement', 'monthly', period, 'summary'],
    queryFn: () => apiGet<SettlementMonthlySummary>(apiPath`/settlement/monthly/${period}/summary`),
  });

  const annexe7Query = useQuery({
    queryKey: ['settlement', 'monthly', period, 'annexe7'],
    queryFn: () => apiGet<SettlementMonthlyAnnexe7>(apiPath`/settlement/monthly/${period}/annexe7`),
  });

  /**
   * "Recours du lot" (section additive, fidélité à la capture écran 5) —
   * réutilise `GET /recours` (RecoursModule, déjà scopé par compagnie
   * SEC-43) plutôt qu'un nouvel endpoint : les recours RÉGLÉS du mois
   * (filtrés côté client sur `settledAt`, même convention que le KPI
   * `summary.settledCount`) UNIS aux recours actuellement en OPPOSITION
   * (`summary.excludedOppositionCount`, toutes périodes). `fetchAllPages`
   * (déjà utilisé par `/exchanges`) : jamais un `pageSize` géant refusé par
   * l'API (SEC-13).
   */
  const lotRegleQuery = useQuery({
    queryKey: ['recours', 'list', 'REGLE', 'all'],
    queryFn: () => fetchAllPages<RecoursItem>('/recours', { filter: 'REGLE' }),
  });
  const lotOppositionQuery = useQuery({
    queryKey: ['recours', 'list', 'OPPOSITION', 'all'],
    queryFn: () => fetchAllPages<RecoursItem>('/recours', { filter: 'OPPOSITION' }),
  });

  // Clôture par compagnie — forme réelle : `POST /settlement/monthly/:period/close`
  // avec `{company}` (idempotent, 409 si déjà clôturée), pas un bordereau
  // global pour toute la place.
  const closeMutation = useMutation({
    mutationFn: (company: string) => apiPost(apiPath`/settlement/monthly/${period}/close`, { company }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settlement', 'monthly', period] });
      toast(t('monthly.toast.generated'), 'ok');
    },
    // 409 PERIODE_NON_ECHUE (mois non échu) ou déjà clôturé : message traduit / du backend.
    onError: (err: unknown) => toast(describeApiError(err, t, t('monthly.toast.error')), 'ko'),
  });

  const companies = monthlyQuery.data?.companies ?? [];
  const pageRows = companies.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const closedCount = companies.filter((c) => c.status === 'CLOTURE').length;

  const lotRows: LotRow[] = useMemo(() => {
    // Même périmètre que `summary.settledCount` (back `monthlySummary`) : une
    // compagnie ne saisit au titre de l'Art. 16 que les recours dont elle est
    // CRÉANCIÈRE ; ceux où elle est débitrice figurent dans la synthèse de
    // l'autre partie, pas dans son propre lot.
    const settled = (lotRegleQuery.data?.items ?? [])
      .filter((r) => isInPeriod(r.settledAt ?? r.requestSentAt, period) && (!lotCompany || r.from === lotCompany))
      .map((r) => ({ ...r, included: true as const }));
    const excluded = (lotOppositionQuery.data?.items ?? []).map((r) => ({ ...r, included: false as const }));
    return [...settled, ...excluded].sort((a, b) => (b.settledAt ?? b.createdAt).localeCompare(a.settledAt ?? a.createdAt));
  }, [lotRegleQuery.data, lotOppositionQuery.data, period, lotCompany]);
  const lotPageRows = lotRows.slice((lotPage - 1) * PAGE_SIZE, lotPage * PAGE_SIZE);

  const annexe7Pairs = annexe7Query.data?.pairs ?? [];
  const annexe7PageRows = annexe7Pairs.slice((annexe7Page - 1) * PAGE_SIZE, annexe7Page * PAGE_SIZE);

  const columns: Column<SettlementMonthlyCompany>[] = useMemo(
    () => [
      {
        key: 'company',
        header: t('monthly.col.company'),
        render: (r) => <CoChip code={r.code} withName />,
      },
      { key: 'claimsCount', header: t('monthly.col.claimsCount'), render: (r) => <span className="mono">{r.claimsCount}</span> },
      { key: 'totalAmount', header: t('monthly.col.totalAmount'), render: (r) => <span className="mono">{formatDzd(r.totalAmount, locale)}</span> },
      {
        key: 'status',
        header: t('monthly.col.status'),
        render: (r) =>
          r.status === 'CLOTURE' ? (
            <span className="tag ok mo-status">
              <Check size={12} strokeWidth={2.5} aria-hidden="true" />
              {t('monthly.status.CLOTURE')}
            </span>
          ) : (
            <span className="tag warn mo-status">{t('monthly.status.EN_COURS')}</span>
          ),
      },
      {
        key: 'closedAt',
        header: t('monthly.col.closedAt'),
        render: (r) => (r.closedAt ? <span className="mono mo-date">{dateTime(r.closedAt, locale)}</span> : <span className="mo-dash">—</span>),
      },
      {
        key: 'action',
        header: '',
        render: (r) =>
          r.status === 'CLOTURE' ? (
            <span className="mono mo-ref">{r.bordereauRef}</span>
          ) : (
            <button
              type="button"
              className="btn-soft mo-action"
              disabled={!canGenerate || !elapsed || closeMutation.isPending}
              onClick={() => closeMutation.mutate(r.code)}
              title={!canGenerate ? t('common.forbidden') : !elapsed ? `${t('monthly.progress.step2.deadlineLabel')} ${isoDate(closableFromIso(period), locale)}` : undefined}
            >
              <FileText size={14} strokeWidth={2} aria-hidden="true" />
              {t('monthly.action.generateBordereau')}
            </button>
          ),
      },
    ],
    [t, locale, canGenerate, closeMutation, elapsed, period],
  );

  const lotColumns: Column<LotRow>[] = useMemo(
    () => [
      { key: 'ref', header: t('monthly.lot.col.ref'), render: (r) => <span className="mono" title={r.id}>{r.reference}</span> },
      {
        key: 'pair',
        header: t('monthly.lot.col.pair'),
        render: (r) => (
          <span className="mo-pair">
            <CoChip code={r.from} />
            <span aria-hidden="true" className="mo-arrow">
              →
            </span>
            <CoChip code={r.to} />
          </span>
        ),
      },
      { key: 'settledAt', header: t('monthly.lot.col.settledAt'), render: (r) => (r.settledAt ? <span className="mono">{r.settledAt.slice(0, 10)}</span> : <span className="mo-dash">—</span>) },
      { key: 'insertedAt', header: t('monthly.lot.col.insertedAt'), render: (r) => <span className="mono">{r.createdAt.slice(0, 10)}</span> },
      { key: 'amount', header: t('monthly.lot.col.amount'), render: (r) => <span className="mono">{formatDzd(r.amount, locale)}</span> },
      {
        key: 'state',
        header: t('monthly.lot.col.state'),
        // Icône compacte (la maquette n'a qu'une colonne d'icône), libellé conservé pour les lecteurs d'écran et en infobulle.
        render: (r) => {
          const label = t(r.included ? 'monthly.lot.state.included' : 'monthly.lot.state.excluded');
          return (
            <span className={`mo-lot-state ${r.included ? 'ok' : 'warn'}`} title={label}>
              {r.included ? <CircleCheck size={16} strokeWidth={2} aria-hidden="true" /> : <CircleSlash size={16} strokeWidth={2} aria-hidden="true" />}
              <span className="mo-sr">{label}</span>
            </span>
          );
        },
      },
    ],
    [t, locale],
  );

  const annexe7Columns: Column<SettlementMonthlyAnnexe7Pair>[] = useMemo(
    () => [
      { key: 'creditor', header: t('monthly.annexe7.col.creditor'), render: (p) => <CoChip code={p.from} withName /> },
      { key: 'debtor', header: t('monthly.annexe7.col.debtor'), render: (p) => <CoChip code={p.to} withName /> },
      { key: 'count', header: t('monthly.annexe7.col.count'), render: (p) => <span className="mono">{p.count}</span> },
      { key: 'amount', header: t('monthly.annexe7.col.amount'), render: (p) => <span className="mono">{formatDzd(p.totalAmount, locale)}</span> },
    ],
    [t, locale],
  );

  const summary = summaryQuery.data;
  const allClosed = companies.length > 0 && closedCount === companies.length;
  const closurePct = companies.length > 0 ? Math.round((closedCount / companies.length) * 100) : 0;
  const saisieMeter = summary ? meterInfo(firstDayOfPeriodIso(period), summary.insertionDeadline) : null;

  return (
    <>
      <FolioHeader
        badge="Module C · §6.5"
        title={`${t('monthly.title')} — ${periodLabel(period, locale)}`}
        subtitle={t('monthly.subtitle')}
        actions={
          <div className="mo-period">
            <label htmlFor="monthly-period" className="mo-period-label">
              {t('monthly.period.label')}
            </label>
            <input
              id="monthly-period"
              type="month"
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value);
                setPage(1);
                setLotPage(1);
              }}
            />
          </div>
        }
      />

      {!canGenerate ? <p className="note warn mo-forbidden">{t('common.forbidden')}</p> : null}

      {/*
       * Avancement du lot — la capture de référence montre une frise à 5
       * étapes (Annexe 8, transmission tiers + Commission, scellement
       * définitif) qui sont en réalité celles du Diagramme 2 du lot
       * TRIMESTRIEL (voir `quarter.compensation.gap.note` et le rapport de
       * livraison) : le cycle MENSUEL n'a pas cette entité pipeline côté
       * API. Seules deux étapes sont réelles ici : l'échéance de saisie
       * (`summary.insertionDeadline`) et la clôture par compagnie
       * (`companies[].status`) — jamais une date fabriquée pour les
       * étapes manquantes (règle d'or du projet). L'état visuel d'une
       * étape ne découle QUE de `companies[].status` (toutes clôturées =
       * réalisée), jamais d'une règle de calendrier recalculée ici.
       */}
      <div className="sheet">
        <div className="sheet-head">
          <span>{t('monthly.progress.title')}</span>
        </div>
        <div className="sheet-body">
          <div className="mo-steps">
            <div className={`mo-step ${allClosed ? 'done' : 'current'}`}>
              <span className="mo-step-badge">{allClosed ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : null}</span>
              <div className="mo-step-body">
                <div className="mo-step-kicker">1 · {t('monthly.step.article')}</div>
                <div className="mo-step-title">{t('monthly.step.saisie')}</div>
                <div className="mo-step-meta">{summary ? isoDate(summary.insertionDeadline, locale) : '—'}</div>
              </div>
            </div>
            <div className={`mo-step ${allClosed ? 'done' : closedCount > 0 ? 'current' : ''}`}>
              <span className="mo-step-badge">{allClosed ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : null}</span>
              <div className="mo-step-body">
                <div className="mo-step-kicker">2 · {t('monthly.step.article')}</div>
                <div className="mo-step-title">{t('monthly.step.cloture')}</div>
                <div className="mo-step-meta">{isoDate(lastDayOfPeriodIso(period), locale)}</div>
              </div>
            </div>
          </div>

          <div className="mo-meters">
            <div className={`mo-meter ${saisieMeter?.tone ?? ''}`}>
              <div className="mo-meter-top">
                <span className="mo-meter-label">{t('monthly.progress.step1.label')}</span>
                {saisieMeter ? (
                  <span className="mo-meter-right mono">
                    {saisieMeter.remainingDays} {t(saisieMeter.overdue ? 'exchanges.countdown.overdue' : 'exchanges.countdown.remaining')}
                  </span>
                ) : null}
              </div>
              {summary && saisieMeter ? (
                <>
                  <div className="mo-meter-track">
                    <div className="mo-meter-fill" style={{ width: `${Math.max(0, Math.min(100, saisieMeter.percent))}%` }} />
                  </div>
                  <div className="mo-meter-dates mono">
                    <span>{isoDate(firstDayOfPeriodIso(period), locale)}</span>
                    <span>
                      {t('monthly.meter.dueOn')} {isoDate(summary.insertionDeadline, locale)}
                    </span>
                  </div>
                </>
              ) : (
                <p className="muted">{t('common.loading')}</p>
              )}
            </div>

            <div className={`mo-meter ${allClosed ? 'ok' : 'pri'}`}>
              <div className="mo-meter-top">
                <span className="mo-meter-label">{t('monthly.progress.step2.label')}</span>
                <span className="mo-meter-right mono">
                  {closedCount}/{companies.length} {t('monthly.progress.step2.closedSuffix')}
                </span>
              </div>
              <div className="mo-meter-track">
                <div className="mo-meter-fill" style={{ width: `${closurePct}%` }} />
              </div>
              <div className="mo-meter-dates mono">
                <span>{isoDate(firstDayOfPeriodIso(period), locale)}</span>
                <span>
                  {t('monthly.progress.step2.deadlineLabel')} {isoDate(closableFromIso(period), locale)}
                </span>
              </div>
            </div>
          </div>

          <p className="mo-gap-note">{t('monthly.progress.gap.note')}</p>
        </div>
      </div>

      {summaryQuery.isLoading ? (
        <p className="muted mo-kpi-state">{t('common.loading')}</p>
      ) : summaryQuery.error || !summary ? (
        <div className="note ko mo-kpi-state" role="alert">
          <span>{t('common.error')}</span>
          <button type="button" onClick={() => summaryQuery.refetch()}>
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <KpiRow>
          <Kpi value={summary.settledCount} label={t('monthly.kpi.settledCount')} />
          <Kpi value={compactDzd(summary.totalAmount, locale)} title={formatDzd(summary.totalAmount, locale)} label={t('monthly.kpi.totalAmount')} />
          <Kpi value={summary.excludedOppositionCount} label={t('monthly.kpi.excludedOppositionCount')} />
          <Kpi value={isoDate(summary.insertionDeadline, locale)} label={t('monthly.kpi.insertionDeadline')} extra={t('monthly.kpi.insertionDeadline.extra')} />
        </KpiRow>
      )}

      <div className="sheet">
        <div className="sheet-head">
          <span>{t('monthly.completeness.title')}</span>
          <span className="mo-head-actions">
            <button
              type="button"
              className="mo-excel"
              onClick={() => downloadCsv(`completude-saisie-${period}.csv`, companiesCsv(companies))}
              disabled={companies.length === 0}
              title={t('common.exportExcel.note')}
            >
              <Download size={15} strokeWidth={2} aria-hidden="true" />
              {t('common.exportExcel')}
            </button>
            <span className="head-chip">{t('monthly.step.article')}</span>
          </span>
        </div>
        <div className="sheet-body flush">
          {monthlyQuery.isLoading ? (
            <p className="pad muted">{t('common.loading')}</p>
          ) : monthlyQuery.error ? (
            <div className="pad">
              <div className="note ko" role="alert">
                <span>{t('common.error')}</span>
                <button type="button" onClick={() => monthlyQuery.refetch()}>
                  {t('common.retry')}
                </button>
              </div>
            </div>
          ) : (
            <div className="mo-table mo-completeness">
              <Table columns={columns} rows={pageRows} page={page} total={companies.length} pageSize={PAGE_SIZE} onPageChange={setPage} getRowKey={(r) => r.code} />
            </div>
          )}
        </div>
      </div>

      <div className="mo-grid">
        <div className="sheet">
          <div className="sheet-head">
            <span>{t('monthly.lot.title')}</span>
            <button
              type="button"
              className="mo-excel"
              onClick={() => downloadCsv(`recours-du-lot-${period}.csv`, lotRowsCsv(lotRows))}
              disabled={lotRows.length === 0}
              title={t('common.exportExcel.note')}
            >
              <Download size={15} strokeWidth={2} aria-hidden="true" />
              {t('common.exportExcel')}
            </button>
          </div>
          <div className="sheet-body flush">
            {lotRegleQuery.isLoading || lotOppositionQuery.isLoading ? (
              <p className="pad muted">{t('common.loading')}</p>
            ) : lotRegleQuery.error || lotOppositionQuery.error ? (
              <div className="pad">
                <div className="note ko" role="alert">
                  <span>{t('common.error')}</span>
                </div>
              </div>
            ) : (
              <>
                <div className="pad mo-trunc">
                  <TruncationNote truncated={lotRegleQuery.data?.truncated || lotOppositionQuery.data?.truncated} shown={lotRows.length} total={(lotRegleQuery.data?.total ?? 0) + (lotOppositionQuery.data?.total ?? 0)} />
                </div>
                <div className="mo-table mo-lot">
                  <Table columns={lotColumns} rows={lotPageRows} page={lotPage} total={lotRows.length} pageSize={PAGE_SIZE} onPageChange={setLotPage} getRowKey={(r) => r.id} />
                  {summary ? (
                    <div className="mo-total">
                      <span>
                        {t('monthly.lot.total')} ({summary.settledCount} {t('monthly.lot.recoursUnit')})
                      </span>
                      <strong className="mono">{formatDzd(summary.totalAmount, locale)}</strong>
                    </div>
                  ) : null}
                </div>
                <p className="pad mo-foot-note">{t('monthly.lot.insertedAt.note')}</p>
              </>
            )}
          </div>
        </div>

        <div className="sheet">
          <div className="sheet-head mo-head-wrap">
            <span>{t('monthly.annexe7.title')}</span>
            <button
              type="button"
              className="mo-excel"
              onClick={() => downloadCsv(`annexe7-${period}.csv`, annexe7Csv(annexe7Pairs))}
              disabled={annexe7Pairs.length === 0}
              title={t('common.exportExcel.note')}
            >
              <Download size={15} strokeWidth={2} aria-hidden="true" />
              {t('common.exportExcel')}
            </button>
          </div>
          <div className="sheet-body flush">
            {annexe7Query.isLoading ? (
              <p className="pad muted">{t('common.loading')}</p>
            ) : annexe7Query.error || !annexe7Query.data ? (
              <div className="pad">
                <div className="note ko" role="alert">
                  <span>{t('common.error')}</span>
                  <button type="button" onClick={() => annexe7Query.refetch()}>
                    {t('common.retry')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mo-table mo-annexe7">
                <Table columns={annexe7Columns} rows={annexe7PageRows} page={annexe7Page} total={annexe7Pairs.length} pageSize={PAGE_SIZE} onPageChange={setAnnexe7Page} getRowKey={(p) => `${p.from}|${p.to}`} />
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
