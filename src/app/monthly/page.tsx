'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { FolioHeader } from '@/components/FolioHeader';
import { CoChip } from '@/components/ui/CoChip';
import { CountdownBar } from '@/components/ui/CountdownBar';
import { Kpi, KpiRow } from '@/components/ui/Kpi';
import { Table, Column } from '@/components/ui/Table';
import { Tag } from '@/components/ui/Tag';
import { TruncationNote } from '@/components/ui/TruncationNote';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { TranslationKey } from '@/i18n/translations';
import { apiGet, apiPath, apiPost } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
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

function formatDzd(amount: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'DZD', maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount.toLocaleString()} DA`;
  }
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
  const { hasPrivilege } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [period, setPeriod] = useState(currentPeriod);
  const [page, setPage] = useState(1);
  const [lotPage, setLotPage] = useState(1);
  const [annexe7Page, setAnnexe7Page] = useState(1);

  const canGenerate = hasPrivilege('synth');

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
    const settled = (lotRegleQuery.data?.items ?? [])
      .filter((r) => isInPeriod(r.settledAt ?? r.requestSentAt, period))
      .map((r) => ({ ...r, included: true as const }));
    const excluded = (lotOppositionQuery.data?.items ?? []).map((r) => ({ ...r, included: false as const }));
    return [...settled, ...excluded].sort((a, b) => (b.settledAt ?? b.createdAt).localeCompare(a.settledAt ?? a.createdAt));
  }, [lotRegleQuery.data, lotOppositionQuery.data, period]);
  const lotPageRows = lotRows.slice((lotPage - 1) * PAGE_SIZE, lotPage * PAGE_SIZE);

  const annexe7Pairs = annexe7Query.data?.pairs ?? [];
  const annexe7PageRows = annexe7Pairs.slice((annexe7Page - 1) * PAGE_SIZE, annexe7Page * PAGE_SIZE);

  const columns: Column<SettlementMonthlyCompany>[] = useMemo(
    () => [
      {
        key: 'company',
        header: t('monthly.col.company'),
        render: (r) => (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <CoChip code={r.code} /> <span className="mono">{r.code}</span>
          </span>
        ),
      },
      { key: 'claimsCount', header: t('monthly.col.claimsCount'), render: (r) => <span className="mono">{r.claimsCount}</span> },
      { key: 'totalAmount', header: t('monthly.col.totalAmount'), render: (r) => <span className="mono">{formatDzd(r.totalAmount, locale)}</span> },
      {
        key: 'status',
        header: t('monthly.col.status'),
        render: (r) => <Tag tone={r.status === 'CLOTURE' ? 'ok' : 'warn'}>{t(`monthly.status.${r.status}` as TranslationKey)}</Tag>,
      },
      {
        key: 'closedAt',
        header: t('monthly.col.closedAt'),
        render: (r) => (r.closedAt ? <span className="mono" style={{ fontSize: 'var(--k-fs-xs)' }}>{new Date(r.closedAt).toLocaleString(locale)}</span> : <span style={{ color: 'var(--ink-3)' }}>—</span>),
      },
      {
        key: 'action',
        header: '',
        render: (r) =>
          r.status === 'CLOTURE' ? (
            <span className="mono" style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)' }}>
              {r.bordereauRef}
            </span>
          ) : (
            <button
              type="button"
              className="tag ok"
              style={{ border: 'none', cursor: canGenerate ? 'pointer' : 'not-allowed' }}
              disabled={!canGenerate || closeMutation.isPending}
              onClick={() => closeMutation.mutate(r.code)}
              title={!canGenerate ? t('common.forbidden') : undefined}
            >
              {t('monthly.action.generateBordereau')}
            </button>
          ),
      },
    ],
    [t, locale, canGenerate, closeMutation],
  );

  const lotColumns: Column<LotRow>[] = useMemo(
    () => [
      { key: 'ref', header: t('monthly.lot.col.ref'), render: (r) => <span className="mono" title={r.id}>{r.id.slice(0, 8)}</span> },
      {
        key: 'pair',
        header: t('monthly.lot.col.pair'),
        render: (r) => (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <CoChip code={r.from} /> <span style={{ color: 'var(--ink-3)' }}>→</span> <CoChip code={r.to} />
          </span>
        ),
      },
      { key: 'settledAt', header: t('monthly.lot.col.settledAt'), render: (r) => (r.settledAt ? new Date(r.settledAt).toLocaleDateString(locale) : <span style={{ color: 'var(--ink-3)' }}>—</span>) },
      { key: 'insertedAt', header: t('monthly.lot.col.insertedAt'), render: (r) => new Date(r.createdAt).toLocaleDateString(locale) },
      { key: 'amount', header: t('monthly.lot.col.amount'), render: (r) => <span className="mono">{formatDzd(r.amount, locale)}</span> },
      {
        key: 'state',
        header: t('monthly.lot.col.state'),
        render: (r) => <Tag tone={r.included ? 'ok' : 'warn'}>{t(r.included ? 'monthly.lot.state.included' : 'monthly.lot.state.excluded')}</Tag>,
      },
    ],
    [t, locale],
  );

  const annexe7Columns: Column<SettlementMonthlyAnnexe7Pair>[] = useMemo(
    () => [
      {
        key: 'creditor',
        header: t('monthly.annexe7.col.creditor'),
        render: (p) => (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <CoChip code={p.from} /> <span className="mono">{p.from}</span>
          </span>
        ),
      },
      {
        key: 'debtor',
        header: t('monthly.annexe7.col.debtor'),
        render: (p) => (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <CoChip code={p.to} /> <span className="mono">{p.to}</span>
          </span>
        ),
      },
      { key: 'count', header: t('monthly.annexe7.col.count'), render: (p) => <span className="mono">{p.count}</span> },
      { key: 'amount', header: t('monthly.annexe7.col.amount'), render: (p) => <span className="mono">{formatDzd(p.totalAmount, locale)}</span> },
    ],
    [t, locale],
  );

  return (
    <>
      <FolioHeader badge="Module C · §6.5" title={t('monthly.title')} subtitle={t('monthly.subtitle')} />

      <div className="sheet" style={{ marginBottom: 'var(--s-5)' }}>
        <div className="sheet-body">
          <label htmlFor="monthly-period" style={{ display: 'block', fontSize: 'var(--k-fs-s)', color: 'var(--ink-2)', marginBottom: 4 }}>
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
            style={{ padding: '6px 10px', border: '1px solid var(--rule-strong)', borderRadius: 'var(--k-r-s)', font: 'inherit', background: 'var(--paper)', color: 'var(--ink)' }}
          />

          {!canGenerate ? <p className="note warn" style={{ marginTop: 'var(--s-3)' }}>{t('common.forbidden')}</p> : null}
        </div>
      </div>

      {/*
       * Avancement du cycle — la capture de référence montre une frise à 5
       * étapes (Annexe 8, transmission tiers + Commission, scellement
       * définitif) qui sont en réalité celles du Diagramme 2 du lot
       * TRIMESTRIEL (voir `quarter.compensation.gap.note` et le rapport de
       * livraison) : le cycle MENSUEL n'a pas cette entité pipeline côté
       * API. Seules deux étapes sont réelles ici : l'échéance de saisie
       * (`summary.insertionDeadline`) et la clôture par compagnie
       * (`companies[].status`) — jamais une date fabriquée pour les
       * étapes manquantes (règle d'or du projet).
       */}
      <div className="sheet" style={{ marginBottom: 'var(--s-5)' }}>
        <div className="sheet-head">
          <span>{t('monthly.progress.title')}</span>
        </div>
        <div className="sheet-body">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-5)' }}>
            <div style={{ flex: '1 1 260px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span className="co-chip" style={{ background: 'var(--k-pri)' }}>1</span>
                <strong style={{ fontSize: 'var(--k-fs-s)' }}>{t('monthly.progress.step1.label')}</strong>
              </div>
              {summaryQuery.data ? (
                <CountdownBar
                  startAt={firstDayOfPeriodIso(period)}
                  deadlineAt={summaryQuery.data.insertionDeadline}
                  renderLabel={({ remainingDays, overdue }) => `${remainingDays} ${t(overdue ? 'exchanges.countdown.overdue' : 'exchanges.countdown.remaining')}`}
                />
              ) : (
                <p style={{ margin: 0, color: 'var(--ink-3)' }}>{t('common.loading')}</p>
              )}
            </div>
            <div style={{ flex: '1 1 260px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span className="co-chip" style={{ background: closedCount === companies.length && companies.length > 0 ? 'var(--ok)' : 'var(--k-pri)' }}>2</span>
                <strong style={{ fontSize: 'var(--k-fs-s)' }}>{t('monthly.progress.step2.label')}</strong>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="score-bar-track" style={{ minWidth: 70 }}>
                  <div
                    className="score-bar-fill"
                    style={{ width: `${companies.length > 0 ? Math.round((closedCount / companies.length) * 100) : 0}%`, background: 'var(--ok)' }}
                  />
                </div>
                <span className="mono" style={{ fontSize: 'var(--k-fs-xs)' }}>
                  {closedCount}/{companies.length} {t('monthly.progress.step2.closedSuffix')}
                </span>
              </div>
              <p style={{ margin: 'var(--s-1) 0 0', fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)' }}>
                {t('monthly.progress.step2.deadlineLabel')} <span className="mono">{new Date(`${lastDayOfPeriodIso(period)}T00:00:00Z`).toLocaleDateString(locale, { timeZone: 'UTC' })}</span>
              </p>
            </div>
          </div>
          <p className="note" style={{ marginTop: 'var(--s-4)', marginBottom: 0, fontSize: 'var(--k-fs-xs)' }}>
            {t('monthly.progress.gap.note')}
          </p>
        </div>
      </div>

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
          <Kpi value={summaryQuery.data.settledCount} label={t('monthly.kpi.settledCount')} />
          <Kpi value={formatDzd(summaryQuery.data.totalAmount, locale)} label={t('monthly.kpi.totalAmount')} />
          <Kpi value={summaryQuery.data.excludedOppositionCount} label={t('monthly.kpi.excludedOppositionCount')} />
          <Kpi
            value={new Date(summaryQuery.data.insertionDeadline).toLocaleDateString(locale)}
            label={t('monthly.kpi.insertionDeadline')}
            extra={t('monthly.kpi.insertionDeadline.extra')}
          />
        </KpiRow>
      )}

      <div className="sheet" style={{ marginTop: 'var(--s-5)' }}>
        <div className="sheet-head">
          <span>{t('monthly.completeness.title')}</span>
          <button
            type="button"
            onClick={() => downloadCsv(`completude-saisie-${period}.csv`, companiesCsv(companies))}
            disabled={companies.length === 0}
            title={t('common.exportExcel.note')}
            style={{ padding: '4px 10px', borderRadius: 'var(--k-r-s)', border: '1px solid var(--rule-strong)', background: 'var(--paper)', color: 'var(--ink)', font: 'inherit', cursor: companies.length === 0 ? 'not-allowed' : 'pointer' }}
          >
            {t('common.exportExcel')}
          </button>
        </div>
        <div className="sheet-body">
          {monthlyQuery.isLoading ? (
            <p>{t('common.loading')}</p>
          ) : monthlyQuery.error ? (
            <div className="note ko" role="alert">
              <span>{t('common.error')}</span>
              <button type="button" onClick={() => monthlyQuery.refetch()}>
                {t('common.retry')}
              </button>
            </div>
          ) : (
            <Table columns={columns} rows={pageRows} page={page} total={companies.length} pageSize={PAGE_SIZE} onPageChange={setPage} getRowKey={(r) => r.code} />
          )}
        </div>
      </div>

      <div className="grid g-side" style={{ marginTop: 'var(--s-5)' }}>
        <div className="sheet">
          <div className="sheet-head">
            <span>{t('monthly.lot.title')}</span>
            <button
              type="button"
              onClick={() => downloadCsv(`recours-du-lot-${period}.csv`, lotRowsCsv(lotRows))}
              disabled={lotRows.length === 0}
              title={t('common.exportExcel.note')}
              style={{ padding: '4px 10px', borderRadius: 'var(--k-r-s)', border: '1px solid var(--rule-strong)', background: 'var(--paper)', color: 'var(--ink)', font: 'inherit', cursor: lotRows.length === 0 ? 'not-allowed' : 'pointer' }}
            >
              {t('common.exportExcel')}
            </button>
          </div>
          <div className="sheet-body">
            {lotRegleQuery.isLoading || lotOppositionQuery.isLoading ? (
              <p>{t('common.loading')}</p>
            ) : lotRegleQuery.error || lotOppositionQuery.error ? (
              <div className="note ko" role="alert">
                <span>{t('common.error')}</span>
              </div>
            ) : (
              <>
                <TruncationNote truncated={lotRegleQuery.data?.truncated || lotOppositionQuery.data?.truncated} shown={lotRows.length} total={(lotRegleQuery.data?.total ?? 0) + (lotOppositionQuery.data?.total ?? 0)} />
                {summaryQuery.data ? (
                  <p style={{ margin: '0 0 var(--s-3)', fontSize: 'var(--k-fs-s)' }}>
                    {t('monthly.lot.total')} ({summaryQuery.data.settledCount}) : <strong className="mono">{formatDzd(summaryQuery.data.totalAmount, locale)}</strong>
                  </p>
                ) : null}
                <Table columns={lotColumns} rows={lotPageRows} page={lotPage} total={lotRows.length} pageSize={PAGE_SIZE} onPageChange={setLotPage} getRowKey={(r) => r.id} />
                <p style={{ margin: 'var(--s-2) 0 0', fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)' }}>{t('monthly.lot.insertedAt.note')}</p>
              </>
            )}
          </div>
        </div>

        <div className="sheet">
          <div className="sheet-head">
            <span>{t('monthly.annexe7.title')}</span>
            <button
              type="button"
              onClick={() => downloadCsv(`annexe7-${period}.csv`, annexe7Csv(annexe7Pairs))}
              disabled={annexe7Pairs.length === 0}
              title={t('common.exportExcel.note')}
              style={{ padding: '4px 10px', borderRadius: 'var(--k-r-s)', border: '1px solid var(--rule-strong)', background: 'var(--paper)', color: 'var(--ink)', font: 'inherit', cursor: annexe7Pairs.length === 0 ? 'not-allowed' : 'pointer' }}
            >
              {t('common.exportExcel')}
            </button>
          </div>
          <div className="sheet-body">
            {annexe7Query.isLoading ? (
              <p>{t('common.loading')}</p>
            ) : annexe7Query.error || !annexe7Query.data ? (
              <div className="note ko" role="alert">
                <span>{t('common.error')}</span>
                <button type="button" onClick={() => annexe7Query.refetch()}>
                  {t('common.retry')}
                </button>
              </div>
            ) : (
              <Table columns={annexe7Columns} rows={annexe7PageRows} page={annexe7Page} total={annexe7Pairs.length} pageSize={PAGE_SIZE} onPageChange={setAnnexe7Page} getRowKey={(p) => `${p.from}|${p.to}`} />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
