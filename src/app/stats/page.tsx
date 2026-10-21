'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { FolioHeader } from '@/components/FolioHeader';
import { Kpi, KpiRow } from '@/components/ui/Kpi';
import { Tabs } from '@/components/ui/Tabs';
import { POPULATION_SOURCE_LABELS } from '@/components/referential/labels';
import { UNAVAILABLE_BACKGROUND } from '@/components/ui/TileGrid';
import { useI18n } from '@/i18n/provider';
import { TranslationKey } from '@/i18n/translations';
import { apiGet } from '@/lib/api-client';
import { publishedCases, publishedCategories, useBaremeVersions, useVehicleCategories } from '@/lib/bareme';
import { currentUtcYear, formatIsoDay } from '@/lib/iso-date';
import { MonthlyActivity, StatsRepartition, StatsSummary, WilayaPopulation, WilayaStat } from '@/lib/types';
import { HBarList, LineChart, LineSeries, rampColor, StackedBars } from './charts';

type MeasureKey = 'declarations' | 'montants' | 'per100k';

const MEASURES: { key: MeasureKey; label: TranslationKey }[] = [
  { key: 'declarations', label: 'stats.measure.declarations' },
  { key: 'montants', label: 'stats.measure.montants' },
  { key: 'per100k', label: 'stats.measure.per100k' },
];

const MONTHLY_SERIES: { key: keyof Pick<MonthlyActivity, 'declarations' | 'annexes2' | 'oppositions' | 'indemnises'>; label: TranslationKey; color: string; dashed?: boolean }[] = [
  { key: 'declarations', label: 'stats.monthly.declarations', color: 'var(--ink)' },
  { key: 'annexes2', label: 'stats.monthly.annexes2', color: 'var(--k-pri-2)' },
  { key: 'oppositions', label: 'stats.monthly.oppositions', color: 'var(--ko)', dashed: true },
  { key: 'indemnises', label: 'stats.monthly.indemnises', color: 'var(--k-acc-2)' },
];

const TOP_WILAYAS_COUNT = 5;
/** Fenêtre affichée de l'activité mensuelle (maquette : une année glissante). */
const MONTHS_SHOWN = 12;
/** Paliers de la légende d'échelle de couleur (0, ¼, ½, ¾, max de la mesure active). */
const SCALE_STEPS = [0, 0.25, 0.5, 0.75, 1];

function formatDzd(amount: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'DZD', maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount.toLocaleString()} DA`;
  }
}

/** Montant compact de la tuile KPI (« 8,22 M DA »), le montant exact reste en infobulle. */
function formatCompactDa(amount: number, locale: string): string {
  try {
    return `${new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 2 }).format(amount)} DA`;
  } catch {
    return `${amount.toLocaleString()} DA`;
  }
}

/** « 2026-03 » → « mars » (UTC : le mois vient de l'API, aucune dépendance au fuseau du poste). */
function monthLabel(month: string, locale: string): string {
  const [y, m] = month.split('-').map(Number);
  try {
    return new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
  } catch {
    return month.slice(5);
  }
}

/**
 * Série mensuelle continue entre le premier et le dernier mois renvoyés :
 * le back n'émet un mois que s'il compte au moins un événement, un mois
 * absent vaut donc 0 sur toutes les séries (agrégat sur l'ensemble des
 * dossiers et recours — voir `StatsService.computeMonthly`). Rien n'est
 * extrapolé au-delà du dernier mois reçu.
 */
function continuousMonths(monthly: MonthlyActivity[]): MonthlyActivity[] {
  const valid = monthly.filter((m) => /^\d{4}-\d{2}$/.test(m.month)).sort((a, b) => a.month.localeCompare(b.month));
  if (valid.length === 0) return [];
  const byMonth = new Map(valid.map((m) => [m.month, m]));
  const [y0, m0] = valid[0].month.split('-').map(Number);
  const [y1, m1] = valid[valid.length - 1].month.split('-').map(Number);
  const out: MonthlyActivity[] = [];
  for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); m === 12 ? ((y += 1), (m = 1)) : (m += 1)) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out.push(byMonth.get(key) ?? { month: key, declarations: 0, econstat: 0, autresCanaux: 0, annexes2: 0, oppositions: 0, indemnises: 0 });
  }
  return out.slice(-MONTHS_SHOWN);
}

function measureValue(w: WilayaStat, measure: MeasureKey): number | null {
  return measure === 'per100k' ? w.per100k : w[measure];
}

/** Détail du comparatif IRSAM (période, source, écart) — jamais de valeur en dur : seule une référence validée UAR est comparée (décision PO §4). */
function irsamDetail(summary: StatsSummary, t: (k: TranslationKey) => string, locale: string): string | null {
  const ref = summary.irsam;
  if (!ref) return null;
  const parts = [`${formatIsoDay(ref.periodFrom, locale, 'short')} – ${formatIsoDay(ref.periodTo, locale, 'short')}`, ref.sourceRef];
  if (ref.deltaDays !== null) parts.push(`${t('stats.kpi.irsam.delta')} ${ref.deltaDays > 0 ? '+' : ''}${ref.deltaDays} j`);
  return parts.join(' · ');
}

/** Écart relatif IDA vs IRSAM, en % (maquette « −67 % ») — seulement si les deux délais existent. */
function irsamDeltaPct(summary: StatsSummary): number | null {
  const ref = summary.irsam;
  if (!ref || summary.avgSettlementDays === null || ref.value <= 0) return null;
  return Math.round(((summary.avgSettlementDays - ref.value) / ref.value) * 100);
}

/** Carte de répartition Art. 14 (décision PO §5) : les dossiers sans valeur sont toujours comptés à part. */
function RepartitionCard({
  id,
  title,
  data,
  labels,
  published,
  emptyLabel,
  note,
}: {
  id: string;
  title: string;
  data: StatsRepartition | undefined;
  labels: Map<string, string>;
  published: boolean;
  emptyLabel: string;
  note?: string;
}) {
  const { t, locale } = useI18n();
  return (
    <section className="sheet st-card" aria-labelledby={id}>
      <div className="sheet-head">
        <span id={id}>{title}</span>
      </div>
      <div className="sheet-body">
        {!data ? (
          <p className="st-empty">{t('stats.empty')}</p>
        ) : (
          <>
            {data.items.length === 0 && !published ? (
              <div className="note warn" role="status">
                <span>{emptyLabel}</span>
              </div>
            ) : (
              <HBarList items={data.items.map((i) => ({ code: i.code, label: labels.get(i.code), count: i.count }))} locale={locale} />
            )}
            <p className="st-foot">
              {t('stats.art14.sansValeur')} : <span className="mono">{data.sansValeur.toLocaleString(locale)}</span>
              {note ? ` · ${note}` : null}
            </p>
          </>
        )}
      </div>
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

  const wilayas = useMemo(() => wilayasQuery.data ?? [], [wilayasQuery.data]);
  const monthly = useMemo(() => monthlyQuery.data ?? [], [monthlyQuery.data]);
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
  // échelle de couleur. Une wilaya sans valeur (`per100k` null) est hachurée
  // « n.d. » et exclue de l'échelle. Position = `col`/`row` du référentiel.
  const scaleMax = useMemo(() => Math.max(0, ...wilayas.map((w) => measureValue(w, activeMeasure) ?? 0)), [wilayas, activeMeasure]);

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

  const months = useMemo(() => continuousMonths(monthly), [monthly]);
  const monthLabels = months.map((m) => monthLabel(m.month, locale));
  const lineSeries: LineSeries[] = MONTHLY_SERIES.map((s) => ({ key: s.key, label: t(s.label), color: s.color, dashed: s.dashed, values: months.map((m) => m[s.key]) }));

  // Adoption e-constat : canal ECONSTAT vs ERP+IMPORT+API (pas « mobile vs agence » : le back ne distingue pas l'appareil, voir StatsService).
  const econstatTotals = monthly.reduce((acc, m) => ({ e: acc.e + m.econstat, o: acc.o + m.autresCanaux }), { e: 0, o: 0 });
  const econstatRate = econstatTotals.e + econstatTotals.o > 0 ? Math.round((econstatTotals.e / (econstatTotals.e + econstatTotals.o)) * 100) : null;

  const caseLabels = useMemo(() => new Map(publishedCases(versionsQuery.data).map((c) => [c.code, c.label])), [versionsQuery.data]);
  const categoryLabels = useMemo(() => new Map(publishedCategories(categoriesQuery.data).map((c) => [c.code, c.label])), [categoriesQuery.data]);

  const deltaPct = summary ? irsamDeltaPct(summary) : null;
  const irsam = summary?.irsam ?? null;
  const delayMax = Math.max(1, irsam?.value ?? 0, summary?.avgSettlementDays ?? 0);

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
        <div className="st-kpis">
          <KpiRow>
            <Kpi value={summary.declarations.toLocaleString(locale)} label={t('stats.kpi.declarations')} />
            <Kpi value={econstatRate === null ? '—' : `${econstatRate} %`} label={t('stats.kpi.econstatRate')} title={t('stats.kpi.econstatRate.definition')} />
            <Kpi
              value={summary.avgSettlementDays === null ? t('stats.kpi.avgSettlementDays.unavailable') : `${summary.avgSettlementDays.toLocaleString(locale)} j`}
              label={t('stats.kpi.avgSettlementDays')}
              title={t('stats.kpi.avgSettlementDays.definition')}
            />
            <Kpi
              value={deltaPct === null ? '—' : `${deltaPct > 0 ? '+' : deltaPct < 0 ? '−' : ''}${Math.abs(deltaPct)} %`}
              label={
                irsam
                  ? `${t('stats.kpi.irsam.short')} (${irsam.value.toLocaleString(locale)} j)`
                  : t(summary.irsamStatus === 'EN_ATTENTE_VALIDATION' ? 'stats.kpi.irsam.pending' : 'stats.kpi.irsam.notSet')
              }
              extra={irsamDetail(summary, t, locale) ?? undefined}
              title={irsam ? `${t('stats.kpi.irsam.short')} : ${irsam.measureDefinition.startEvent} → ${irsam.measureDefinition.endEvent} · ${irsam.measureDefinition.scope}` : undefined}
            />
            <Kpi value={formatCompactDa(summary.settledAmount, locale)} label={t('stats.kpi.settledAmount')} title={formatDzd(summary.settledAmount, locale)} />
            <Kpi value={`${summary.oppositionRatePct.toLocaleString(locale)} %`} label={t('stats.kpi.oppositionRate')} />
          </KpiRow>
        </div>
      )}

      <div className="grid st-top">
        <section className="sheet st-map-card" aria-labelledby="st-map-title">
          <div className="sheet-head">
            <span id="st-map-title">
              {t('stats.map.title')}
              {wilayas.length > 0 ? ` — ${t('stats.map.tiles')} ${wilayas.length} ${t('stats.map.wilayas')}` : null}
            </span>
          </div>
          <div className="sheet-body">
            <div className="st-tabs">
              <select className="st-year" aria-label={t('stats.year.label')} title={t('stats.year.label')} value={year} onChange={(e) => setYear(e.target.value)}>
                  <option value="">{t('stats.year.all')}</option>
                  {yearOptions.map((y) => (
                    <option key={y} value={String(y)}>
                      {y}
                    </option>
                  ))}
              </select>
              <Tabs
                items={MEASURES.map((m) => ({
                  key: m.key,
                  label: t(m.label),
                  ...(m.key === 'per100k' && per100kDisabledReason ? { disabled: true, title: per100kDisabledReason } : {}),
                }))}
                activeKey={activeMeasure}
                onChange={(k) => setMeasure(k as MeasureKey)}
              />
            </div>
            {per100kDisabledReason ? <p className="st-hint">{per100kDisabledReason}</p> : null}

            {wilayasQuery.isLoading ? (
              <p>{t('common.loading')}</p>
            ) : wilayasQuery.error || wilayas.length === 0 ? (
              <div className="note warn" role="status">
                <span>{t('stats.empty')}</span>
              </div>
            ) : (
              <>
                <div className="st-tiles">
                  {wilayas.map((w) => {
                    const value = measureValue(w, activeMeasure);
                    const pos = { gridColumn: w.col + 1, gridRow: w.row + 1 };
                    if (value === null) {
                      return (
                        <div
                          key={w.code}
                          className="st-tile"
                          data-unavailable="true"
                          title={`${w.code} — ${w.name} : ${t('stats.per100k.nd')} — ${t('stats.per100k.missing')}`}
                          style={{ ...pos, background: UNAVAILABLE_BACKGROUND, color: 'var(--ink-3)' }}
                        >
                          <span className="st-tile-code">{w.code}</span>
                          <span className="st-tile-name">{t('stats.per100k.nd')}</span>
                        </div>
                      );
                    }
                    const intensity = scaleMax > 0 ? value / scaleMax : 0;
                    const ref = activeMeasure === 'per100k' ? w.populationRef : null;
                    return (
                      <div
                        key={w.code}
                        className={`st-tile${intensity > 0.45 ? ' dark' : ''}`}
                        title={
                          ref
                            ? `${w.code} — ${w.name} : ${value} · ${t('stats.per100k.tooltip.population')} ${ref.population.toLocaleString(locale)} (${t(POPULATION_SOURCE_LABELS[ref.sourceType])} ${ref.referenceYear}, ${ref.sourceRef})`
                            : `${w.code} — ${w.name} : ${value}`
                        }
                        style={{ ...pos, background: rampColor(intensity) }}
                      >
                        <span className="st-tile-code">{w.code}</span>
                        <span className="st-tile-name">{w.name}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="st-caption">{t('stats.map.caption')}</p>
                {activeMeasure === 'per100k' ? (
                  <p className="st-caption st-nd">
                    <span aria-hidden="true" style={{ background: UNAVAILABLE_BACKGROUND }} />
                    {`${missingPopulationCount}/${wilayas.length} ${t('stats.per100k.missing')}`}
                  </p>
                ) : null}
              </>
            )}

            <div className="st-map-foot">
              {wilayas.length > 0 ? (
                <div className="st-scale" aria-label={t('stats.map.scale')}>
                  {SCALE_STEPS.map((s) => (
                    <span key={s}>
                      <i aria-hidden="true" style={{ background: rampColor(s) }} />
                      {(Math.round(scaleMax * s * 100) / 100).toLocaleString(locale)}
                    </span>
                  ))}
                </div>
              ) : (
                <span />
              )}
              <section className="st-top-zones" aria-labelledby="st-top-title">
                <h3 id="st-top-title">{t('stats.topWilayas.title')}</h3>
                {topWilayas.length === 0 ? (
                  <p className="st-empty">{t('stats.empty')}</p>
                ) : (
                  <ol>
                    {topWilayas.map(({ w, value }) => (
                      <li key={w.code}>
                        {w.name} <span className="st-top-val">{value.toLocaleString(locale)}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
          </div>
        </section>

        <div className="sheet st-activity">
          <div className="sheet-head">
            <span>{t('stats.monthly.title')}</span>
          </div>
          <div className="sheet-body">
            {monthlyQuery.isLoading ? (
              <p>{t('common.loading')}</p>
            ) : monthlyQuery.error || months.length === 0 ? (
              <p className="st-empty">{t('stats.empty')}</p>
            ) : (
              <>
                <LineChart labels={monthLabels} series={lineSeries} ariaLabel={t('stats.monthly.title')} />
                <p className="st-foot">* {t('stats.monthly.partial')}</p>
              </>
            )}
          </div>
          <div className="sheet-head st-subhead">
            <span>{t('stats.econstat.title')}</span>
          </div>
          <div className="sheet-body">
            {monthlyQuery.isLoading ? (
              <p>{t('common.loading')}</p>
            ) : monthlyQuery.error || months.length === 0 ? (
              <p className="st-empty">{t('stats.empty')}</p>
            ) : (
              <StackedBars
                items={months.map((m, i) => {
                  const total = m.econstat + m.autresCanaux;
                  return {
                    key: m.month,
                    label: monthLabels[i],
                    pct: total > 0 ? (m.econstat / total) * 100 : null,
                    title: `${monthLabels[i]} ${m.month.slice(0, 4)} · ${t('stats.econstat.econstat')} ${m.econstat} / ${t('stats.econstat.autresCanaux')} ${m.autresCanaux}`,
                  };
                })}
                legend={
                  <>
                    <span>
                      <i aria-hidden="true" className="pri" />
                      {t('stats.econstat.econstat')}
                    </span>
                    <span>
                      <i aria-hidden="true" className="grey" />
                      {t('stats.econstat.autresCanaux')}
                    </span>
                  </>
                }
              />
            )}
          </div>
        </div>
      </div>

      <div className="grid st-row3">
        <section className="sheet st-card" aria-labelledby="st-hours-title">
          <div className="sheet-head">
            <span id="st-hours-title">{t('stats.hours.title')}</span>
          </div>
          <div className="sheet-body">
            <p className="st-empty st-empty-box">{t('stats.hours.empty')}</p>
          </div>
        </section>
        <RepartitionCard
          id="st-cases-title"
          title={t('stats.art14.byCode')}
          data={summary?.baremeCodes}
          labels={caseLabels}
          published={publishedCases(versionsQuery.data).length > 0}
          emptyLabel={t('stats.art14.notPublished')}
        />
        <RepartitionCard
          id="st-cat-title"
          title={t('stats.art14.byCategory')}
          data={summary?.vehicleCategories}
          labels={categoryLabels}
          published={publishedCategories(categoriesQuery.data).length > 0}
          emptyLabel={t('stats.art14.categoriesNotPublished')}
          note={t('stats.art14.categoryScope')}
        />
      </div>

      <div className="grid st-row4">
        <section className="sheet st-card" aria-labelledby="st-delays-title">
          <div className="sheet-head">
            <span id="st-delays-title">{t('stats.delays.title')}</span>
          </div>
          <div className="sheet-body">
            {!summary || !irsam ? (
              <p className="st-empty st-empty-box">{t('stats.delays.empty')}</p>
            ) : (
              <>
                <div className="st-delays">
                  <span className="st-delay-lab">
                    {irsam.measureDefinition.startEvent} → {irsam.measureDefinition.endEvent}
                  </span>
                  <div className="st-delay-bars">
                    <div className="st-delay-bar irsam">
                      <span style={{ width: `${(irsam.value / delayMax) * 100}%` }} />
                      <b>{irsam.value.toLocaleString(locale)} j</b>
                    </div>
                    <div className="st-delay-bar ida">
                      <span style={{ width: `${((summary.avgSettlementDays ?? 0) / delayMax) * 100}%` }} />
                      <b>{summary.avgSettlementDays === null ? '—' : `${summary.avgSettlementDays.toLocaleString(locale)} j`}</b>
                    </div>
                  </div>
                </div>
                <div className="st-legend st-legend-center">
                  <span>
                    <i aria-hidden="true" className="grey" />
                    IRSAM / {irsam.sourceRef} {irsam.periodFrom.slice(0, 4)}
                    {irsam.periodTo.slice(0, 4) !== irsam.periodFrom.slice(0, 4) ? `–${irsam.periodTo.slice(0, 4)}` : ''}
                  </span>
                  <span>
                    <i aria-hidden="true" className="pri" />
                    {t('stats.delays.ida')}
                  </span>
                </div>
              </>
            )}
          </div>
        </section>
        <section className="sheet st-card" aria-labelledby="st-co-title">
          <div className="sheet-head">
            <span id="st-co-title">{t('stats.companies.title')}</span>
          </div>
          <div className="sheet-body">
            <p className="st-empty st-empty-box">{t('stats.companies.empty')}</p>
          </div>
        </section>
      </div>
    </>
  );
}
