'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { FolioHeader } from '@/components/FolioHeader';
import { BarChart } from '@/components/ui/BarChart';
import { Kpi, KpiRow } from '@/components/ui/Kpi';
import { Tabs } from '@/components/ui/Tabs';
import { POPULATION_SOURCE_LABELS } from '@/components/referential/labels';
import { Tile, TileGrid, UNAVAILABLE_BACKGROUND } from '@/components/ui/TileGrid';
import { useI18n } from '@/i18n/provider';
import { TranslationKey } from '@/i18n/translations';
import { apiGet } from '@/lib/api-client';
import { publishedCases, publishedCategories, useBaremeVersions, useVehicleCategories } from '@/lib/bareme';
import { currentUtcYear, formatIsoDay } from '@/lib/iso-date';
import { MonthlyActivity, StatsRepartition, StatsSummary, WilayaPopulation, WilayaStat } from '@/lib/types';

type MeasureKey = 'declarations' | 'montants' | 'per100k';

const MEASURES: { key: MeasureKey; label: TranslationKey }[] = [
  { key: 'declarations', label: 'stats.measure.declarations' },
  { key: 'montants', label: 'stats.measure.montants' },
  { key: 'per100k', label: 'stats.measure.per100k' },
];

const MONTHLY_SERIES: { key: keyof Pick<MonthlyActivity, 'declarations' | 'annexes2' | 'oppositions' | 'indemnises'>; label: TranslationKey }[] = [
  { key: 'declarations', label: 'stats.monthly.declarations' },
  { key: 'annexes2', label: 'stats.monthly.annexes2' },
  { key: 'oppositions', label: 'stats.monthly.oppositions' },
  { key: 'indemnises', label: 'stats.monthly.indemnises' },
];

const TOP_WILAYAS_COUNT = 5;

function monthShort(month: string): string {
  return month.slice(5); // "2026-03" -> "03"
}

function formatDzd(amount: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'DZD', maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount.toLocaleString()} DA`;
  }
}

function measureValue(w: WilayaStat, measure: MeasureKey): number | null {
  return measure === 'per100k' ? w.per100k : w[measure];
}

/** Ligne « vs IRSAM » du KPI délai moyen — jamais de valeur en dur : seule une référence validée UAR est comparée (décision PO §4). */
function irsamExtra(summary: StatsSummary, t: (k: TranslationKey) => string, locale: string): string {
  const ref = summary.irsam;
  if (!ref) return t(summary.irsamStatus === 'EN_ATTENTE_VALIDATION' ? 'stats.kpi.irsam.pending' : 'stats.kpi.irsam.notSet');
  const parts = [`${t('stats.kpi.irsam.vs')} ${ref.value} j (${formatIsoDay(ref.periodFrom, locale, 'short')} – ${formatIsoDay(ref.periodTo, locale, 'short')}, ${ref.sourceRef})`];
  if (ref.deltaDays !== null) parts.push(`${t('stats.kpi.irsam.delta')} ${ref.deltaDays > 0 ? '+' : ''}${ref.deltaDays} j`);
  return parts.join(' · ');
}

/** Répartition Art. 14 (décision PO §5) : les dossiers sans valeur sont toujours comptés à part. */
function RepartitionBlock({ title, data, published, emptyLabel }: { title: string; data: StatsRepartition; published: boolean; emptyLabel: string }) {
  const { t, locale } = useI18n();
  const max = Math.max(1, ...data.items.map((i) => i.count));
  return (
    <section aria-label={title}>
      <strong style={{ display: 'block', marginBottom: 'var(--s-2)', fontSize: 'var(--k-fs-s)' }}>{title}</strong>
      {data.items.length === 0 && !published ? (
        <div className="note warn" role="status" style={{ marginBottom: 'var(--s-2)' }}>
          <span>{emptyLabel}</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 'var(--s-2)' }}>
          {data.items.map((i) => (
            <div key={i.code} style={{ display: 'grid', gridTemplateColumns: '96px 1fr 56px', alignItems: 'center', gap: 8 }}>
              <span className="mono" style={{ fontSize: 'var(--k-fs-xs)' }}>
                {i.code}
              </span>
              <div style={{ height: 10, borderRadius: 'var(--k-r-pill)', background: 'var(--rule)', overflow: 'hidden' }}>
                <div style={{ width: `${(i.count / max) * 100}%`, height: '100%', background: 'var(--k-pri-2)' }} />
              </div>
              <span className="mono" style={{ fontSize: 'var(--k-fs-xs)', textAlign: 'end' }}>
                {i.count.toLocaleString(locale)}
              </span>
            </div>
          ))}
        </div>
      )}
      <p style={{ margin: 0, fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)' }}>
        {t('stats.art14.sansValeur')} : <span className="mono">{data.sansValeur.toLocaleString(locale)}</span>
      </p>
    </section>
  );
}

export default function StatsPage() {
  const { t, locale } = useI18n();
  const [measure, setMeasure] = useState<MeasureKey>('declarations');
  /** Année étudiée — '' = toutes les années (le back ne calcule alors pas `per100k`). */
  const [year, setYear] = useState('');

  const summaryQuery = useQuery({
    queryKey: ['stats', 'summary'],
    queryFn: () => apiGet<StatsSummary>('/stats/summary'),
  });

  const wilayasQuery = useQuery({
    queryKey: ['stats', 'wilayas', year],
    queryFn: () => apiGet<WilayaStat[]>('/stats/wilayas', { year: year || undefined }),
  });

  const monthlyQuery = useQuery({
    queryKey: ['stats', 'monthly'],
    queryFn: () => apiGet<MonthlyActivity[]>('/stats/monthly'),
  });

  // Populations de référence (écran 12) : sans aucune population valide, la mesure « Pour 100 000 hab. » est désactivée.
  const populationsQuery = useQuery({
    queryKey: ['referential', 'wilaya-populations'],
    queryFn: () => apiGet<WilayaPopulation[]>('/referential/wilaya-populations'),
  });

  const versionsQuery = useBaremeVersions();
  const categoriesQuery = useVehicleCategories();

  const wilayas = wilayasQuery.data ?? [];
  const monthly = monthlyQuery.data ?? [];
  const summary = summaryQuery.data;

  const hasPopulation = (populationsQuery.data ?? []).some((p) => p.valid);
  const per100kDisabledReason = !hasPopulation ? t('stats.per100k.disabled.noPopulation') : !year ? t('stats.per100k.disabled.noYear') : null;
  const activeMeasure: MeasureKey = measure === 'per100k' && per100kDisabledReason ? 'declarations' : measure;

  // Année courante lue après le montage seulement : la page est pré-rendue au
  // build, une année calculée au rendu pourrait différer à l'hydratation.
  const [thisYear, setThisYear] = useState<number | null>(null);
  useEffect(() => setThisYear(currentUtcYear()), []);

  const yearOptions = useMemo(() => {
    const years = new Set<number>(monthly.map((m) => Number(m.month.slice(0, 4))).filter((y) => Number.isInteger(y) && y > 0));
    if (thisYear !== null) years.add(thisYear);
    return [...years].sort((a, b) => b - a);
  }, [monthly, thisYear]);

  // Intensité de tuile (0..1) : simple normalisation d'affichage par rapport
  // au maximum de la mesure sélectionnée — aucune règle métier, juste une
  // échelle de couleur (même esprit que ScoreBar). Une wilaya sans valeur
  // (`per100k` null) est hachurée « n.d. » et exclue de l'échelle.
  const tiles: Tile[] = useMemo(() => {
    const max = Math.max(1, ...wilayas.map((w) => measureValue(w, activeMeasure) ?? 0));
    return wilayas.map((w) => {
      const value = measureValue(w, activeMeasure);
      const base = { key: w.code, code: w.code, label: w.name, col: w.col, row: w.row };
      if (value === null) {
        return { ...base, unavailable: true, unavailableLabel: t('stats.per100k.nd'), title: `${w.code} — ${w.name} : ${t('stats.per100k.nd')} — ${t('stats.per100k.missing')}` };
      }
      const ref = activeMeasure === 'per100k' ? w.populationRef : null;
      return {
        ...base,
        value,
        intensity: value / max,
        title: ref
          ? `${w.code} — ${w.name} : ${value} · ${t('stats.per100k.tooltip.population')} ${ref.population.toLocaleString(locale)} (${t(POPULATION_SOURCE_LABELS[ref.sourceType])} ${ref.referenceYear}, ${ref.sourceRef})`
          : undefined,
      };
    });
  }, [wilayas, activeMeasure, t, locale]);

  const missingPopulationCount = activeMeasure === 'per100k' ? wilayas.filter((w) => w.per100k === null).length : 0;

  const topWilayas = useMemo(
    () =>
      wilayas
        .map((w) => ({ w, value: measureValue(w, activeMeasure) }))
        .filter((x): x is { w: WilayaStat; value: number } => x.value !== null && x.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, TOP_WILAYAS_COUNT),
    [wilayas, activeMeasure],
  );

  return (
    <>
      <FolioHeader badge="Module H · §6.10" title={t('stats.title')} subtitle={t('stats.subtitle')} />

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
          <Kpi value={summary.declarations.toLocaleString(locale)} label={t('stats.kpi.declarations')} />
          <Kpi value={`${summary.oppositionRatePct}%`} label={t('stats.kpi.oppositionRate')} />
          <Kpi value={formatDzd(summary.settledAmount, locale)} label={t('stats.kpi.settledAmount')} />
          <Kpi
            value={summary.avgSettlementDays === null ? t('stats.kpi.avgSettlementDays.unavailable') : `${summary.avgSettlementDays} j`}
            label={t('stats.kpi.avgSettlementDays')}
            extra={irsamExtra(summary, t, locale)}
            title={
              summary.irsam
                ? `${t('stats.kpi.avgSettlementDays.definition')} ${t('stats.kpi.irsam.vs')} ${summary.irsam.measureDefinition.startEvent} → ${summary.irsam.measureDefinition.endEvent} · ${summary.irsam.measureDefinition.scope}`
                : t('stats.kpi.avgSettlementDays.definition')
            }
          />
        </KpiRow>
      )}

      <div className="grid g-side" style={{ marginTop: 'var(--s-5)', marginBottom: 'var(--s-5)' }}>
        <div className="sheet">
          <div className="sheet-head">
            <span>{t('stats.map.title')}</span>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)' }}>
              {t('stats.year.label')}
              <select
                value={year}
                onChange={(e) => setYear(e.target.value)}
                style={{ font: 'inherit', border: '1px solid var(--rule-strong)', borderRadius: 'var(--k-r-s)', padding: '4px 8px', background: 'var(--paper)', color: 'var(--ink)' }}
              >
                <option value="">{t('stats.year.all')}</option>
                {yearOptions.map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="sheet-body">
            <Tabs
              items={MEASURES.map((m) => ({
                key: m.key,
                label: t(m.label),
                ...(m.key === 'per100k' && per100kDisabledReason ? { disabled: true, title: per100kDisabledReason } : {}),
              }))}
              activeKey={activeMeasure}
              onChange={(k) => setMeasure(k as MeasureKey)}
            />
            {per100kDisabledReason ? <p style={{ marginTop: 0, fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)' }}>{per100kDisabledReason}</p> : null}

            {wilayasQuery.isLoading ? (
              <p>{t('common.loading')}</p>
            ) : wilayasQuery.error || wilayas.length === 0 ? (
              <div className="note warn" role="status">
                <span>{t('stats.empty')}</span>
              </div>
            ) : (
              <>
                <TileGrid tiles={tiles} cols={13} />
                {activeMeasure === 'per100k' ? (
                  <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)', marginBottom: 0 }}>
                    <span aria-hidden="true" style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 2, border: '1px solid var(--rule)', background: UNAVAILABLE_BACKGROUND }} />
                    {`${missingPopulationCount}/${wilayas.length} ${t('stats.per100k.missing')}`}
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>

        <aside className="sheet" aria-label={t('stats.topWilayas.title')}>
          <div className="sheet-head">
            <span>{t('stats.topWilayas.title')}</span>
          </div>
          <div className="sheet-body">
            {topWilayas.length === 0 ? (
              <p style={{ color: 'var(--ink-3)' }}>{t('stats.empty')}</p>
            ) : (
              <ol style={{ margin: 0, padding: '0 0 0 1.2em', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {topWilayas.map(({ w, value }) => (
                  <li key={w.code} style={{ fontSize: 'var(--k-fs-s)' }}>
                    {w.name} <strong className="mono">{value.toLocaleString(locale)}</strong>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </aside>
      </div>

      <div className="sheet" style={{ marginBottom: 'var(--s-5)' }}>
        <div className="sheet-head">
          <span>{t('stats.monthly.title')}</span>
        </div>
        <div className="sheet-body">
          {monthlyQuery.isLoading ? (
            <p>{t('common.loading')}</p>
          ) : monthlyQuery.error || monthly.length === 0 ? (
            <p style={{ color: 'var(--ink-3)' }}>{t('stats.empty')}</p>
          ) : (
            <div className="grid g-side2">
              {MONTHLY_SERIES.map((s) => (
                <div key={s.key}>
                  <strong style={{ display: 'block', marginBottom: 'var(--s-2)', fontSize: 'var(--k-fs-s)' }}>{t(s.label)}</strong>
                  <BarChart data={monthly.map((m) => ({ label: monthShort(m.month), value: m[s.key] }))} height={100} />
                </div>
              ))}
            </div>
          )}
        </div>
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

      {summary ? (
        <div className="sheet" style={{ marginTop: 'var(--s-5)' }}>
          <div className="sheet-head">
            <span>{t('stats.art14.title')}</span>
          </div>
          <div className="sheet-body">
            <div className="grid g-side2">
              <RepartitionBlock
                title={t('stats.art14.byCode')}
                data={summary.baremeCodes}
                published={publishedCases(versionsQuery.data).length > 0}
                emptyLabel={t('stats.art14.notPublished')}
              />
              <RepartitionBlock
                title={t('stats.art14.byCategory')}
                data={summary.vehicleCategories}
                published={publishedCategories(categoriesQuery.data).length > 0}
                emptyLabel={t('stats.art14.categoriesNotPublished')}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
