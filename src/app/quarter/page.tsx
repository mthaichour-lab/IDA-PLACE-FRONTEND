'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { FolioHeader } from '@/components/FolioHeader';
import { FlowDiagram, FlowDiagramMode } from '@/components/settlement/FlowDiagram';
import { PipelineSection } from '@/components/settlement/PipelineSection';
import { CoChip } from '@/components/ui/CoChip';
import { Kpi, KpiRow } from '@/components/ui/Kpi';
import { Tabs } from '@/components/ui/Tabs';
import { Tag } from '@/components/ui/Tag';
import { useI18n } from '@/i18n/provider';
import { apiGet, apiPath } from '@/lib/api-client';
import { buildCsv, downloadCsv } from '@/lib/csv';
import { PriceGrid, QuarterlyPipeline, SettlementQuarter, SettlementQuarterMatrix, SettlementQuarterSummary } from '@/lib/types';

function formatDzd(amount: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'DZD', maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount.toLocaleString()} DA`;
  }
}

function formatIsoDate(iso: string, locale: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString(locale, { timeZone: 'UTC' });
}

/**
 * Dégradé charte `--k-mint → --k-pri-2 → --k-pri` (carte thermique, écran 6)
 * — deux segments `color-mix` plutôt qu'une seule teinte, pour un rendu
 * plus proche de la capture de référence sans sortir des tokens fixes.
 */
function heatColor(intensity: number): string {
  const clamped = Math.max(0, Math.min(1, intensity));
  if (clamped <= 0) return 'var(--paper)';
  if (clamped <= 0.5) return `color-mix(in srgb, var(--k-pri-2) ${Math.round((clamped / 0.5) * 100)}%, var(--k-mint))`;
  return `color-mix(in srgb, var(--k-pri) ${Math.round(((clamped - 0.5) / 0.5) * 100)}%, var(--k-pri-2))`;
}

/** Trimestre courant (simple formatage de date, pas une règle métier) + les 3 précédents, pour le sélecteur. */
function quarterOptions(): string[] {
  const now = new Date();
  const currentQ = Math.floor(now.getMonth() / 3) + 1;
  const options: string[] = [];
  let y = now.getFullYear();
  let q = currentQ;
  for (let i = 0; i < 5; i++) {
    options.push(`${y}-Q${q}`);
    q -= 1;
    if (q === 0) {
      q = 4;
      y -= 1;
    }
  }
  return options;
}

export default function QuarterPage() {
  const { t, locale } = useI18n();
  const options = useMemo(quarterOptions, []);
  const [quarter, setQuarter] = useState(options[0]);
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
   * "Trimestre en compensation" (étape en cours + réunion), sans dupliquer
   * l'appel réseau ni les actions (clôture/réalisation d'étape), qui
   * restent dans `PipelineSection` ci-dessous.
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

  const rawMax = useMemo(() => Math.max(1, ...(rawMatrix?.cells.map((c) => c.amount) ?? [0])), [rawMatrix]);

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

  const currentStep = pipelineQuery.data?.steps.find((s) => s.status === 'EN_COURS');
  const meetingStep = pipelineQuery.data?.steps.find((s) => s.step === 'SYNTHESE_GLOBALE_REUNION');

  return (
    <>
      <FolioHeader
        badge="Module D · §6.6"
        title={t('quarter.title')}
        subtitle={t('quarter.subtitle')}
        actions={
          <button
            type="button"
            onClick={() => document.getElementById('quarter-positions')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            style={{ padding: '6px 12px', borderRadius: 'var(--k-r-s)', border: '1px solid var(--k-pri)', background: 'var(--k-pri)', color: '#fff', font: 'inherit', cursor: 'pointer' }}
          >
            {t('quarter.actions.positions')}
          </button>
        }
      />

      <div className="sheet" style={{ marginBottom: 'var(--s-5)' }}>
        <div className="sheet-body">
          <span style={{ display: 'block', fontSize: 'var(--k-fs-s)', color: 'var(--ink-2)', marginBottom: 4 }}>{t('quarter.period.label')}</span>
          <Tabs items={options.map((o) => ({ key: o, label: o.replace('-', ' ') }))} activeKey={quarter} onChange={setQuarter} />
        </div>
      </div>

      {summaryQuery.isLoading ? (
        <p>{t('common.loading')}</p>
      ) : summaryQuery.error || !summary ? (
        <div className="note ko" role="alert">
          <span>{t('common.error')}</span>
          <button type="button" onClick={() => summaryQuery.refetch()}>
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <KpiRow>
          <Kpi value={formatDzd(summary.grossTotal, locale)} label={t('quarter.kpi.grossTotal')} />
          <Kpi value={formatDzd(summary.bilateralNetTotal, locale)} label={t('quarter.kpi.bilateralNetTotal')} />
          <Kpi value={formatDzd(summary.multilateralNetTotal, locale)} label={t('quarter.kpi.multilateralNetTotal')} />
          <Kpi value={`${summary.reductionPct}%`} label={t('quarter.kpi.reductionPct')} />
          <Kpi value={summary.settledCount} label={t('quarter.kpi.settledCount')} />
          <Kpi value={summary.opposedCount} label={t('quarter.kpi.opposedCount')} />
        </KpiRow>
      )}

      {quarterQuery.isLoading ? (
        <p style={{ marginTop: 'var(--s-5)' }}>{t('common.loading')}</p>
      ) : quarterQuery.error || !data ? (
        <div className="note ko" role="alert" style={{ marginTop: 'var(--s-5)' }}>
          <span>{t('common.error')}</span>
          <button type="button" onClick={() => quarterQuery.refetch()}>
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <>
          <div className="grid g-mon" style={{ marginTop: 'var(--s-5)', marginBottom: 'var(--s-5)' }}>
            {/*
             * "Trimestre en compensation" — la capture de référence montre
             * une réunion avec convocation, lieu précis et ordre du jour
             * détaillé : aucune entité de planification (convocation, lieu,
             * ordre du jour) n'existe côté API pour ce module (voir
             * `quarter.compensation.gap.note` et le rapport de livraison).
             * Seules l'étape en cours et l'échéance réelle de la réunion
             * (`/settlement/quarter/:q/pipeline`, Art. 17-18) sont affichées.
             */}
            <div className="sheet">
              <div className="sheet-head">
                <span>{t('quarter.compensation.title')}</span>
                <Tag tone={data.closedAt ? 'ok' : 'warn'}>{t(data.closedAt ? 'quarter.compensation.status.CLOSED' : 'quarter.compensation.status.OPEN')}</Tag>
              </div>
              <div className="sheet-body">
                {pipelineQuery.isLoading ? (
                  <p>{t('common.loading')}</p>
                ) : pipelineQuery.error || !pipelineQuery.data ? (
                  <p style={{ color: 'var(--ink-3)' }}>{t('common.noData')}</p>
                ) : (
                  <>
                    {currentStep ? (
                      <p style={{ margin: '0 0 var(--s-3)' }}>
                        <strong style={{ display: 'block', fontSize: 'var(--k-fs-s)' }}>{currentStep.label}</strong>
                        <span className="mono" style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)' }}>
                          {currentStep.article}
                        </span>{' '}
                        <Tag tone={currentStep.overdue ? 'ko' : 'warn'}>{t('quarter.pipeline.status.EN_COURS')}</Tag>
                        <br />
                        <span style={{ fontSize: 'var(--k-fs-s)', color: 'var(--ink-2)' }}>
                          {t('quarter.pipeline.dueDate')} : <span className="mono">{formatIsoDate(currentStep.dueDate, locale)}</span>
                        </span>
                      </p>
                    ) : null}
                    {meetingStep ? (
                      <p style={{ margin: 0 }}>
                        <strong style={{ display: 'block', fontSize: 'var(--k-fs-s)' }}>{t('quarter.compensation.meeting.label')}</strong>
                        <span style={{ fontSize: 'var(--k-fs-s)', color: 'var(--ink-2)' }}>{meetingStep.label}</span>
                        <br />
                        <span style={{ fontSize: 'var(--k-fs-s)', color: 'var(--ink-2)' }}>
                          {t('quarter.pipeline.dueDate')} : <span className="mono">{formatIsoDate(meetingStep.dueDate, locale)}</span>
                          {meetingStep.completedAt ? (
                            <>
                              {' · '}
                              {t('quarter.pipeline.completedAt')} <span className="mono">{new Date(meetingStep.completedAt).toLocaleString(locale)}</span>
                            </>
                          ) : null}
                        </span>
                      </p>
                    ) : null}
                  </>
                )}
                <p className="note" style={{ marginTop: 'var(--s-4)', marginBottom: 0, fontSize: 'var(--k-fs-xs)' }}>
                  {t('quarter.compensation.gap.note')}
                </p>
              </div>
            </div>

            <div className="sheet" id="quarter-positions">
              <div className="sheet-head">
                <span>{t('quarter.net.title')}</span>
                <button
                  type="button"
                  onClick={() =>
                    downloadCsv(
                      `positions-nettes-${quarter}.csv`,
                      buildCsv(['compagnie', 'position_nette'], data.net.map((n) => [n.code, n.net])),
                    )
                  }
                  disabled={data.net.length === 0}
                  title={t('common.exportExcel.note')}
                  style={{ padding: '4px 10px', borderRadius: 'var(--k-r-s)', border: '1px solid var(--rule-strong)', background: 'var(--paper)', color: 'var(--ink)', font: 'inherit', cursor: data.net.length === 0 ? 'not-allowed' : 'pointer' }}
                >
                  {t('common.exportExcel')}
                </button>
              </div>
              <div className="sheet-body">
                <div className="t-wrap">
                  <table className="t">
                    <thead>
                      <tr>
                        <th>{t('quarter.net.col.company')}</th>
                        <th>{t('quarter.net.col.receivable')}</th>
                        <th>{t('quarter.net.col.payable')}</th>
                        <th>{t('quarter.net.col.position')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.net.map((n) => (
                        <tr key={n.code}>
                          <td style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <CoChip code={n.code} />
                            <span className="mono">{n.code}</span>
                          </td>
                          <td className="mono">{n.net > 0 ? formatDzd(n.net, locale) : '—'}</td>
                          <td className="mono">{n.net < 0 ? formatDzd(-n.net, locale) : '—'}</td>
                          <td>
                            <Tag tone={n.net >= 0 ? 'ok' : 'ko'}>{n.net >= 0 ? t('quarter.net.receivable') : t('quarter.net.payable')}</Tag>{' '}
                            <span className="mono">{formatDzd(Math.abs(n.net), locale)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <div className="sheet" style={{ marginBottom: 'var(--s-5)' }}>
            <div className="sheet-head">
              <span>{t('quarter.rawMatrix.title')}</span>
            </div>
            <div className="sheet-body">
              {matrixQuery.isLoading ? (
                <p>{t('common.loading')}</p>
              ) : matrixQuery.error || !rawMatrix || rawMatrix.companies.length === 0 ? (
                <p style={{ color: 'var(--ink-3)' }}>{t('common.noData')}</p>
              ) : (
                <>
                  <div className="t-wrap">
                    <table className="t" aria-label={t('quarter.rawMatrix.title')}>
                      <thead>
                        <tr>
                          <th>{t('quarter.rawMatrix.from')}</th>
                          {rawMatrix.companies.map((c) => (
                            <th key={c}>
                              <CoChip code={c} />
                            </th>
                          ))}
                          <th>{t('quarter.net.receivable')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rawMatrix.companies.map((from) => (
                          <tr key={from}>
                            <td>
                              <CoChip code={from} />
                            </td>
                            {rawMatrix.companies.map((to) => {
                              const amount = rawAmountAt(from, to);
                              const intensity = from === to ? 0 : amount / rawMax;
                              return (
                                <td
                                  key={to}
                                  className="mono"
                                  style={from === to ? undefined : { background: heatColor(intensity), color: intensity > 0.6 ? '#fff' : 'var(--ink)' }}
                                >
                                  {from === to || amount === 0 ? <span style={{ color: 'var(--ink-3)' }}>—</span> : formatDzd(amount, locale)}
                                </td>
                              );
                            })}
                            <td className="mono">{formatDzd(rowTotals.get(from) ?? 0, locale)}</td>
                          </tr>
                        ))}
                        <tr>
                          <td>{t('quarter.rawMatrix.payableRow')}</td>
                          {rawMatrix.companies.map((c) => (
                            <td key={c} className="mono">
                              {formatDzd(colTotals.get(c) ?? 0, locale)}
                            </td>
                          ))}
                          <td />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 'var(--s-3)', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)' }}>{t('quarter.rawMatrix.legend.title')}</span>
                    {[0, 0.25, 0.5, 0.75, 1].map((stop) => (
                      <span key={stop} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ width: 16, height: 12, background: heatColor(stop), border: '1px solid var(--rule)', display: 'inline-block' }} />
                        <span className="mono" style={{ fontSize: 'var(--k-fs-xs)' }}>
                          {formatDzd(Math.round(stop * rawMax), locale)}
                        </span>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="sheet" style={{ marginBottom: 'var(--s-5)' }}>
            <div className="sheet-head">
              <span>
                {t('quarter.flow.titlePrefix')}
                {rawMatrix?.companies.length ?? 0}
                {t('quarter.flow.titleSuffix')}
              </span>
            </div>
            <div className="sheet-body">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--s-4)', flexWrap: 'wrap', marginBottom: 'var(--s-3)' }}>
                <Tabs
                  items={[
                    { key: 'multilateral', label: t('quarter.flow.multilateral') },
                    { key: 'bilateral', label: t('quarter.flow.bilateral') },
                  ]}
                  activeKey={flowMode}
                  onChange={(key) => setFlowMode(key as FlowDiagramMode)}
                />
                <p style={{ fontSize: 'var(--k-fs-s)', color: 'var(--ink-2)', margin: 0 }}>{t('quarter.flow.caption')}</p>
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

          <div className="sheet" style={{ marginTop: 'var(--s-5)', marginBottom: 'var(--s-5)' }}>
            <div className="sheet-head">
              <span>{t('quarter.bordereau.title')}</span>
            </div>
            <div className="sheet-body">
              <p style={{ fontSize: 'var(--k-fs-s)', color: 'var(--ink-2)', marginTop: 0 }}>{t('quarter.bordereau.reference')}</p>
              <p className="mono" style={{ fontSize: 'var(--k-fs-l)', fontWeight: 700 }}>
                {data.bordereau}
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
                  <p style={{ fontSize: 'var(--k-fs-s)', color: 'var(--ink-2)' }}>
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
    </>
  );
}
