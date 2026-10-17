'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { FolioHeader } from '@/components/FolioHeader';
import { CoChip } from '@/components/ui/CoChip';
import { Kpi, KpiRow } from '@/components/ui/Kpi';
import { Tag } from '@/components/ui/Tag';
import { useI18n } from '@/i18n/provider';
import { apiGet } from '@/lib/api-client';
import { PriceGrid, SettlementQuarter, SettlementQuarterMatrix, SettlementQuarterSummary } from '@/lib/types';

function formatDzd(amount: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'DZD', maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount.toLocaleString()} DA`;
  }
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

  const quarterQuery = useQuery({
    queryKey: ['settlement', 'quarter', quarter],
    queryFn: () => apiGet<SettlementQuarter>(`/settlement/quarter/${quarter}`),
  });

  const summaryQuery = useQuery({
    queryKey: ['settlement', 'quarter', quarter, 'summary'],
    queryFn: () => apiGet<SettlementQuarterSummary>(`/settlement/quarter/${quarter}/summary`),
  });

  const matrixQuery = useQuery({
    queryKey: ['settlement', 'quarter', quarter, 'matrix'],
    queryFn: () => apiGet<SettlementQuarterMatrix>(`/settlement/quarter/${quarter}/matrix`),
  });

  const gridQuery = useQuery({
    queryKey: ['pricing', 'grid'],
    queryFn: () => apiGet<PriceGrid>('/pricing/grid'),
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

  return (
    <>
      <FolioHeader badge="Module D · §6.6" title={t('quarter.title')} subtitle={t('quarter.subtitle')} />

      <div className="sheet" style={{ marginBottom: 'var(--s-5)' }}>
        <div className="sheet-body">
          <label htmlFor="quarter-select" style={{ display: 'block', fontSize: 'var(--k-fs-s)', color: 'var(--ink-2)', marginBottom: 4 }}>
            {t('quarter.period.label')}
          </label>
          <select
            id="quarter-select"
            value={quarter}
            onChange={(e) => setQuarter(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid var(--rule-strong)', borderRadius: 'var(--k-r-s)', font: 'inherit', background: 'var(--paper)', color: 'var(--ink)' }}
          >
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
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
          <div className="sheet" style={{ marginTop: 'var(--s-5)', marginBottom: 'var(--s-5)' }}>
            <div className="sheet-head">
              <span>{t('quarter.net.title')}</span>
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
                                style={from === to ? undefined : { background: `color-mix(in srgb, var(--k-pri-2) ${Math.round(intensity * 70)}%, var(--paper))` }}
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
              )}
            </div>
          </div>

          <div className="sheet" style={{ marginBottom: 'var(--s-5)' }}>
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
