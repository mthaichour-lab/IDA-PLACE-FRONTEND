'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { FolioHeader } from '@/components/FolioHeader';
import { CoChip } from '@/components/ui/CoChip';
import { Kpi } from '@/components/ui/Kpi';
import { RadarChart, RadarAxis } from '@/components/ui/RadarChart';
import { ScoreBar } from '@/components/ui/ScoreBar';
import { Table, Column } from '@/components/ui/Table';
import { Tag, TagTone } from '@/components/ui/Tag';
import { useI18n } from '@/i18n/provider';
import { TranslationKey } from '@/i18n/translations';
import { apiGet } from '@/lib/api-client';
import { MonitoringCompanyScore, MonitoringJourney, MonitoringScores, MonitoringWeights, Paginated } from '@/lib/types';

const PAGE_SIZE = 6; // pagination fixe 6/p — A.5

/**
 * Libellés des 7 critères du scoring composite (B.2 écran 8). Même ordre
 * que les poids réels (`MONITORING_WEIGHTS`, back `monitoring.scoring.ts`)
 * — réutilisé à la fois pour le radar (axes dans le même ordre, dans le
 * sens horaire depuis le haut) et pour les libellés "Délais"/"Silences"/
 * "Oppositions"/"Forclusions"/"Pénalités" communs aux deux contextes.
 */
const WEIGHT_LABELS: { key: keyof MonitoringWeights; label: TranslationKey }[] = [
  { key: 'delais', label: 'monitoring.weight.delais' },
  { key: 'silences', label: 'monitoring.weight.silences' },
  { key: 'oppositions', label: 'monitoring.weight.oppositions' },
  { key: 'qualiteDonnees', label: 'monitoring.weight.qualiteDonnees' },
  { key: 'forclusions', label: 'monitoring.weight.forclusions' },
  { key: 'demandesTardives', label: 'monitoring.weight.demandesTardives' },
  { key: 'penalites', label: 'monitoring.weight.penalites' },
];

/**
 * Libellé d'axe radar — identique au libellé de pondération pour 5 des 7
 * critères ; "Données"/"Demandes à temps" diffèrent volontairement du
 * libellé de pondération (qui nomme le DÉFAUT mesuré, ex. "Demandes
 * tardives"), le radar affichant un score déjà dans le sens "plus haut =
 * meilleur" (voir guide illustré, écran 8).
 */
function radarLabel(key: keyof MonitoringWeights, t: (k: TranslationKey) => string): string {
  if (key === 'qualiteDonnees') return t('monitoring.radar.donnees');
  if (key === 'demandesTardives') return t('monitoring.radar.demandesATemps');
  return t(WEIGHT_LABELS.find((w) => w.key === key)!.label);
}

/** Rend un `ScoreBar` si la valeur est disponible, sinon un repère "non disponible" — jamais de crash sur une composante `NON_DISPONIBLE` (null). */
function renderScore(score: number | null, t: (k: TranslationKey) => string) {
  if (score === null) return <span style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)' }}>{t('common.noData')}</span>;
  return <ScoreBar score={score} />;
}

/** Formatte un pourcentage RÉEL (`profile.*RatePct`/`details.qualiteDonnees.value`) — `null` → repère "non disponible", jamais une valeur inventée. */
function formatPct(value: number | null, t: (k: TranslationKey) => string): string {
  return value === null ? t('common.noData') : `${value} %`;
}

/** Formatte un délai en jours (`profile.avgResponseDays`) — même convention que `/stats` (`${value} j`, pas de libellé traduit pour l'unité). */
function formatDays(value: number | null, t: (k: TranslationKey) => string): string {
  return value === null ? t('common.noData') : `${value} j`;
}

function gradeTone(grade: 'A' | 'B' | 'C' | 'D' | null): TagTone {
  if (grade === 'A' || grade === 'B') return 'ok';
  if (grade === 'C') return 'warn';
  if (grade === 'D') return 'ko';
  return 'a';
}

/** Même mapping état→tonalité que `/exchanges` (`stateTone`, `exchanges/page.tsx`) — un recours garde la même sémantique de couleur partout dans l'app. */
function stateTone(state: string): TagTone {
  if (state === 'FORCLOS' || state === 'REJETE') return 'ko';
  if (state === 'OPPOSITION' || state === 'CONTESTATION') return 'warn';
  if (state === 'COMMISSION') return 'a';
  return 'ok';
}

export default function MonitoringPage() {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [journeyPage, setJourneyPage] = useState(1);
  const [journeySearch, setJourneySearch] = useState('');

  const query = useQuery({
    queryKey: ['monitoring', 'scores'],
    queryFn: () => apiGet<MonitoringScores>('/monitoring/scores'),
  });

  const companies = query.data?.companies ?? [];
  const selected = companies.find((c) => c.code === selectedCode) ?? companies[0] ?? null;
  const pageRows = companies.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Nouvelle compagnie sélectionnée : la "Vue par dossier" repart à la page 1 (le filtre de recherche, lui, reste — sélectionner une autre compagnie n'implique pas qu'on cherchait autre chose).
  useEffect(() => {
    setJourneyPage(1);
  }, [selected?.code]);

  const journeysQuery = useQuery({
    queryKey: ['monitoring', 'journeys', selected?.code],
    queryFn: () => apiGet<Paginated<MonitoringJourney>>(`/monitoring/companies/${selected!.code}/journeys`, { page: 1, pageSize: 100_000 }),
    enabled: !!selected,
  });

  const filteredJourneys = useMemo(() => {
    const all = journeysQuery.data?.items ?? [];
    const q = journeySearch.trim().toLowerCase();
    if (!q) return all;
    return all.filter((j) => j.id.toLowerCase().includes(q) || j.claimId.toLowerCase().includes(q) || j.counterparty.toLowerCase().includes(q));
  }, [journeysQuery.data, journeySearch]);
  const journeyRows = filteredJourneys.slice((journeyPage - 1) * PAGE_SIZE, journeyPage * PAGE_SIZE);

  const columns: Column<MonitoringCompanyScore>[] = useMemo(
    () => [
      { key: 'rank', header: t('monitoring.col.rank'), render: (r) => <span className="mono">#{r.rank}</span> },
      { key: 'company', header: t('monitoring.col.company'), render: (r) => <CoChip code={r.code} /> },
      { key: 'score', header: t('monitoring.col.score'), render: (r) => renderScore(r.score, t) },
      { key: 'grade', header: t('monitoring.col.grade'), render: (r) => <Tag tone={gradeTone(r.grade)}>• {r.grade ?? '—'}</Tag> },
      { key: 'delaisPct', header: t('monitoring.col.delaisPct'), render: (r) => <span className="mono">{formatPct(r.profile.onTimeResponsePct, t)}</span> },
      { key: 'silencesPct', header: t('monitoring.col.silencesPct'), render: (r) => <span className="mono">{formatPct(r.profile.silencesRatePct, t)}</span> },
      { key: 'oppEmisesPct', header: t('monitoring.col.oppEmisesPct'), render: (r) => <span className="mono">{formatPct(r.profile.oppositionsRatePct, t)}</span> },
      { key: 'avgDelay', header: t('monitoring.col.avgDelay'), render: (r) => <span className="mono">{formatDays(r.profile.avgResponseDays, t)}</span> },
      { key: 'forclos', header: t('monitoring.col.forclos'), render: (r) => <span className="mono">{r.profile.forclosCount}</span> },
      { key: 'donnees', header: t('monitoring.col.donnees'), render: (r) => <span className="mono">{formatPct(r.details.qualiteDonnees.value, t)}</span> },
    ],
    [t],
  );

  const journeyColumns: Column<MonitoringJourney>[] = useMemo(
    () => [
      {
        key: 'recours',
        header: t('monitoring.journeys.col.recours'),
        render: (j) => (
          <div>
            <span className="mono">{j.id}</span>
            <div style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)' }}>{j.claimId}</div>
          </div>
        ),
      },
      {
        key: 'sens',
        header: t('monitoring.journeys.col.sens'),
        render: (j) => (
          <Tag tone={j.direction === 'EMIS' ? 'ok' : 'a'}>
            {t(j.direction === 'EMIS' ? 'monitoring.journeys.direction.emisPrefix' : 'monitoring.journeys.direction.recuPrefix')} {j.counterparty}
          </Tag>
        ),
      },
      {
        key: 'parcours',
        header: t('monitoring.journeys.col.parcours'),
        render: (j) => (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span aria-hidden="true" style={{ display: 'inline-flex', gap: 3 }}>
              {j.steps.map((s, i) => (
                <span key={`${j.id}-${s.key}-${i}`} style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--k-pri-2)', display: 'inline-block' }} />
              ))}
            </span>
            <span style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)' }}>
              {j.steps.length} {t('monitoring.journeys.steps.suffix')}
            </span>
          </span>
        ),
      },
      { key: 'etat', header: t('monitoring.journeys.col.etat'), render: (j) => <Tag tone={stateTone(j.state)}>{t(`exchanges.state.${j.state}` as TranslationKey)}</Tag> },
    ],
    [t],
  );

  const radarAxes: RadarAxis[] = selected
    ? WEIGHT_LABELS.map((w) => ({ key: w.key, label: radarLabel(w.key, t), value: selected.details[w.key].value }))
    : [];

  const silenceDays = query.data?.silenceDays ?? 0;
  const showOppositionAlert =
    !!selected &&
    selected.profile.oppositionsRatePct !== null &&
    query.data !== undefined &&
    selected.profile.oppositionsRatePct > query.data.oppositionAlertThresholdPct;

  const tiles = selected
    ? [
        { key: 'onTime', value: formatPct(selected.profile.onTimeResponsePct, t), label: `${t('monitoring.tile.onTimePrefix')} ${silenceDays} j` },
        { key: 'avgDelay', value: formatDays(selected.profile.avgResponseDays, t), label: t('monitoring.tile.avgDelay') },
        { key: 'oppEmises', value: selected.profile.oppositionsEmisesCount, label: t('monitoring.tile.oppEmises') },
        { key: 'oppSubies', value: selected.profile.oppositionsSubiesCount, label: t('monitoring.tile.oppSubies') },
        { key: 'silences', value: selected.profile.silencesCount, label: t('monitoring.tile.silences') },
        { key: 'contestations', value: selected.profile.contestationsCount, label: t('monitoring.tile.contestations') },
        { key: 'forclos', value: selected.profile.forclosCount, label: t('monitoring.tile.forclos') },
        { key: 'donnees', value: formatPct(selected.details.qualiteDonnees.value, t), label: t('monitoring.tile.donnees') },
      ]
    : [];

  return (
    <>
      <FolioHeader badge="Module F · §6.8" title={t('monitoring.title')} subtitle={t('monitoring.subtitle')} />

      {query.isLoading ? (
        <p>{t('common.loading')}</p>
      ) : query.error || !query.data ? (
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
              <span>{t('monitoring.section.ranking')}</span>
            </div>
            <div className="sheet-body">
              <Table
                columns={columns}
                rows={pageRows}
                page={page}
                total={companies.length}
                pageSize={PAGE_SIZE}
                onPageChange={setPage}
                onRowClick={(r) => setSelectedCode(r.code)}
                getRowKey={(r) => r.code}
              />
            </div>
          </div>

          {!selected ? (
            <p style={{ color: 'var(--ink-3)' }}>{t('monitoring.panel.empty')}</p>
          ) : (
            <div className="grid g-mon">
              <div className="sheet">
                <div className="sheet-head">
                  <span>
                    {t('monitoring.section.profile')} — {selected.code}
                  </span>
                </div>
                <div className="sheet-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--s-4)' }}>
                  <RadarChart axes={radarAxes} centerValue={selected.score} />
                  {showOppositionAlert ? (
                    <div className="note warn" role="alert" style={{ width: '100%' }}>
                      <span>
                        {t('monitoring.alert.oppositions.prefix')} ({selected.profile.oppositionsRatePct} %) — {t('monitoring.alert.oppositions.suffix')}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-5)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--s-3)' }}>
                  {tiles.map((tile) => (
                    <Kpi key={tile.key} value={tile.value} label={tile.label} />
                  ))}
                </div>

                <div className="sheet">
                  <div className="sheet-head">
                    <span>{t('monitoring.section.journeys')}</span>
                  </div>
                  <div className="sheet-body">
                    <input
                      type="search"
                      value={journeySearch}
                      onChange={(e) => {
                        setJourneySearch(e.target.value);
                        setJourneyPage(1);
                      }}
                      aria-label={t('monitoring.journeys.search.label')}
                      placeholder={t('monitoring.journeys.search.label')}
                      style={{
                        width: '100%',
                        marginBottom: 'var(--s-3)',
                        padding: '8px 12px',
                        border: '1px solid var(--rule-strong)',
                        borderRadius: 'var(--k-r-s)',
                        font: 'inherit',
                        background: 'var(--paper)',
                        color: 'var(--ink)',
                      }}
                    />

                    {journeysQuery.isLoading ? (
                      <p>{t('common.loading')}</p>
                    ) : journeysQuery.error ? (
                      <div className="note ko" role="alert">
                        <span>{t('common.error')}</span>
                        <button type="button" onClick={() => journeysQuery.refetch()}>
                          {t('common.retry')}
                        </button>
                      </div>
                    ) : (
                      <Table
                        columns={journeyColumns}
                        rows={journeyRows}
                        page={journeyPage}
                        total={filteredJourneys.length}
                        pageSize={PAGE_SIZE}
                        onPageChange={setJourneyPage}
                        getRowKey={(j) => j.id}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
