'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { FolioHeader } from '@/components/FolioHeader';
import { PlaceOnlyGuard } from '@/components/PlaceOnlyGuard';
import { LineChart } from '@/components/ui/BarChart';
import { CoChip } from '@/components/ui/CoChip';
import { Kpi, KpiRow } from '@/components/ui/Kpi';
import { Tag } from '@/components/ui/Tag';
import { useI18n } from '@/i18n/provider';
import { TranslationKey } from '@/i18n/translations';
import { apiGet } from '@/lib/api-client';
import {
  CockpitAlerteConventionnelle,
  CockpitCycleConventionnel,
  CockpitIndicateursDePlace,
  CockpitSummary,
  PlaceCalendar,
  SettlementNet,
} from '@/lib/types';
import { RealtimeSignal, useRealtime } from '@/lib/realtime';

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

const WEEKDAY_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] as const;

/**
 * Montant DZD en notation compacte ("5,65 M DA" / "269 k DA") — fidélité à
 * la capture de référence écran 1, qui abrège systématiquement les
 * montants (KPI de tête, indicateurs, positions nettes) plutôt que
 * d'afficher le groupement complet des chiffres. Valeur affichée seule
 * (jamais arrondie côté back — seul l'arrondi d'AFFICHAGE change ici).
 */
function formatDzd(amount: number, locale: string): string {
  try {
    return `${new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 2 }).format(amount)} DA`;
  } catch {
    return `${amount.toLocaleString()} DA`;
  }
}

/** Même idiome que `/monitoring` (`formatPct`) : `null` (pas encore de donnée pour calculer un taux) → repère "non disponible", jamais `NaN`/`null` affiché tel quel. */
function formatPct(value: number | null, t: (k: TranslationKey) => string): string {
  return value === null ? t('common.noData') : `${value} %`;
}

/** Même idiome que `/monitoring` (`formatDays`). */
function formatDays(value: number | null, t: (k: TranslationKey) => string): string {
  return value === null ? t('common.noData') : `${value} j`;
}

/** "Mois AAAA" localisé à partir d'une période `AAAA-MM` — même idiome que `/params` (`periodLabel`), `timeZone: 'UTC'` pour éviter tout écart SSR/client. */
function monthLabel(period: string, locale: string): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, (m || 1) - 1, 1));
  return d.toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** "T{n}" à partir d'une période trimestrielle `AAAA-Qn` (`SettlementQuarter.quarter`, back). */
function quarterSuffix(quarter: string): string {
  const m = /Q(\d)/.exec(quarter);
  return m ? `T${m[1]}` : quarter;
}

/**
 * Plage d'articles couverte par le cycle — dérivée des SEULES étapes
 * réelles (`cycle.steps[].article`), jamais une plage fixe recopiée de la
 * capture (qui inclut Art. 18, non suivi côté back — voir `CyclePanel`).
 * "Art. 16" si une seule valeur, "Art. 16-17" si plusieurs.
 */
function articleRange(steps: CockpitCycleConventionnel['steps']): string {
  const numbers = Array.from(new Set(steps.map((s) => s.article.match(/\d+/)?.[0]).filter((n): n is string => !!n))).sort((a, b) => Number(a) - Number(b));
  if (numbers.length === 0) return '';
  if (numbers.length === 1) return `Art. ${numbers[0]}`;
  return `Art. ${numbers[0]}-${numbers[numbers.length - 1]}`;
}

/** Date calendaire `AAAA-MM-JJ` à partir de composants LOCAUX — jamais via `Date#toISOString` (décalage UTC possible selon le fuseau du navigateur), pour comparer calendrier ouvré et "aujourd'hui" sans ambiguïté de fuseau. */
function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const headerActionStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  border: '1px solid var(--rule-strong)',
  borderRadius: 'var(--k-r-s)',
  padding: '8px 14px',
  textDecoration: 'none',
  color: 'var(--k-pri)',
  fontWeight: 600,
  fontSize: 'var(--k-fs-s)',
};

/** SEC-05/SEC-21 : écran réservé aux rôles de la place (403 pour un rôle compagnie). */
export default function CockpitPage() {
  return (
    <PlaceOnlyGuard titleKey="cockpit.title">
      <CockpitContent />
    </PlaceOnlyGuard>
  );
}

function CockpitContent() {
  const { t, locale } = useI18n();
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
  // quel pour la surbrillance week-end/jours fériés de la bande calendrier
  // ci-dessous (déjà consommé par `/referential`, jamais une 2ᵉ source de
  // jours fériés inventée).
  const calendarQuery = useQuery({
    queryKey: ['referential', 'calendar'],
    queryFn: () => apiGet<PlaceCalendar>('/referential/calendar'),
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

  const badge = `${new Date().toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })} · ${t('cockpit.badge.demo')}`;

  return (
    <>
      <FolioHeader
        badge={badge}
        title={t('cockpit.title')}
        subtitle={t('cockpit.subtitle')}
        actions={
          <Link href="/exchanges" style={headerActionStyle}>
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
          <CyclePanel cycle={data.cycleConventionnel} calendar={calendarQuery.data} t={t} locale={locale} />

          <KpiRow>
            <Kpi value={data.kpis.recoursEnCours} label={t('cockpit.kpi.recoursEnCours')} />
            <Kpi value={data.kpis.delaisDepasses} label={t('cockpit.kpi.delaisDepasses')} />
            {/* Réutilise `dossiersDuJour` (contrat stable, "déclarations créées aujourd'hui") — pas de champ back dédié "dernières 24h", voir HANDOFF.md. */}
            <Kpi value={data.kpis.dossiersDuJour} label={t('cockpit.kpi.declarationsRecues24h')} />
            <Kpi value={formatPct(data.kpis.appariementAutoPct, t)} label={t('cockpit.kpi.appariementAutoPct')} />
            <Kpi value={formatDzd(data.kpis.volumeBrutT3, locale)} label={t('cockpit.kpi.volumeBrutT3')} />
            <Kpi value={`${data.kpis.reductionNettingPct} %`} label={t('cockpit.kpi.reductionNettingPct')} />
          </KpiRow>

          <IndicateursSection indicateurs={data.indicateursDePlace} t={t} locale={locale} />

          <div className="grid g-cockpit2" style={{ marginTop: 'var(--s-5)' }}>
            <div className="sheet">
              <div className="sheet-head">
                <span>
                  {t('cockpit.netPositions.title')} — {quarterSuffix(data.positionsNettesQuarter.quarter)}
                </span>
              </div>
              <div className="sheet-body">
                {data.positionsNettesQuarter.positions.length === 0 ? (
                  <p style={{ color: 'var(--ink-3)' }}>{t('cockpit.netPositions.empty')}</p>
                ) : (
                  <NetPositionsChart positions={data.positionsNettesQuarter.positions} locale={locale} />
                )}
              </div>
            </div>

            <div className="sheet">
              <div className="sheet-head">
                <span>{t('cockpit.stats.title')}</span>
              </div>
              <div className="sheet-body">
                {data.monthlyDeclarations.length === 0 ? (
                  <p style={{ color: 'var(--ink-3)' }}>{t('cockpit.stats.empty')}</p>
                ) : (
                  <LineChart points={data.monthlyDeclarations.map((m) => ({ label: m.month.slice(5, 7), value: m.declarations }))} />
                )}
                {data.topWilayas.length > 0 ? (
                  <p style={{ marginTop: 'var(--s-3)', marginBottom: 0, fontSize: 'var(--k-fs-s)', color: 'var(--ink-2)' }}>
                    {t('cockpit.stats.topWilayasPrefix')} : {data.topWilayas.map((w) => w.name).join(', ')}
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="grid g-cockpit2" style={{ marginTop: 'var(--s-5)' }}>
            <AlertsSection alerts={data.alertesConventionnelles} t={t} />
            <FeedSection feed={feed} paused={paused} onTogglePause={() => setPaused((p) => !p)} live={live} t={t} locale={locale} />
          </div>

          <p style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)', marginTop: 'var(--s-4)' }}>
            {t('cockpit.updatedAt')} {new Date(data.updatedAt).toLocaleString(locale)}
          </p>
        </>
      )}
    </>
  );
}

/* ===================== Cycle conventionnel + calendrier ouvré ===================== */

function CyclePanel({
  cycle,
  calendar,
  t,
  locale,
}: {
  cycle: CockpitCycleConventionnel;
  calendar: PlaceCalendar | undefined;
  t: (k: TranslationKey) => string;
  locale: string;
}) {
  return (
    <div className="sheet">
      <div className="sheet-head">
        <span>
          {t('cockpit.cycle.title')} — {monthLabel(cycle.period, locale)}
        </span>
        {/* Dérivée des articles RÉELLEMENT portés par `cycle.steps` (Art. 16-17
            aujourd'hui) — jamais "Art. 16-18" comme la capture, qui inclut
            l'Art. 18 (non suivi, voir note ci-dessous et HANDOFF.md). */}
        <span style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)', fontWeight: 400 }}>{articleRange(cycle.steps)}</span>
      </div>
      <div className="sheet-body">
        {/* ⚠️ `cycle.steps` ne porte QUE les 3 étapes réellement suivies par ce
            backend (voir doc de classe `CockpitController`/HANDOFF.md) — ne
            jamais compléter à 5 étapes pour coller au guide illustré. */}
        <div className="cycle-steps">
          {cycle.steps.map((step, i) => (
            <div className={`cycle-step${step.done ? ' done' : ''}`} key={step.key}>
              <span className="cycle-step-badge" aria-hidden="true">
                {step.done ? '✓' : i + 1}
              </span>
              <div>
                <div className="cycle-step-title">{step.label}</div>
                <div className="cycle-step-meta">
                  {step.article}
                  {step.detail ? ` · ${step.detail}` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)', marginTop: 'var(--s-3)', marginBottom: 0 }}>{t('cockpit.cycle.unavailableNote')}</p>

        <div style={{ marginTop: 'var(--s-5)' }}>
          <CalendarStrip calendar={calendar} t={t} />
        </div>
      </div>
    </div>
  );
}

function CalendarStrip({ calendar, t }: { calendar: PlaceCalendar | undefined; t: (k: TranslationKey) => string }) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysCount = new Date(year, month + 1, 0).getDate();
  const todayStr = ymd(year, month, now.getDate());
  const weekendDays = calendar?.weekendDays ?? [];
  const holidaySet = new Set((calendar?.fixedHolidays ?? []).map((h) => h.date.slice(0, 10)));

  const cells = Array.from({ length: daysCount }, (_, i) => {
    const day = i + 1;
    const dateStr = ymd(year, month, day);
    const weekday = WEEKDAY_NAMES[new Date(year, month, day).getDay()];
    return {
      day,
      weekend: weekendDays.includes(weekday),
      holiday: holidaySet.has(dateStr),
      today: dateStr === todayStr,
    };
  });

  return (
    <>
      <div className="cal-strip">
        {cells.map((c) => (
          <div
            key={c.day}
            className={`cal-cell${c.weekend ? ' weekend' : ''}${c.holiday ? ' holiday' : ''}${c.today ? ' today' : ''}`}
            title={c.holiday ? t('cockpit.calendar.legend.holiday') : c.weekend ? t('cockpit.calendar.legend.weekendPrefix') : undefined}
          >
            {c.day}
          </div>
        ))}
      </div>
      <div className="cal-legend">
        <span>
          <span className="cal-legend-dot" style={{ background: 'var(--neutral-soft)', border: '1px solid var(--rule)' }} />
          {t('cockpit.calendar.legend.weekendPrefix')}
          {weekendDays.length > 0 ? ` (${weekendDays.map((d) => t(`referential.calendar.day.${d}` as TranslationKey)).join('–')})` : ''}
        </span>
        <span>
          <span className="cal-legend-dot" style={{ background: 'var(--warn-soft)', border: '1px solid var(--warn)' }} />
          {t('cockpit.calendar.legend.holiday')}
        </span>
        <span>
          <span className="cal-legend-dot" style={{ border: '2px solid var(--k-pri)' }} />
          {t('cockpit.calendar.legend.today')}
        </span>
        <span>{t('cockpit.calendar.legend.note')}</span>
      </div>
    </>
  );
}

/* ===================== Indicateurs de place (§6.8-6.10, 10 tuiles) ===================== */

function IndicateursSection({ indicateurs, t, locale }: { indicateurs: CockpitIndicateursDePlace; t: (k: TranslationKey) => string; locale: string }) {
  return (
    <div className="sheet" style={{ marginTop: 'var(--s-5)' }}>
      <div className="sheet-head">
        <span>{t('cockpit.indicateurs.title')}</span>
        <span style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)', fontWeight: 400 }}>{t('cockpit.indicateurs.badge')}</span>
      </div>
      <div className="sheet-body">
        <div className="ind-grid">
          <Kpi value={indicateurs.declarationsDuMois} label={t('cockpit.indicateurs.declarationsDuMois')} />
          <TauxAppariementTile pct={indicateurs.tauxAppariementPct} t={t} />
          <Kpi value={indicateurs.enAttenteAppariement} label={t('cockpit.indicateurs.enAttenteAppariement')} />
          <Kpi value={formatPct(indicateurs.tauxHorsIdaPct, t)} label={t('cockpit.indicateurs.tauxHorsIdaPct')} />
          <Kpi value={formatDays(indicateurs.delaiMoyenAppariementJours, t)} label={t('cockpit.indicateurs.delaiMoyenAppariementJours')} />
          <Kpi value={indicateurs.recoursForclos} label={t('cockpit.indicateurs.recoursForclos')} />
          <Kpi value={formatDzd(indicateurs.compensationNetteT3, locale)} label={t('cockpit.indicateurs.compensationNetteT3')} />
          <Kpi value={formatDzd(indicateurs.penalitesDeRetard, locale)} label={t('cockpit.indicateurs.penalitesDeRetard')} />
          <Kpi value={`${indicateurs.expertsActifs} / ${indicateurs.expertsSuspendus}`} label={t('cockpit.indicateurs.expertsActifsSuspendus')} />
          <Kpi value={`${indicateurs.adherentsActifs} / ${indicateurs.adherentsSuspendus}`} label={t('cockpit.indicateurs.adherentsActifsSuspendus')} />
        </div>
      </div>
    </div>
  );
}

/** Seule tuile des 10 à porter une barre de progression sous la valeur (capture de référence) — `Kpi` transverse ne supporte qu'un `extra` textuel, d'où ce rendu dédié réutilisant directement les classes `.kpi*`/`.score-bar-*`. */
function TauxAppariementTile({ pct, t }: { pct: number | null; t: (k: TranslationKey) => string }) {
  return (
    <div className="kpi">
      <div className="kpi-value">{formatPct(pct, t)}</div>
      <div className="kpi-label">{t('cockpit.indicateurs.tauxAppariementPct')}</div>
      <div className="score-bar-track" style={{ marginTop: 'var(--s-2)' }}>
        <div className="score-bar-fill" style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%`, background: 'var(--k-acc)' }} />
      </div>
    </div>
  );
}

/* ===================== Positions nettes par compagnie (T{n}) ===================== */

/**
 * Barres divergentes (positif/négatif) centrées sur une ligne de zéro —
 * `BarChart` transverse (SVG, barres posées sur une base commune en bas)
 * ne supporte pas ce tracé ; rendu HTML/CSS dédié (même esprit que
 * `ScoreBar`/`RevenueShareBar` : une piste `.net-bar-track` + un
 * remplissage positionné en `%`), plus simple à aligner précisément
 * qu'un SVG pour ce cas précis.
 */
function NetPositionsChart({ positions, locale }: { positions: SettlementNet[]; locale: string }) {
  const max = Math.max(1, ...positions.map((p) => Math.abs(p.net)));
  return (
    <div>
      {positions.map((p) => {
        const pct = (Math.abs(p.net) / max) * 50;
        const positive = p.net >= 0;
        return (
          <div className="net-bar-row" key={p.code}>
            <CoChip code={p.code} />
            <div className="net-bar-track">
              <div
                className="net-bar-fill"
                style={{
                  left: positive ? '50%' : `calc(50% - ${pct}%)`,
                  width: `${pct}%`,
                  background: positive ? 'var(--k-pri-2)' : 'var(--ko)',
                }}
              />
            </div>
            <span className="mono" style={{ textAlign: 'end', fontWeight: 600, color: positive ? 'var(--ok)' : 'var(--ko)' }}>
              {positive ? '+' : '−'}
              {formatDzd(Math.abs(p.net), locale)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ===================== Alertes conventionnelles ===================== */

function AlertsSection({ alerts, t }: { alerts: CockpitAlerteConventionnelle[]; t: (k: TranslationKey) => string }) {
  return (
    <div className="sheet">
      <div className="sheet-head">
        <span>
          {t('cockpit.alerts.title')} ({alerts.length})
        </span>
      </div>
      <div className="sheet-body">
        {alerts.length === 0 ? (
          <p style={{ color: 'var(--ink-3)' }}>{t('cockpit.alerts.empty')}</p>
        ) : (
          <div className="alert-list">
            {alerts.map((a) => (
              // Cible `/exchanges` (registre des recours) plain — pas de filtre dédié par recours/dossier de commission (ces alertes mélangent les deux sources, voir CockpitController), pour ne pas sur-construire un lien qui ne filtrerait qu'un sous-ensemble.
              <Link href="/exchanges" className="alert-row" key={a.id}>
                <span className="alert-icon" aria-hidden="true">
                  ⚠
                </span>
                <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, fontWeight: 600, flex: 1, minWidth: 0 }}>
                  <span className="mono">{a.id}</span>
                  <CoChip code={a.from} />
                  <span aria-hidden="true">→</span>
                  <CoChip code={a.to} />
                  <span>— {a.description}</span>
                </span>
                <Tag tone="a">{a.article}</Tag>
                <span aria-hidden="true">→</span>
              </Link>
            ))}
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

/**
 * Description d'une entrée de flux — SEC-07 : le backend ne diffuse plus
 * que l'identifiant et l'état de l'objet modifié, aux seules compagnies
 * concernées. Aucune donnée métier (nom, police, plaque, agent) n'est lue
 * dans le payload : le détail se consulte dans l'écran concerné, rechargé
 * par l'API (qui applique le filtrage par compagnie).
 */
function describeFeedEntry(entry: FeedEntry, t: (k: TranslationKey) => string): { title: string; detail: string } {
  const { event, id, state } = entry.signal;
  const titleKey = FEED_TITLES[event];
  return { title: titleKey ? t(titleKey) : event, detail: [id, state].filter(Boolean).join(' · ') };
}

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
  t: (k: TranslationKey) => string;
  locale: string;
}) {
  return (
    <div className="sheet">
      <div className="sheet-head">
        <span>{t('cockpit.feed.title')}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
          <span className={`live-dot${live ? ' on' : ''}`} aria-hidden="true" title={live ? t('cockpit.live.on') : t('cockpit.live.off')} />
          <button
            type="button"
            onClick={onTogglePause}
            style={{
              padding: '4px 10px',
              borderRadius: 'var(--k-r-s)',
              border: '1px solid var(--rule-strong)',
              background: 'var(--paper)',
              color: 'var(--ink)',
              font: 'inherit',
              fontSize: 'var(--k-fs-xs)',
              cursor: 'pointer',
            }}
          >
            {paused ? t('cockpit.feed.resume') : t('cockpit.feed.pause')}
          </button>
        </span>
      </div>
      <div className="sheet-body">
        {feed.length === 0 ? (
          <p style={{ color: 'var(--ink-3)' }}>{t('cockpit.feed.empty')}</p>
        ) : (
          <div className="feed-list">
            {feed.map((entry) => {
              const { title, detail } = describeFeedEntry(entry, t);
              return (
                <div className="feed-row" key={entry.key}>
                  <span className="feed-icon" aria-hidden="true">
                    •
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ display: 'block', fontSize: 'var(--k-fs-s)' }}>{title}</strong>
                    {detail ? (
                      <span className="mono" style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)' }}>
                        {detail}
                      </span>
                    ) : null}
                  </span>
                  <span className="mono" style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
                    {new Date(entry.receivedAt).toLocaleTimeString(locale)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
