'use client';

import { useQuery } from '@tanstack/react-query';
import { Download, Table2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { FolioHeader } from '@/components/FolioHeader';
import { FlowDiagram, FlowDiagramMode } from '@/components/settlement/FlowDiagram';
import { PipelineSection } from '@/components/settlement/PipelineSection';
import { CoChip } from '@/components/ui/CoChip';
import { Kpi, KpiRow } from '@/components/ui/Kpi';
import { Tabs } from '@/components/ui/Tabs';
import { useI18n } from '@/i18n/provider';
import { apiGet, apiPath } from '@/lib/api-client';
import { buildCsv, downloadCsv } from '@/lib/csv';
import { PriceGrid, QuarterlyPipeline, SettlementQuarter, SettlementQuarterMatrix, SettlementQuarterSummary } from '@/lib/types';

/** Montant entier « 1 234 567 DA » (unité de la maquette ; le `Kpi` affiche « DA » en petit). */
function formatDzd(amount: number, locale: string): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(amount)} DA`;
}

/** Montant signé « +1 072 850 DA » / « −269 325 DA » (colonne Position). */
function formatSignedDzd(amount: number, locale: string): string {
  if (amount === 0) return formatDzd(0, locale);
  return `${amount > 0 ? '+' : '−'}${formatDzd(Math.abs(amount), locale)}`;
}

/**
 * Montant compact de la maquette (« 5,65 M », « 757 k », « 0 ») — simple
 * mise en forme d'un montant réel de l'API ; la valeur exacte reste
 * disponible en infobulle (`title`) là où elle est utilisée.
 */
function formatCompact(amount: number, locale: string): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '−' : '';
  if (abs < 1000) return `${sign}${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(abs)}`;
  if (Math.round(abs / 1000) < 1000) return `${sign}${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(abs / 1000))} k`;
  return `${sign}${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(abs / 1_000_000)} M`;
}

function formatIsoDate(iso: string, locale: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString(locale, { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
}

/** Les trois mois d'un trimestre `AAAA-Qn` (« juillet 2026 · août 2026 · septembre 2026 ») — formatage de dates, pas une donnée. */
function quarterMonths(quarter: string, locale: string): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(quarter);
  if (!m) return '';
  const year = Number(m[1]);
  const first = (Number(m[2]) - 1) * 3;
  return [0, 1, 2]
    .map((i) => new Date(Date.UTC(year, first + i, 1)).toLocaleDateString(locale, { timeZone: 'UTC', month: 'long', year: 'numeric' }))
    .join(' · ');
}

/**
 * Carte thermique (écran 6) en échelle racine, comme la maquette :
 * `--k-mint` (0) → `--k-acc-2` → `--k-acc` → `--k-pri` → `--k-pri` assombri
 * vers `--k-head` (maximum) — uniquement des tokens de la charte.
 */
function heatColor(intensity: number): string {
  const t = Math.max(0, Math.min(1, intensity));
  if (t <= 0) return 'var(--k-mint)';
  if (t <= 0.4) return `color-mix(in srgb, var(--k-acc-2) ${Math.round((t / 0.4) * 100)}%, var(--k-mint))`;
  if (t <= 0.55) return `color-mix(in srgb, var(--k-acc) ${Math.round(((t - 0.4) / 0.15) * 100)}%, var(--k-acc-2))`;
  if (t <= 0.8) return `color-mix(in srgb, var(--k-pri) ${Math.round(((t - 0.55) / 0.25) * 100)}%, var(--k-acc))`;
  return `color-mix(in srgb, color-mix(in srgb, var(--k-pri) 45%, var(--k-head)) ${Math.round(((t - 0.8) / 0.2) * 100)}%, var(--k-pri))`;
}

function quarterOf(date: Date): string {
  return `${date.getFullYear()}-Q${Math.floor(date.getMonth() / 3) + 1}`;
}

function previousQuarter(quarter: string): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(quarter);
  if (!m) return quarter;
  const year = Number(m[1]);
  const q = Number(m[2]);
  return q === 1 ? `${year - 1}-Q4` : `${year}-Q${q - 1}`;
}

/**
 * Sélecteur de trimestre (ordre chronologique, comme la maquette) : les
 * trois derniers trimestres échus — le dernier étant le lot EN COURS DE
 * RÈGLEMENT, sélectionné par défaut (même règle que le Cockpit : en
 * octobre, c'est le lot T3 qui est compensé, Art. 16-18) — puis le
 * trimestre courant, encore ouvert (positions en cours de constitution).
 * Simple formatage de dates, pas une règle métier.
 */
function quarterOptions(now: Date): { options: string[]; settling: string } {
  const current = quarterOf(now);
  const settling = previousQuarter(current);
  const before = previousQuarter(settling);
  return { options: [previousQuarter(before), before, settling, current], settling };
}

export default function QuarterPage() {
  const { t, locale } = useI18n();
  const { options, settling } = useMemo(() => quarterOptions(new Date()), []);
  const [quarter, setQuarter] = useState(settling);
  /** Bascule d'affichage du diagramme de flux (section additive 2026-10-18, §11-6 — mode à confirmer par l'UAR, les deux sont calculés). */
  const [flowMode, setFlowMode] = useState<FlowDiagramMode>('multilateral');

  const quarterQuery = useQuery({
    queryKey: ['settlement', 'quarter', quarter],
    queryFn: () => apiGet<SettlementQuarter>(apiPath`/settlement/quarter/${quarter}`),
  });

  const summaryQuery = useQuery({
    queryKey: ['settlement', 'quarter', quarter, 'summary'],
    queryFn: () => apiGet<SettlementQuarterSummary>(apiPath`/settlement/quarter/${quarter}/summary`),
  });

  const matrixQuery = useQuery({
    queryKey: ['settlement', 'quarter', quarter, 'matrix'],
    queryFn: () => apiGet<SettlementQuarterMatrix>(apiPath`/settlement/quarter/${quarter}/matrix`),
  });

  const gridQuery = useQuery({
    queryKey: ['pricing', 'grid'],
    queryFn: () => apiGet<PriceGrid>('/pricing/grid'),
  });

  /**
   * Même requête que `PipelineSection` (même `queryKey`, dédupliquée par
   * TanStack Query) — réutilisée ici UNIQUEMENT pour la carte condensée
   * "Trimestre … — en compensation" (étape en cours + limite de la
   * réunion), sans dupliquer l'appel réseau ni les actions
   * (clôture/réalisation d'étape), qui restent dans `PipelineSection`.
   */
  const pipelineQuery = useQuery({
    queryKey: ['settlement', 'quarter', quarter, 'pipeline'],
    queryFn: () => apiGet<QuarterlyPipeline>(apiPath`/settlement/quarter/${quarter}/pipeline`),
  });

  const data = quarterQuery.data;
  const summary = summaryQuery.data;
  const rawMatrix = matrixQuery.data;

  const rawAmountAt = useMemo(() => {
    const byKey = new Map<string, number>();
    for (const c of rawMatrix?.cells ?? []) byKey.set(`${c.from}|${c.to}`, c.amount);
    return (from: string, to: string) => byKey.get(`${from}|${to}`) ?? 0;
  }, [rawMatrix]);

  const rawMax = useMemo(() => Math.max(0, ...(rawMatrix?.cells.map((c) => c.amount) ?? [0])), [rawMatrix]);

  const rowTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const c of rawMatrix?.companies ?? []) {
      totals.set(c, (rawMatrix?.cells ?? []).filter((cell) => cell.from === c).reduce((s, cell) => s + cell.amount, 0));
    }
    return totals;
  }, [rawMatrix]);

  const colTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const c of rawMatrix?.companies ?? []) {
      totals.set(c, (rawMatrix?.cells ?? []).filter((cell) => cell.to === c).reduce((s, cell) => s + cell.amount, 0));
    }
    return totals;
  }, [rawMatrix]);

  /** Somme des positions nettes (ligne de pied de la table, comme la maquette) — À recevoir = À payer par construction. */
  const netTotals = useMemo(() => {
    const net = data?.net ?? [];
    return {
      receivable: net.filter((n) => n.net > 0).reduce((s, n) => s + n.net, 0),
      payable: net.filter((n) => n.net < 0).reduce((s, n) => s - n.net, 0),
      position: net.reduce((s, n) => s + n.net, 0),
    };
  }, [data]);

  const currentStep = pipelineQuery.data?.steps.find((s) => s.status === 'EN_COURS');
  const meetingStep = pipelineQuery.data?.steps.find((s) => s.step === 'SYNTHESE_GLOBALE_REUNION');
  const quarterLabel = quarter.replace('-', ' ');
  /** Intensité en échelle racine (« 0 → max DA (échelle racine) », maquette). */
  const intensityOf = (amount: number) => (rawMax > 0 ? Math.sqrt(amount / rawMax) : 0);

  return (
    <div className="q-screen">
      <FolioHeader
        badge="Module D · §6.6"
        title={t('quarter.title')}
        subtitle={t('quarter.subtitle')}
        actions={
          <>
            <div className="q-seg" role="group" aria-label={t('quarter.period.label')}>
              <Tabs items={options.map((o) => ({ key: o, label: o.replace('-', ' ') }))} activeKey={quarter} onChange={setQuarter} />
            </div>
            <button
              type="button"
              className="btn-outline"
              onClick={() => document.getElementById('quarter-positions')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              <Table2 size={16} strokeWidth={2} aria-hidden="true" />
              {t('quarter.actions.positions')}
            </button>
          </>
        }
      />

      {quarterQuery.isLoading ? (
        <p>{t('common.loading')}</p>
      ) : quarterQuery.error || !data ? (
        <div className="note ko" role="alert">
          <span>{t('common.error')}</span>
          <button type="button" onClick={() => quarterQuery.refetch()}>
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <>
          <div className="grid q-top">
            {/*
             * "Trimestre … — en compensation" — la capture de référence
             * montre une réunion avec convocation, lieu précis et ordre du
             * jour détaillé : aucune entité de planification (convocation,
             * lieu, ordre du jour) n'existe côté API pour ce module. Seules
             * les lignes alimentées par des données RÉELLES sont affichées
             * (étape en cours et limite de la réunion,
             * `/settlement/quarter/:q/pipeline`, Art. 16-18) — aucune
             * convocation ni ordre du jour inventés (voir le rapport de
             * livraison).
             */}
            <div className="sheet q-comp">
              <div className="sheet-head">
                <span>
                  {t('quarter.compensation.titlePrefix')}
                  {quarterLabel}
                  {t(data.closedAt ? 'quarter.compensation.titleSuffix.CLOSED' : 'quarter.compensation.titleSuffix.OPEN')}
                </span>
                <span className="head-chip">{t('quarter.compensation.article')}</span>
              </div>
              <div className="sheet-body">
                <div className="q-comp-status">
                  <span className={`q-status ${data.closedAt ? 'ok' : 'warn'}`}>
                    {t(data.closedAt ? 'quarter.compensation.status.CLOSED' : 'quarter.compensation.status.OPEN')}
                  </span>
                  <span className="q-months">{quarterMonths(quarter, locale)}</span>
                </div>
                {pipelineQuery.isLoading ? (
                  <p>{t('common.loading')}</p>
                ) : pipelineQuery.error || !pipelineQuery.data ? (
                  <p className="muted">{t('common.noData')}</p>
                ) : (
                  <dl className="q-dl">
                    {meetingStep ? (
                      <>
                        <dt>{t('quarter.compensation.meeting.label')}</dt>
                        <dd>
                          {meetingStep.label}
                          {meetingStep.completedAt ? (
                            <span className="q-dd-sub">
                              {t('quarter.pipeline.completedAt')} <span className="mono">{new Date(meetingStep.completedAt).toLocaleString(locale)}</span>
                            </span>
                          ) : null}
                        </dd>
                        <dt>{t('quarter.compensation.deadline.label')}</dt>
                        <dd>{formatIsoDate(meetingStep.dueDate, locale)}</dd>
                      </>
                    ) : null}
                    {currentStep ? (
                      <>
                        <dt>{t('quarter.compensation.current.label')}</dt>
                        <dd>
                          {currentStep.label} <span className="q-art">{currentStep.article}</span>
                          <span className={`q-dd-sub${currentStep.overdue ? ' ko' : ''}`}>
                            {t('quarter.pipeline.dueDate')} : {formatIsoDate(currentStep.dueDate, locale)}
                            {currentStep.overdue ? ` · ${t('quarter.pipeline.overdue')}` : ''}
                          </span>
                        </dd>
                      </>
                    ) : null}
                  </dl>
                )}
              </div>
            </div>

            <div className="sheet q-net" id="quarter-positions">
              <div className="sheet-head">
                <span>{t('quarter.net.title')}</span>
                <button
                  type="button"
                  className="q-ghost"
                  onClick={() =>
                    downloadCsv(
                      `positions-nettes-${quarter}.csv`,
                      buildCsv(['compagnie', 'position_nette'], data.net.map((n) => [n.code, n.net])),
                    )
                  }
                  disabled={data.net.length === 0}
                  title={t('common.exportExcel.note')}
                >
                  <Download size={15} strokeWidth={2} aria-hidden="true" />
                  {t('common.exportExcel')}
                </button>
              </div>
              <div className="sheet-body flush">
                <div className="t-wrap">
                  <table className="t q-net-t">
                    <thead>
                      <tr>
                        <th>{t('quarter.net.col.company')}</th>
                        <th className="num">{t('quarter.net.col.receivable')}</th>
                        <th className="num">{t('quarter.net.col.payable')}</th>
                        <th className="num">{t('quarter.net.col.position')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.net.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="muted" style={{ textAlign: 'center' }}>
                            {t('common.noData')}
                          </td>
                        </tr>
                      ) : (
                        data.net.map((n) => (
                          <tr key={n.code}>
                            <td>
                              <CoChip code={n.code} withName />
                            </td>
                            <td className="mono num">{n.net > 0 ? formatDzd(n.net, locale) : '—'}</td>
                            <td className="mono num">{n.net < 0 ? formatDzd(-n.net, locale) : '—'}</td>
                            <td className={`mono num q-pos ${n.net > 0 ? 'pos' : n.net < 0 ? 'neg' : ''}`}>
                              <span className="q-sr">{n.net >= 0 ? t('quarter.net.receivable') : t('quarter.net.payable')} </span>
                              {formatSignedDzd(n.net, locale)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                    {data.net.length > 0 ? (
                      <tfoot>
                        <tr>
                          <td>{t('quarter.net.total')}</td>
                          <td className="mono num">{formatDzd(netTotals.receivable, locale)}</td>
                          <td className="mono num">{formatDzd(netTotals.payable, locale)}</td>
                          <td className="mono num">{formatDzd(netTotals.position, locale)}</td>
                        </tr>
                      </tfoot>
                    ) : null}
                  </table>
                </div>
              </div>
            </div>
          </div>

          {summaryQuery.isLoading ? (
            <p>{t('common.loading')}</p>
          ) : summaryQuery.error || !summary ? (
            <div className="note ko" role="alert" style={{ margin: '14px 0' }}>
              <span>{t('common.error')}</span>
              <button type="button" onClick={() => summaryQuery.refetch()}>
                {t('common.retry')}
              </button>
            </div>
          ) : (
            <KpiRow>
              <Kpi value={`${formatCompact(summary.grossTotal, locale)} DA`} label={t('quarter.kpi.grossTotal')} title={formatDzd(summary.grossTotal, locale)} />
              <Kpi value={`${formatCompact(summary.bilateralNetTotal, locale)} DA`} label={t('quarter.kpi.bilateralNetTotal')} title={formatDzd(summary.bilateralNetTotal, locale)} />
              <Kpi value={`${formatCompact(summary.multilateralNetTotal, locale)} DA`} label={t('quarter.kpi.multilateralNetTotal')} title={formatDzd(summary.multilateralNetTotal, locale)} />
              <Kpi value={`${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(summary.reductionPct)} %`} label={t('quarter.kpi.reductionPct')} />
              <Kpi value={summary.settledCount} label={t('quarter.kpi.settledCount')} />
              <Kpi value={summary.opposedCount} label={t('quarter.kpi.opposedCount')} />
            </KpiRow>
          )}

          <div className="sheet q-matrix">
            <div className="sheet-head">
              <span>{t('quarter.rawMatrix.title')}</span>
              <span className="head-chip">{t('quarter.compensation.article')}</span>
            </div>
            <div className="sheet-body">
              {matrixQuery.isLoading ? (
                <p>{t('common.loading')}</p>
              ) : matrixQuery.error || !rawMatrix || rawMatrix.companies.length === 0 ? (
                <p className="muted">{t('common.noData')}</p>
              ) : (
                <>
                  <div className="t-wrap">
                    <table className="q-heat" aria-label={t('quarter.rawMatrix.title')}>
                      <thead>
                        <tr>
                          <th className="q-heat-corner" scope="col">
                            {t('quarter.rawMatrix.from')}
                          </th>
                          {rawMatrix.companies.map((c) => (
                            <th key={c} scope="col" className="q-heat-code">
                              {c}
                            </th>
                          ))}
                          <th scope="col" className="q-heat-total-h">
                            {t('quarter.rawMatrix.receivableRow')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {rawMatrix.companies.map((from) => (
                          <tr key={from}>
                            <th scope="row" className="q-heat-code q-heat-row">
                              {from}
                            </th>
                            {rawMatrix.companies.map((to) => {
                              if (from === to) return <td key={to} className="q-heat-cell diag" aria-hidden="true" />;
                              const amount = rawAmountAt(from, to);
                              const intensity = intensityOf(amount);
                              return (
                                <td
                                  key={to}
                                  className={`q-heat-cell${intensity >= 0.45 ? ' dark' : ''}`}
                                  style={{ background: heatColor(intensity) }}
                                  title={formatDzd(amount, locale)}
                                >
                                  <span className="mono">{formatCompact(amount, locale)}</span>
                                </td>
                              );
                            })}
                            <td className="mono q-heat-total" title={formatDzd(rowTotals.get(from) ?? 0, locale)}>
                              {formatCompact(rowTotals.get(from) ?? 0, locale)}
                            </td>
                          </tr>
                        ))}
                        <tr>
                          <th scope="row" className="q-heat-total-h q-heat-row">
                            {t('quarter.rawMatrix.payableRow')}
                          </th>
                          {rawMatrix.companies.map((c) => (
                            <td key={c} className="mono q-heat-total center" title={formatDzd(colTotals.get(c) ?? 0, locale)}>
                              {formatCompact(colTotals.get(c) ?? 0, locale)}
                            </td>
                          ))}
                          <td />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="q-legend">
                    <span className="q-legend-bar" aria-hidden="true">
                      {[0.1, 0.4, 0.55, 0.8, 1].map((stop) => (
                        <span key={stop} style={{ background: heatColor(stop) }} />
                      ))}
                    </span>
                    <span>
                      0 → {formatDzd(rawMax, locale)} {t('quarter.rawMatrix.legend.title')}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="sheet q-flow">
            <div className="sheet-head">
              <span>
                {t('quarter.flow.titlePrefix')}
                {rawMatrix?.companies.length ?? 0}
                {t('quarter.flow.titleSuffix')}
              </span>
              <span className="head-chip">{t('quarter.flow.article')}</span>
            </div>
            <div className="sheet-body">
              <div className="q-flow-bar">
                <div className="q-seg">
                  <Tabs
                    items={[
                      { key: 'multilateral', label: t('quarter.flow.multilateral') },
                      { key: 'bilateral', label: t('quarter.flow.bilateral') },
                    ]}
                    activeKey={flowMode}
                    onChange={(key) => setFlowMode(key as FlowDiagramMode)}
                  />
                </div>
                <p className="q-flow-caption">{t('quarter.flow.caption')}</p>
              </div>
              <FlowDiagram
                mode={flowMode}
                net={data.net}
                positions={data.positions}
                formatAmount={(amount) => formatDzd(amount, locale)}
                emptyLabel={t('common.noData')}
                hubLabel={t('quarter.flow.hub')}
              />
            </div>
          </div>

          <PipelineSection quarter={quarter} />

          <div className="sheet q-bordereau">
            <div className="sheet-head">
              <span>{t('quarter.bordereau.title')}</span>
            </div>
            <div className="sheet-body">
              <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
                {t('quarter.bordereau.reference')}
              </p>
              <p className="mono" style={{ fontSize: 'var(--k-fs-l)', fontWeight: 700, margin: 0 }}>
                {data.bordereau ?? '—'}
              </p>
            </div>
          </div>

          <div className="sheet">
            <div className="sheet-head">
              <span>
                {t('quarter.grid.title')} · <span className="mono">{gridQuery.data?.version ?? 'TARIF-2026.01'}</span>
              </span>
            </div>
            <div className="sheet-body">
              {gridQuery.isLoading ? (
                <p>{t('common.loading')}</p>
              ) : gridQuery.error || !gridQuery.data ? (
                <div className="note ko" role="alert">
                  <span>{t('common.error')}</span>
                </div>
              ) : (
                <>
                  <p className="muted" style={{ fontSize: 13 }}>
                    {t('quarter.grid.subscription')} : <span className="mono">{formatDzd(gridQuery.data.subscription.monthly, locale)}</span>
                  </p>
                  <div className="t-wrap">
                    <table className="t">
                      <thead>
                        <tr>
                          <th>{t('quarter.grid.col.metric')}</th>
                          <th>{t('quarter.grid.col.unit')}</th>
                          <th>{t('quarter.grid.col.quota')}</th>
                          <th>{t('quarter.grid.col.price')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {gridQuery.data.metrics.map((m) => (
                          <tr key={m.metric}>
                            <td>{m.label}</td>
                            <td className="mono">{m.unit}</td>
                            <td className="mono">{m.includedQuota.toLocaleString(locale)}</td>
                            <td className="mono">{formatDzd(m.unitPrice, locale)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
