'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Check, Gauge, Inbox, Link2, Pause, Play, Scale, Table2, Timer, TriangleAlert } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { FolioHeader } from '@/components/FolioHeader';
import { PlaceOnlyGuard } from '@/components/PlaceOnlyGuard';
import { useAuth } from '@/lib/auth-context';
import { LineChart } from '@/components/ui/BarChart';
import { CoChip } from '@/components/ui/CoChip';
import { Kpi, KpiRow } from '@/components/ui/Kpi';
import { useI18n } from '@/i18n/provider';
import { TranslationKey } from '@/i18n/translations';
import { apiGet, apiPath } from '@/lib/api-client';
import {
  CockpitAlerteConventionnelle,
  CockpitCycleConventionnel,
  CockpitIndicateursDePlace,
  CockpitSummary,
  PlaceCalendar,
  PipelineStepView,
  QuarterlyPipeline,
  SettlementNet,
} from '@/lib/types';
import { RealtimeSignal, useRealtime } from '@/lib/realtime';

type T = (k: TranslationKey) => string;

// Polling de repli (A.1/B.12) : `metering.tick` n'est émis par aucun module
// réel au moment de cette passe (voir HANDOFF.md) — le flux temps réel
// (`claim.ingested`/`match.updated`, RÉELLEMENT émis par ClaimsModule/
// MatchingModule) coexiste avec ce polling de 20s, jamais comme seul
// mécanisme de rafraîchissement.
const POLL_INTERVAL_MS = 20_000;

// Taille du tampon glissant "Flux temps réel" (B.12, §8) — les N derniers
// événements reçus, le plus récent en tête ; purement présentationnel, pas
// un historique persistant (aucun endpoint back ne le fournit).
const FEED_MAX_ENTRIES = 12;

// Fenêtre de la bande calendrier : J-9 … J+14 (24 jours ouvrés ou non),
// comme la capture de référence — une seule ligne centrée sur aujourd'hui.
const CAL_DAYS_BEFORE = 9;
const CAL_DAYS_AFTER = 14;

const WEEKDAY_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] as const;

/**
 * Montant DZD en notation compacte ("5,65 M" / "269 k") — fidélité à la
 * capture de référence écran 1, qui abrège systématiquement les montants.
 * Valeur affichée seule (jamais arrondie côté back — seul l'arrondi
 * d'AFFICHAGE change ici).
 */
function formatCompact(amount: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 2 }).format(amount);
  } catch {
    return amount.toLocaleString();
  }
}

function formatDzd(amount: number, locale: string): string {
  return `${formatCompact(amount, locale)} DA`;
}

function formatNumber(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
  } catch {
    return String(value);
  }
}

/** Même idiome que `/monitoring` (`formatPct`) : `null` (pas encore de donnée pour calculer un taux) → repère "non disponible", jamais `NaN`/`null` affiché tel quel. */
function formatPct(value: number | null, t: T, locale: string): string {
  return value === null ? t('common.noData') : `${formatNumber(value, locale)} %`;
}

/** Même idiome que `/monitoring` (`formatDays`). */
function formatDays(value: number | null, t: T, locale: string): string {
  return value === null ? t('common.noData') : `${formatNumber(value, locale)} j`;
}

/** "Mois AAAA" localisé à partir d'une période `AAAA-MM` — `timeZone: 'UTC'` pour éviter tout écart SSR/client. */
function monthLabel(period: string, locale: string): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, (m || 1) - 1, 1));
  return d.toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** "7 oct. 2026" à partir d'une date ISO (jour calendaire, UTC). */
function shortDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** "T{n}" à partir d'une période trimestrielle `AAAA-Qn` (`SettlementQuarter.quarter`, back). */
function quarterSuffix(quarter: string): string {
  const m = /Q(\d)/.exec(quarter);
  return m ? `T${m[1]}` : quarter;
}

/**
 * Lot trimestriel dont le règlement est en cours : le trimestre qui précède
 * le trimestre courant (`AAAA-Qn`). Le circuit Art. 16-18 (saisie du
 * dernier mois le 5ᵉ jour ouvré, Annexe 7 le 10, réunion UAR, PV et
 * règlement) se déroule APRÈS la clôture du trimestre — en octobre, c'est
 * le lot T3 qui est traité, comme sur la capture de référence.
 */
function settlingQuarter(current: string): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(current);
  if (!m) return current;
  const year = Number(m[1]);
  const q = Number(m[2]);
  return q === 1 ? `${year - 1}-Q4` : `${year}-Q${q - 1}`;
}

/** Dernier mois (`AAAA-MM`) d'un trimestre `AAAA-Qn`. */
function lastMonthOf(quarter: string): string | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(quarter);
  return m ? `${m[1]}-${String(Number(m[2]) * 3).padStart(2, '0')}` : null;
}

/**
 * Plage d'articles couverte par le cycle — dérivée des SEULES étapes
 * RÉELLEMENT affichées (`article` de chaque étape), jamais une plage fixe
 * recopiée de la capture.
 */
function articleRange(steps: Array<{ article: string }>): string {
  const numbers = Array.from(new Set(steps.map((s) => s.article.match(/\d+/g) ?? []).flat())).sort((a, b) => Number(a) - Number(b));
  if (numbers.length === 0) return '';
  if (numbers.length === 1) return `Art. ${numbers[0]}`;
  return `Art. ${numbers[0]}-${numbers[numbers.length - 1]}`;
}

/** Date calendaire `AAAA-MM-JJ` à partir de composants LOCAUX — jamais via `Date#toISOString` (décalage UTC possible selon le fuseau du navigateur). */
function ymdOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** SEC-05/SEC-21 : écran réservé aux rôles de la place (403 pour un rôle compagnie). */
export default function CockpitPage() {
  return (
    <PlaceOnlyGuard titleKey="cockpit.title" redirectCompany>
      <CockpitContent />
    </PlaceOnlyGuard>
  );
}

function CockpitContent() {
  const { t, locale } = useI18n();
  const { mode } = useAuth();
  const [live, setLive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  const query = useQuery({
    queryKey: ['cockpit', 'summary'],
    queryFn: () => apiGet<CockpitSummary>('/cockpit/summary'),
    refetchInterval: POLL_INTERVAL_MS,
  });

  // Calendrier ouvré réel (B.2, `GET /referential/calendar`) — réutilisé tel
  // quel pour la surbrillance week-end/jours fériés de la bande calendrier.
  const calendarQuery = useQuery({
    queryKey: ['referential', 'calendar'],
    queryFn: () => apiGet<PlaceCalendar>('/referential/calendar'),
  });

  // Avancement RÉEL du lot trimestriel en cours de règlement
  // (`GET /settlement/quarter/:q/pipeline`, même requête et même clé de
  // cache que `/quarter`) : les 5 étapes de l'Art. 16-18 (`SAISIE`…
  // `PV_REGLEMENT`) avec leurs échéances réelles.
  const lotQuarter = query.data ? settlingQuarter(query.data.cycleConventionnel.quarter) : undefined;
  const pipelineQuery = useQuery({
    queryKey: ['settlement', 'quarter', lotQuarter, 'pipeline'],
    queryFn: () => apiGet<QuarterlyPipeline>(apiPath`/settlement/quarter/${lotQuarter as string}/pipeline`),
    enabled: !!lotQuarter,
  });

  // SEC-07 : `useRealtime` invalide lui-même `['cockpit', …]` ; ce
  // callback ne reçoit que le signal réduit (type, identifiant, état).
  const onRealtimeSignal = useCallback((signal: RealtimeSignal) => {
    setLive(true);
    if (pausedRef.current) return;
    setFeed((prev) =>
      [{ key: `${signal.event}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, signal, receivedAt: Date.now() }, ...prev].slice(0, FEED_MAX_ENTRIES),
    );
  }, []);

  useRealtime(['claim.ingested', 'match.updated', 'metering.tick', 'recours.timer'], onRealtimeSignal);

  const data = query.data;

  // « Démo » seulement en authentification de développement : avec Keycloak, les données sont réelles.
  const today = new Date().toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  const badge = mode === 'dev' ? `${today} · ${t('cockpit.badge.demo')}` : today;

  return (
    <>
      <FolioHeader
        badge={badge}
        title={t('cockpit.title')}
        subtitle={t('cockpit.subtitle')}
        actions={
          <Link href="/exchanges" className="btn-outline">
            <Table2 size={16} aria-hidden="true" />
            {t('cockpit.shortcuts.exchangesRegister')}
          </Link>
        }
      />

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
          <CyclePanel cycle={data.cycleConventionnel} pipeline={pipelineQuery.data} calendar={calendarQuery.data} t={t} locale={locale} />

          <KpiRow>
            <Kpi value={data.kpis.recoursEnCours} label={t('cockpit.kpi.recoursEnCours')} />
            <Kpi value={data.kpis.delaisDepasses} label={t('cockpit.kpi.delaisDepasses')} />
            {/* Réutilise `dossiersDuJour` (contrat stable, "déclarations créées aujourd'hui") — pas de champ back dédié "dernières 24h", voir HANDOFF.md. */}
            <Kpi value={data.kpis.dossiersDuJour} label={t('cockpit.kpi.declarationsRecues24h')} />
            <Kpi value={formatPct(data.kpis.appariementAutoPct, t, locale)} label={t('cockpit.kpi.appariementAutoPct')} />
            <Kpi value={formatDzd(data.kpis.volumeBrutT3, locale)} label={t('cockpit.kpi.volumeBrutT3')} />
            <Kpi value={`${formatNumber(data.kpis.reductionNettingPct, locale)} %`} label={t('cockpit.kpi.reductionNettingPct')} />
          </KpiRow>

          <IndicateursSection data={data} t={t} locale={locale} />

          <div className="grid g-cockpit2">
            <AlertsSection alerts={data.alertesConventionnelles} t={t} />
            <FeedSection feed={feed} paused={paused} onTogglePause={() => setPaused((p) => !p)} live={live} t={t} locale={locale} />
          </div>

          <p className="cockpit-updated">
            {t('cockpit.updatedAt')} {new Date(data.updatedAt).toLocaleString(locale)}
          </p>
        </>
      )}
    </>
  );
}

/* ===================== Cycle conventionnel + calendrier ouvré ===================== */

/** Vue normalisée d'une étape, qu'elle vienne du résumé cockpit (3 étapes) ou du lot trimestriel réel (5 étapes). */
interface CycleStepView {
  key: string;
  label: string;
  fullLabel: string;
  article: string;
  done: boolean;
  current: boolean;
  overdue: boolean;
  detail?: string;
  dueDate?: string;
}

function fromCockpitSummary(cycle: CockpitCycleConventionnel): CycleStepView[] {
  return cycle.steps.map((s) => ({ key: s.key, label: s.label, fullLabel: s.label, article: s.article, done: s.done, current: false, overdue: false, detail: s.detail }));
}

/**
 * Les 5 étapes RÉELLES du lot trimestriel (Art. 16-18) — mêmes données que
 * « Avancement du lot » sur `/quarter`. Libellé court (comme la capture),
 * libellé conventionnel complet en infobulle ; échéance ou réalisation
 * réelles, jamais recalculées.
 */
function fromPipeline(pipeline: QuarterlyPipeline, t: T, locale: string): CycleStepView[] {
  const lastMonth = lastMonthOf(pipeline.quarter);
  return pipeline.steps.map((s: PipelineStepView) => {
    const shortKey = `cockpit.cycle.short.${s.step}` as TranslationKey;
    const short = t(shortKey);
    const label =
      short === shortKey ? s.label : s.step === 'SAISIE' && lastMonth ? `${short} ${monthLabel(lastMonth, locale)}` : short;
    const done = s.status === 'DONE';
    return {
      key: s.step,
      label,
      fullLabel: s.label,
      article: s.article,
      done,
      current: s.status === 'EN_COURS',
      overdue: !done && s.overdue,
      dueDate: s.dueDate,
      detail:
        done && s.completedAt
          ? `${t('cockpit.cycle.doneOn')} ${shortDate(s.completedAt, locale)}`
          : `${t('cockpit.cycle.dueOn')} ${shortDate(s.dueDate, locale)}${!done && s.overdue ? ` · ${t('cockpit.cycle.overdue')}` : ''}`,
    };
  });
}

function CyclePanel({
  cycle,
  pipeline,
  calendar,
  t,
  locale,
}: {
  cycle: CockpitCycleConventionnel;
  pipeline: QuarterlyPipeline | undefined;
  calendar: PlaceCalendar | undefined;
  t: T;
  locale: string;
}) {
  // Le résumé cockpit (3 étapes) sert de repli pendant le chargement du lot
  // trimestriel (5 étapes réelles) — jamais un écran vide.
  const steps = pipeline ? fromPipeline(pipeline, t, locale) : fromCockpitSummary(cycle);
  return (
    <div className="sheet">
      <div className="sheet-head">
        <span>
          {t('cockpit.cycle.title')} — {monthLabel(cycle.period, locale)}
          {pipeline ? <span className="cycle-lot"> · {t('cockpit.cycle.lot')} {quarterSuffix(pipeline.quarter)}</span> : null}
        </span>
        <span className="head-chip">{articleRange(steps)}</span>
      </div>
      <div className="sheet-body">
        <div className="cycle-steps">
          {steps.map((step, i) => (
            <div
              className={`cycle-step${step.done ? ' done' : ''}${step.current ? ' current' : ''}${step.overdue ? ' overdue' : ''}`}
              key={step.key}
              title={step.fullLabel}
            >
              <span className="cycle-step-badge" aria-hidden="true">
                {step.done ? <Check size={13} strokeWidth={3} /> : null}
              </span>
              <div className="cycle-step-body">
                <div className="cycle-step-kicker">
                  {i + 1} · {step.article}
                </div>
                <div className="cycle-step-title">{step.label}</div>
                {step.detail ? <div className="cycle-step-meta">{step.detail}</div> : null}
              </div>
            </div>
          ))}
        </div>

        <CalendarStrip calendar={calendar} steps={pipeline ? steps : []} t={t} />

        <Link href="/quarter" className="cycle-more">
          {t('cockpit.cycle.seeQuarterDetail')}
        </Link>
      </div>
    </div>
  );
}

function CalendarStrip({ calendar, steps, t }: { calendar: PlaceCalendar | undefined; steps: CycleStepView[]; t: T }) {
  const now = new Date();
  const todayStr = ymdOf(now);
  const weekendDays = calendar?.weekendDays ?? [];
  const holidaySet = new Set((calendar?.fixedHolidays ?? []).map((h) => h.date.slice(0, 10)));

  // Échéances RÉELLES des étapes du lot, reportées sur leur jour.
  const dueByDay = new Map<string, CycleStepView[]>();
  for (const s of steps) {
    if (!s.dueDate) continue;
    const day = s.dueDate.slice(0, 10);
    dueByDay.set(day, [...(dueByDay.get(day) ?? []), s]);
  }

  const cells = Array.from({ length: CAL_DAYS_BEFORE + CAL_DAYS_AFTER + 1 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - CAL_DAYS_BEFORE + i);
    const dateStr = ymdOf(d);
    const due = dueByDay.get(dateStr) ?? [];
    const allDone = due.length > 0 && due.every((s) => s.done);
    return {
      dateStr,
      day: String(d.getDate()).padStart(2, '0'),
      weekend: weekendDays.includes(WEEKDAY_NAMES[d.getDay()]),
      holiday: holidaySet.has(dateStr),
      today: dateStr === todayStr,
      past: dateStr < todayStr,
      due,
      tagTone: allDone ? 'done' : dateStr < todayStr ? 'late' : 'next',
    };
  });

  return (
    <>
      <div className="cal-strip">
        {cells.map((c) => (
          <div
            key={c.dateStr}
            className={`cal-cell${c.weekend ? ' weekend' : ''}${c.holiday ? ' holiday' : ''}${c.today ? ' today' : ''}${c.past ? ' past' : ''}`}
            title={[c.holiday ? t('cockpit.calendar.legend.holiday') : c.weekend ? t('cockpit.calendar.legend.weekendPrefix') : '', ...c.due.map((s) => s.fullLabel)]
              .filter(Boolean)
              .join(' — ') || undefined}
          >
            <span className="cal-num">{c.day}</span>
            {c.due.length > 0 ? (
              <span className={`cal-tag ${c.tagTone}`}>{t(`cockpit.cycle.tag.${c.due[c.due.length - 1].key}` as TranslationKey)}</span>
            ) : null}
          </div>
        ))}
      </div>
      <div className="cal-legend">
        <span>
          <span className="cal-legend-dot weekend" />
          {t('cockpit.calendar.legend.weekendPrefix')}
          {weekendDays.length > 0 ? ` (${weekendDays.map((d) => t(`referential.calendar.day.${d}` as TranslationKey)).join('–')})` : ''}
        </span>
        <span>
          <span className="cal-legend-dot holiday" />
          {t('cockpit.calendar.legend.holiday')}
        </span>
        <span>
          <span className="cal-legend-dot today" />
          {t('cockpit.calendar.legend.today')}
        </span>
        <span>{t('cockpit.calendar.legend.note')}</span>
      </div>
    </>
  );
}

/* ===================== Indicateurs de place (§6.8-6.10) + graphes ===================== */

function IndicateursSection({ data, t, locale }: { data: CockpitSummary; t: T; locale: string }) {
  const indicateurs: CockpitIndicateursDePlace = data.indicateursDePlace;
  return (
    <div className="sheet">
      <div className="sheet-head">
        <span>{t('cockpit.indicateurs.title')}</span>
        <span className="head-chip">{t('cockpit.indicateurs.badge')}</span>
      </div>
      <div className="sheet-body">
        <div className="ind-grid">
          <Kpi value={indicateurs.declarationsDuMois} label={t('cockpit.indicateurs.declarationsDuMois')} />
          <TauxAppariementTile pct={indicateurs.tauxAppariementPct} t={t} locale={locale} />
          <Kpi value={indicateurs.enAttenteAppariement} label={t('cockpit.indicateurs.enAttenteAppariement')} />
          <Kpi value={formatPct(indicateurs.tauxHorsIdaPct, t, locale)} label={t('cockpit.indicateurs.tauxHorsIdaPct')} />
          <Kpi value={formatDays(indicateurs.delaiMoyenAppariementJours, t, locale)} label={t('cockpit.indicateurs.delaiMoyenAppariementJours')} />
          <Kpi value={indicateurs.recoursForclos} label={t('cockpit.indicateurs.recoursForclos')} />
          <Kpi value={formatDzd(indicateurs.compensationNetteT3, locale)} label={t('cockpit.indicateurs.compensationNetteT3')} />
          <Kpi value={formatDzd(indicateurs.penalitesDeRetard, locale)} label={t('cockpit.indicateurs.penalitesDeRetard')} />
          <Kpi value={`${indicateurs.expertsActifs} / ${indicateurs.expertsSuspendus}`} label={t('cockpit.indicateurs.expertsActifsSuspendus')} />
          <Kpi value={`${indicateurs.adherentsActifs} / ${indicateurs.adherentsSuspendus}`} label={t('cockpit.indicateurs.adherentsActifsSuspendus')} />
        </div>

        <div className="ind-charts">
          <section>
            <h3 className="ind-chart-title">
              {t('cockpit.netPositions.title')} — {quarterSuffix(data.positionsNettesQuarter.quarter)}
            </h3>
            {data.positionsNettesQuarter.positions.length === 0 ? (
              <p className="muted">{t('cockpit.netPositions.empty')}</p>
            ) : (
              <NetPositionsChart positions={data.positionsNettesQuarter.positions} locale={locale} />
            )}
          </section>
          <section>
            <h3 className="ind-chart-title">{t('cockpit.stats.title')}</h3>
            {data.monthlyDeclarations.length === 0 ? (
              <p className="muted">{t('cockpit.stats.empty')}</p>
            ) : (
              <LineChart height={130} points={data.monthlyDeclarations.map((m) => ({ label: m.month.slice(5, 7), value: m.declarations }))} />
            )}
            {data.topWilayas.length > 0 ? (
              <p className="ind-chart-note">
                {t('cockpit.stats.topWilayasPrefix')} : <strong>{data.topWilayas.map((w) => w.name).join(', ')}</strong>
              </p>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}

/** Seule tuile à porter une barre de progression sous la valeur (capture de référence). */
function TauxAppariementTile({ pct, t, locale }: { pct: number | null; t: T; locale: string }) {
  return (
    <div className="kpi">
      <div className="kpi-value">{formatPct(pct, t, locale)}</div>
      <div className="kpi-label">{t('cockpit.indicateurs.tauxAppariementPct')}</div>
      <div className="kpi-bar" aria-hidden="true">
        <div style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%` }} />
      </div>
    </div>
  );
}

/**
 * Barres divergentes (positif/négatif) centrées sur un axe de zéro — code
 * compagnie en mono, barre pleine sans piste, montant compact coloré
 * (capture de référence). Montants en DA, rappelés en infobulle.
 */
function NetPositionsChart({ positions, locale }: { positions: SettlementNet[]; locale: string }) {
  const max = Math.max(1, ...positions.map((p) => Math.abs(p.net)));
  return (
    <div className="net-chart">
      {positions.map((p) => {
        const pct = (Math.abs(p.net) / max) * 50;
        const positive = p.net > 0;
        const zero = p.net === 0;
        const value = zero ? '0' : `${positive ? '+' : '−'}${formatCompact(Math.abs(p.net), locale)}`;
        return (
          <div className="net-bar-row" key={p.code} title={`${p.code} : ${p.net.toLocaleString(locale)} DA`}>
            <span className="net-bar-code">{p.code}</span>
            <div className="net-bar-track">
              {zero ? null : (
                <div
                  className="net-bar-fill"
                  style={{
                    left: positive ? '50%' : `calc(50% - ${pct}%)`,
                    width: `${pct}%`,
                    background: positive ? 'var(--k-pri)' : 'var(--ko)',
                  }}
                />
              )}
            </div>
            <span className={`net-bar-value${zero ? '' : positive ? ' pos' : ' neg'}`}>{value}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ===================== Alertes conventionnelles ===================== */

function AlertsSection({ alerts, t }: { alerts: CockpitAlerteConventionnelle[]; t: T }) {
  return (
    <div className="sheet">
      <div className="sheet-head">
        <span className="head-with-count">
          {t('cockpit.alerts.title')}
          <span className={`count-badge${alerts.length === 0 ? ' zero' : ''}`} aria-label={String(alerts.length)}>
            {alerts.length}
          </span>
        </span>
      </div>
      <div className="sheet-body flush">
        {alerts.length === 0 ? (
          <p className="muted pad">{t('cockpit.alerts.empty')}</p>
        ) : (
          <div className="alert-list">
            {alerts.map((a) => {
              // Dossiers de la Commission (CSC-…) : pas de paire compagnie, icône balance (maquette, écran 1).
              const commission = a.reference.startsWith('CSC');
              return (
                // Cible `/exchanges` (registre des recours) — ces alertes mélangent recours et dossiers de commission (voir CockpitController).
                <Link href="/exchanges" className="alert-row" key={a.id}>
                  <span className="row-icon" aria-hidden="true">
                    {commission ? <Scale size={17} /> : <TriangleAlert size={17} className="ico-ko" />}
                  </span>
                  <span className="alert-text">
                    <strong className="mono" title={a.id}>
                      {a.reference}
                    </strong>
                    {a.from && !commission ? (
                      <>
                        {' '}
                        <CoChip code={a.from} /> <span aria-hidden="true">→</span> <CoChip code={a.to} />
                      </>
                    ) : null}{' '}
                    — {a.description}
                  </span>
                  <span className="mono-chip">{a.article}</span>
                  <ArrowRight size={16} className="row-go" aria-hidden="true" />
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ===================== Flux temps réel ===================== */

interface FeedEntry {
  key: string;
  signal: RealtimeSignal;
  receivedAt: number;
}

const FEED_TITLES: Partial<Record<RealtimeSignal['event'], TranslationKey>> = {
  'claim.ingested': 'cockpit.feed.ingestion',
  'match.updated': 'cockpit.feed.matching',
  'recours.timer': 'cockpit.feed.recours',
  'metering.tick': 'cockpit.feed.metering',
};

const FEED_ICONS: Partial<Record<RealtimeSignal['event'], typeof Link2>> = {
  'claim.ingested': Inbox,
  'match.updated': Link2,
  'recours.timer': Timer,
  'metering.tick': Gauge,
};

function FeedSection({
  feed,
  paused,
  onTogglePause,
  live,
  t,
  locale,
}: {
  feed: FeedEntry[];
  paused: boolean;
  onTogglePause: () => void;
  live: boolean;
  t: T;
  locale: string;
}) {
  return (
    <div className="sheet">
      <div className="sheet-head">
        <span>{t('cockpit.feed.title')}</span>
        <span className="feed-controls">
          <span className={`live-dot${live ? ' on' : ''}`} aria-hidden="true" title={live ? t('cockpit.live.on') : t('cockpit.live.off')} />
          <button type="button" className="btn-soft" onClick={onTogglePause}>
            {paused ? <Play size={13} aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />}
            {paused ? t('cockpit.feed.resume') : t('cockpit.feed.pause')}
          </button>
        </span>
      </div>
      <div className="sheet-body flush">
        {feed.length === 0 ? (
          <p className="muted pad">{t('cockpit.feed.empty')}</p>
        ) : (
          <div className="feed-list">
            {feed.map((entry) => {
              // SEC-07 : seuls l'identifiant et l'état diffusés sont affichés —
              // le détail se consulte dans l'écran concerné, rechargé par l'API.
              const { event, id, reference, state } = entry.signal;
              const titleKey = FEED_TITLES[event];
              const Icon = FEED_ICONS[event] ?? Link2;
              return (
                <div className="feed-row" key={entry.key}>
                  <span className="row-icon" aria-hidden="true">
                    <Icon size={17} />
                  </span>
                  <span className="feed-text">
                    <strong>
                      {titleKey ? t(titleKey) : event}
                      {id ? (
                        <>
                          {' · '}
                          <span className="mono" title={id}>
                            {reference ?? id}
                          </span>
                        </>
                      ) : null}
                    </strong>
                    {state ? <span className="feed-detail">{state}</span> : null}
                  </span>
                  <span className="feed-time">{new Date(entry.receivedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
