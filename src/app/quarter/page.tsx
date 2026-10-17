'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FolioHeader } from '@/components/FolioHeader';
import { CoChip } from '@/components/ui/CoChip';
import { Tag } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { apiGet } from '@/lib/api-client';
import { PriceGridSummary, QuarterSettlement } from '@/lib/types';

function currentQuarter(): string {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3) + 1;
  return `${now.getFullYear()}-Q${q}`;
}

function formatDzd(amount: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'DZD', maximumFractionDigits: 0, signDisplay: 'always' }).format(amount);
  } catch {
    return `${amount >= 0 ? '+' : ''}${amount.toLocaleString()} DA`;
  }
}

/** Export CSV client (placeholder documenté — voir rapport de livraison : l'API ne renvoie qu'un identifiant de bordereau, pas de fichier). */
function buildQuarterCsv(data: QuarterSettlement): string {
  const lines = ['section;from;to;amount'];
  for (const p of data.positions) lines.push(['POSITION', p.from, p.to, p.amount].join(';'));
  for (const n of data.net) lines.push(['NET', n.code, '', n.net].join(';'));
  return lines.join('\n');
}

function downloadText(fileName: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function QuarterPage() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const [quarter, setQuarter] = useState(currentQuarter());

  const query = useQuery({
    queryKey: ['settlement', 'quarter', quarter],
    queryFn: () => apiGet<QuarterSettlement>(`/settlement/quarter/${quarter}`),
    enabled: /^\d{4}-Q[1-4]$/.test(quarter),
  });

  // Référence à la grille tarifaire courante (TARIF-2026.01, B.8) — lue depuis l'API
  // (`GET /pricing/grid`, MeteringModule), jamais recalculée côté front.
  const gridQuery = useQuery({
    queryKey: ['pricing', 'grid'],
    queryFn: () => apiGet<PriceGridSummary>('/pricing/grid'),
  });

  const data = query.data;

  const companies = useMemo(() => (data ? data.net.map((n) => n.code) : []), [data]);
  const matrix = useMemo(() => {
    const m = new Map<string, number>();
    data?.positions.forEach((p) => m.set(`${p.from}:${p.to}`, p.amount));
    return m;
  }, [data]);

  function onDownload() {
    if (!data) return;
    downloadText(`bordereau-trimestriel-${data.quarter}.csv`, buildQuarterCsv(data));
    toast(t('quarter.bordereau.download'), 'ok');
  }

  return (
    <>
      <FolioHeader badge="Module D · §6.6" title={t('quarter.title')} subtitle={t('quarter.subtitle')} />

      <div className="sheet" style={{ marginBottom: 'var(--s-5)' }}>
        <div className="sheet-body" style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)', flexWrap: 'wrap' }}>
          <label htmlFor="quarter-select" style={{ fontSize: 'var(--k-fs-s)', color: 'var(--ink-2)' }}>
            {t('quarter.period.label')}
          </label>
          <select
            id="quarter-select"
            value={quarter}
            onChange={(e) => setQuarter(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid var(--rule-strong)', borderRadius: 'var(--k-r-s)', font: 'inherit', background: 'var(--paper)', color: 'var(--ink)' }}
          >
            {quarterOptions().map((q) => (
              <option key={q} value={q}>
                {q}
              </option>
            ))}
          </select>

          {gridQuery.data ? (
            <span className="mono" style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)', marginInlineStart: 'auto' }}>
              {t('quarter.tariff.reference')} : {gridQuery.data.version}
            </span>
          ) : null}
        </div>
      </div>

      {query.isLoading ? (
        <p>{t('common.loading')}</p>
      ) : query.error || !data ? (
        <div className="note ko" role="alert">
          <span>{t('common.error')}</span>
          <button type="button" onClick={() => query.refetch()}>
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <>
          <div className="sheet" style={{ marginBottom: 'var(--s-5)' }}>
            <div className="sheet-head">
              <span>{t('quarter.positions.title')}</span>
            </div>
            <div className="sheet-body">
              <div className="t-wrap">
                <table className="t">
                  <thead>
                    <tr>
                      <th>{t('quarter.col.from')} \ {t('quarter.col.to')}</th>
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
                        {companies.map((to) => (
                          <td key={to} className="mono">
                            {from === to ? <span style={{ color: 'var(--ink-3)' }}>—</span> : formatDzd(matrix.get(`${from}:${to}`) ?? 0, locale).replace('+', '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="sheet" style={{ marginBottom: 'var(--s-5)' }}>
            <div className="sheet-head">
              <span>{t('quarter.net.title')}</span>
            </div>
            <div className="sheet-body" style={{ display: 'flex', gap: 'var(--s-3)', flexWrap: 'wrap' }}>
              {data.net.map((n) => (
                <span key={n.code} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <CoChip code={n.code} />
                  <Tag tone={n.net >= 0 ? 'ok' : 'ko'}>{formatDzd(n.net, locale)}</Tag>
                </span>
              ))}
            </div>
          </div>

          <div className="sheet">
            <div className="sheet-head">
              <span>{t('quarter.bordereau.title')}</span>
            </div>
            <div className="sheet-body">
              <p>
                <span className="mono">{data.bordereau}</span>
              </p>
              <button
                type="button"
                onClick={onDownload}
                style={{ padding: '8px 16px', borderRadius: 'var(--k-r-s)', border: '1px solid var(--k-pri)', background: 'var(--k-pri)', color: '#fff', font: 'inherit', cursor: 'pointer' }}
              >
                {t('quarter.bordereau.download')}
              </button>
              <p style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)', marginTop: 'var(--s-3)' }}>{t('quarter.bordereau.note')}</p>
            </div>
          </div>
        </>
      )}
    </>
  );
}

/** Quelques trimestres autour de l'actuel — l'API ignore le contenu exact du mock, mais une liste bornée reste une UX plus sûre qu'un champ libre. */
function quarterOptions(): string[] {
  const now = new Date();
  const year = now.getFullYear();
  const options: string[] = [];
  for (const y of [year - 1, year, year + 1]) {
    for (let q = 1; q <= 4; q++) options.push(`${y}-Q${q}`);
  }
  return options;
}
