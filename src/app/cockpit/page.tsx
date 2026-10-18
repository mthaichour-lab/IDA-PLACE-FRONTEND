'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { FolioHeader } from '@/components/FolioHeader';
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
import { RealtimeEventName, useRealtime } from '@/lib/realtime';

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

function formatDzd(amount: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'DZD', maximumFractionDigits: 0 }).format(amount);
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

/** Date calendaire `AAAA-MM-JJ` à partir de composants LOCAUX — jamais via `Date#toISOString` (décalage UTC possible selon le fuseau du navigateur), pour comparer calendrier ouvré et "aujourd'hui" sans ambiguïté de fuseau. */
function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object';
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

export default function CockpitPage() {
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

  const onRealtimeEvent = useCallback(
    (event: RealtimeEventName, payload: unknown) => {
      setLive(true);
      void query.refetch();
      if (pausedRef.current) return;
      setFeed((prev) =>
        [
          { id: `${event}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, event, payload, receivedAt: Date.now() },
          ...prev,
        ].slice(0, FEED_MAX_ENTRIES),
      );
    },
    [query],
  );

  useRealtime(['claim.ingested', 'match.updated', 'metering.tick'], onRealtimeEvent);

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
  id: string;
  event: RealtimeEventName;
  payload: unknown;
  receivedAt: number;
}

/**
 * Description d'une entrée de flux — construite UNIQUEMENT à partir des
 * champs RÉELLEMENT présents sur le payload reçu (voir `claims.service.ts`
 * `emitEvent('claim.ingested', {fileName, totalRows, eligibleCount,
 * ineligibleCount, importedAt})` et `matching.service.ts`
 * `emitEvent('match.updated', {item, decision})` OU `{claimId,
 * matchedWith}` selon l'origine — décision manuelle vs recalcul automatique
 * après import). Jamais de champ inventé (ex. compagnie, wilaya, référence
 * de dossier) quand il est absent du payload réel — voir HANDOFF.md pour
 * l'écart assumé avec le texte du guide illustré sur ce point précis.
 */
function describeFeedEntry(entry: FeedEntry, t: (k: TranslationKey) => string): { title: string; detail: string } {
  const payload = entry.payload;

  if (entry.event === 'claim.ingested' && isRecord(payload) && typeof payload.fileName === 'string') {
    const totalRows = typeof payload.totalRows === 'number' ? payload.totalRows : undefined;
    const eligibleCount = typeof payload.eligibleCount === 'number' ? payload.eligibleCount : undefined;
    const counts = totalRows !== undefined && eligibleCount !== undefined ? ` — ${eligibleCount}/${totalRows} ${t('cockpit.feed.ingestion.eligibleSuffix')}` : '';
    return { title: t('cockpit.feed.ingestion'), detail: `${payload.fileName}${counts}` };
  }

  if (entry.event === 'match.updated' && isRecord(payload)) {
    const decisionRaw = payload.decision;
    if (isRecord(decisionRaw)) {
      const status = typeof decisionRaw.status === 'string' ? decisionRaw.status : '—';
      const decidedBy = typeof decisionRaw.decidedBy === 'string' ? decisionRaw.decidedBy : '—';
      const itemRaw = payload.item;
      const itemId = isRecord(itemRaw) && typeof itemRaw.id === 'string' ? itemRaw.id : undefined;
      return { title: t('cockpit.feed.matching'), detail: `${itemId ? `${itemId} · ` : ''}${status} (${decidedBy})` };
    }
    if (typeof payload.claimId === 'string') {
      const matchedWith = typeof payload.matchedWith === 'string' ? payload.matchedWith : undefined;
      return {
        title: t('cockpit.feed.matching'),
        detail: matchedWith ? `${payload.claimId} ⇄ ${matchedWith}` : `${payload.claimId} — ${t('cockpit.feed.matching.noCandidate')}`,
      };
    }
  }

  return { title: entry.event, detail: '' };
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
                <div className="feed-row" key={entry.id}>
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
