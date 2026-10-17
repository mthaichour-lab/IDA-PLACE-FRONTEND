'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { FolioHeader } from '@/components/FolioHeader';
import { CoChip } from '@/components/ui/CoChip';
import { Tag } from '@/components/ui/Tag';
import { useI18n } from '@/i18n/provider';
import { apiGet } from '@/lib/api-client';
import { PriceGrid, SettlementQuarter } from '@/lib/types';

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

  const gridQuery = useQuery({
    queryKey: ['pricing', 'grid'],
    queryFn: () => apiGet<PriceGrid>('/pricing/grid'),
  });

  const data = quarterQuery.data;
  const companies = useMemo(() => {
    if (!data) return [];
    const codes = new Set<string>();
    for (const p of data.positions) {
      codes.add(p.from);
      codes.add(p.to);
    }
    return Array.from(codes).sort();
  }, [data]);

  function amountAt(from: string, to: string): number | undefined {
    return data?.positions.find((p) => p.from === from && p.to === to)?.amount;
  }

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
          <div className="sheet" style={{ marginBottom: 'var(--s-5)' }}>
            <div className="sheet-head">
              <span>{t('quarter.matrix.title')}</span>
            </div>
            <div className="sheet-body">
              <div className="t-wrap">
                <table className="t" aria-label={t('quarter.matrix.title')}>
                  <thead>
                    <tr>
                      <th>{t('quarter.matrix.from')}</th>
                      {companies.map((c) => (
                        <th key={c}>
                          <CoChip code={c} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {companies.map((from) => (
                      <tr key={from}>
                        <td>
                          <CoChip code={from} />
                        </td>
                        {companies.map((to) => {
                          const amount = amountAt(from, to);
                          return (
                            <td key={to} className="mono">
                              {from === to || amount === undefined ? <span style={{ color: 'var(--ink-3)' }}>—</span> : formatDzd(amount, locale)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="grid g-side2" style={{ marginBottom: 'var(--s-5)' }}>
            <div className="sheet" style={{ gridColumn: 'span 2' }}>
              <div className="sheet-head">
                <span>{t('quarter.net.title')}</span>
              </div>
              <div className="sheet-body" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-3)' }}>
                {data.net.map((n) => (
                  <div key={n.code} style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--rule)', borderRadius: 'var(--k-r-m)', padding: 'var(--s-3) var(--s-4)' }}>
                    <CoChip code={n.code} />
                    <span className="mono">{formatDzd(Math.abs(n.net), locale)}</span>
                    <Tag tone={n.net >= 0 ? 'ok' : 'ko'}>{n.net >= 0 ? t('quarter.net.receivable') : t('quarter.net.payable')}</Tag>
                  </div>
                ))}
              </div>
            </div>

            <div className="sheet">
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
