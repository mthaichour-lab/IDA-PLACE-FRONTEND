'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { FolioHeader } from '@/components/FolioHeader';
import { BarChart } from '@/components/ui/BarChart';
import { Tabs } from '@/components/ui/Tabs';
import { Tile, TileGrid } from '@/components/ui/TileGrid';
import { useI18n } from '@/i18n/provider';
import { TranslationKey } from '@/i18n/translations';
import { apiGet } from '@/lib/api-client';
import { MonthlyActivity, WilayaStat } from '@/lib/types';

type MeasureKey = 'declarations' | 'montants';

const MEASURES: { key: MeasureKey; label: TranslationKey }[] = [
  { key: 'declarations', label: 'stats.measure.declarations' },
  { key: 'montants', label: 'stats.measure.montants' },
];

const MONTHLY_SERIES: { key: keyof Pick<MonthlyActivity, 'declarations' | 'econstat' | 'autresCanaux'>; label: TranslationKey }[] = [
  { key: 'declarations', label: 'stats.monthly.declarations' },
  { key: 'econstat', label: 'stats.monthly.econstat' },
  { key: 'autresCanaux', label: 'stats.monthly.autresCanaux' },
];

function monthShort(month: string): string {
  return month.slice(5); // "2026-03" -> "03"
}

export default function StatsPage() {
  const { t } = useI18n();
  const [measure, setMeasure] = useState<MeasureKey>('declarations');

  const wilayasQuery = useQuery({
    queryKey: ['stats', 'wilayas'],
    queryFn: () => apiGet<WilayaStat[]>('/stats/wilayas'),
  });

  const monthlyQuery = useQuery({
    queryKey: ['stats', 'monthly'],
    queryFn: () => apiGet<MonthlyActivity[]>('/stats/monthly'),
  });

  const wilayas = wilayasQuery.data ?? [];

  // Intensité de tuile (0..1) : simple normalisation d'affichage par rapport
  // au maximum de la mesure sélectionnée — aucune règle métier, juste une
  // échelle de couleur (même esprit que ScoreBar).
  const tiles: Tile[] = useMemo(() => {
    const max = Math.max(1, ...wilayas.map((w) => w[measure]));
    return wilayas.map((w) => ({
      key: w.code,
      code: w.code,
      label: w.name,
      value: w[measure],
      col: w.col,
      row: w.row,
      intensity: w[measure] / max,
    }));
  }, [wilayas, measure]);

  const monthly = monthlyQuery.data ?? [];

  return (
    <>
      <FolioHeader badge="Module H · §6.10" title={t('stats.title')} subtitle={t('stats.subtitle')} />

      <div className="sheet" style={{ marginBottom: 'var(--s-5)' }}>
        <div className="sheet-head">
          <span>{t('stats.map.title')}</span>
        </div>
        <div className="sheet-body">
          <Tabs items={MEASURES.map((m) => ({ key: m.key, label: t(m.label) }))} activeKey={measure} onChange={(k) => setMeasure(k as MeasureKey)} />

          {wilayasQuery.isLoading ? (
            <p>{t('common.loading')}</p>
          ) : wilayasQuery.error || wilayas.length === 0 ? (
            <div className="note warn" role="status">
              <span>{t('stats.empty')}</span>
            </div>
          ) : (
            <TileGrid tiles={tiles} cols={13} />
          )}
        </div>
      </div>

      <div className="grid g-side2" style={{ marginBottom: 'var(--s-5)' }}>
        {MONTHLY_SERIES.map((s) => (
          <div key={s.key} className="sheet">
            <div className="sheet-head">
              <span>{t(s.label)}</span>
            </div>
            <div className="sheet-body">
              {monthlyQuery.isLoading ? (
                <p>{t('common.loading')}</p>
              ) : monthlyQuery.error || monthly.length === 0 ? (
                <p style={{ color: 'var(--ink-3)' }}>{t('stats.empty')}</p>
              ) : (
                <BarChart data={monthly.map((m) => ({ label: monthShort(m.month), value: m[s.key] }))} height={100} />
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="sheet">
        <div className="sheet-head">
          <span>{t('stats.econstat.title')}</span>
        </div>
        <div className="sheet-body">
          {monthlyQuery.isLoading ? (
            <p>{t('common.loading')}</p>
          ) : monthlyQuery.error || monthly.length === 0 ? (
            <p style={{ color: 'var(--ink-3)' }}>{t('stats.empty')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 'var(--s-4)', fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)' }}>
                <span>
                  <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--k-pri-2)', marginInlineEnd: 6 }} />
                  {t('stats.econstat.econstat')}
                </span>
                <span>
                  <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--rule-strong)', marginInlineEnd: 6 }} />
                  {t('stats.econstat.autresCanaux')}
                </span>
              </div>
              {monthly.map((m) => {
                const total = Math.max(1, m.econstat + m.autresCanaux);
                const econstatPct = (m.econstat / total) * 100;
                return (
                  <div key={m.month} style={{ display: 'grid', gridTemplateColumns: '48px 1fr 96px', alignItems: 'center', gap: 8 }}>
                    <span className="mono" style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)' }}>
                      {monthShort(m.month)}
                    </span>
                    <div style={{ display: 'flex', height: 10, borderRadius: 'var(--k-r-pill)', overflow: 'hidden', background: 'var(--rule)' }}>
                      <div style={{ width: `${econstatPct}%`, background: 'var(--k-pri-2)' }} />
                      <div style={{ width: `${100 - econstatPct}%`, background: 'var(--rule-strong)' }} />
                    </div>
                    <span className="mono" style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)', textAlign: 'end' }}>
                      {m.econstat} / {m.autresCanaux}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
