'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Download, Search, Table2, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { TruncationNote } from '@/components/ui/TruncationNote';
import { FolioHeader } from '@/components/FolioHeader';
import { CoChip } from '@/components/ui/CoChip';
import { Kpi } from '@/components/ui/Kpi';
import { RadarChart, RadarAxis } from '@/components/ui/RadarChart';
import { Table, Column } from '@/components/ui/Table';
import { useI18n } from '@/i18n/provider';
import { useAuth } from '@/lib/auth-context';
import { isCompanyRole } from '@/lib/auth/roles';
import { TranslationKey } from '@/i18n/translations';
import { fetchAllPages } from '@/lib/paginate';
import { apiGet, apiPath } from '@/lib/api-client';
import { buildCsv, downloadCsv } from '@/lib/csv';
import { MonitoringCompanyScore, MonitoringJourney, MonitoringJourneyStep, MonitoringScores, MonitoringWeights } from '@/lib/types';

const PAGE_SIZE = 6; // pagination fixe 6/p — A.5

type T = (k: TranslationKey) => string;

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
function radarLabel(key: keyof MonitoringWeights, t: T): string {
  if (key === 'qualiteDonnees') return t('monitoring.radar.donnees');
  if (key === 'demandesTardives') return t('monitoring.radar.demandesATemps');
  return t(WEIGHT_LABELS.find((w) => w.key === key)!.label);
}

/** Tonalité d'une note lettrée (A/B = conforme, C = vigilance, D = alerte) — couleur du score, de sa barre et de la pastille « Note », comme la maquette. */
function gradeTone(grade: 'A' | 'B' | 'C' | 'D' | null): 'ok' | 'warn' | 'ko' | 'na' {
  if (grade === 'A' || grade === 'B') return 'ok';
  if (grade === 'C') return 'warn';
  if (grade === 'D') return 'ko';
  return 'na';
}

/**
 * Score composite : grand chiffre coloré + barre (maquette). Valeur RÉELLE
 * renvoyée par le back (jamais arrondie ni recalculée) ; `null` (aucune
 * composante disponible) → repère "non disponible", jamais un crash.
 */
function ScoreCell({ score, grade, t }: { score: number | null; grade: 'A' | 'B' | 'C' | 'D' | null; t: T }) {
  if (score === null) return <span className="mon-na">{t('common.noData')}</span>;
  return (
    <span className={`mon-score ${gradeTone(grade)}`}>
      <span className="mon-score-value">{score}</span>
      <span className="mon-score-track" aria-hidden="true">
        <span className="mon-score-fill" style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
      </span>
    </span>
  );
}

/** Valeur absente (`null`, composante `NON_DISPONIBLE`) : tiret discret, libellé "non disponible" lu par les lecteurs d'écran et en infobulle — jamais une valeur inventée. */
function NotAvailable({ t }: { t: T }) {
  return (
    <span className="mon-na" title={t('common.noData')} aria-label={t('common.noData')}>
      —
    </span>
  );
}

/** Formatte un pourcentage RÉEL (`profile.*RatePct`/`details.qualiteDonnees.value`) — `null` → `null` (rendu "non disponible" par l'appelant). */
function pctText(value: number | null): string | null {
  return value === null ? null : `${value} %`;
}

/** Formatte un délai en jours (`profile.avgResponseDays`) — même convention que `/stats` (`${value} j`, pas de libellé traduit pour l'unité). */
function daysText(value: number | null): string | null {
  return value === null ? null : `${value} j`;
}

/** Cellule numérique du classement : valeur réelle ou repère "non disponible" ; « — » simple quand la ligne n'a pas de détail (SEC-26). */
function numCell(value: string | number | null | undefined, t: T) {
  if (value === undefined) return <span className="mono mon-na">—</span>;
  if (value === null) return <NotAvailable t={t} />;
  return <span className="mono">{value}</span>;
}

/** Même mapping état→tonalité que `/exchanges` (`stateTone`, `exchanges/page.tsx`) — un recours garde la même sémantique de couleur partout dans l'app. */
function stateTone(state: string): 'ok' | 'warn' | 'ko' | 'a' {
  if (state === 'FORCLOS' || state === 'REJETE') return 'ko';
  if (state === 'OPPOSITION' || state === 'CONTESTATION') return 'warn';
  if (state === 'COMMISSION') return 'a';
  return 'ok';
}

/**
 * Teinte d'une pastille de parcours (une pastille = une étape RÉELLEMENT
 * franchie, `journey.steps`) : demande et règlement en teal, opposition et
 * contestation en rouge, saisine de la Commission en gris (acte de place).
 */
function stepTone(key: MonitoringJourneyStep['key']): 'ok' | 'ko' | 'na' {
  if (key === 'annexe3' || key === 'annexe4') return 'ko';
  if (key === 'commission') return 'na';
  return 'ok';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Identifiant technique (UUID) abrégé à ses 8 premiers caractères pour l'affichage (même convention que `/monthly`) ; l'identifiant complet reste en infobulle et dans la recherche. */
function shortId(id: string): string {
  return UUID.test(id) ? id.slice(0, 8).toUpperCase() : id;
}

export default function MonitoringPage() {
  const { t } = useI18n();
  const { me } = useAuth();
  // SEC-26 : un rôle compagnie ne reçoit le détail (`details`, `profile`) que
  // pour SA compagnie ; les autres lignes du classement n'ont que rang, note et score.
  const companyRole = isCompanyRole(me?.role);
  const [page, setPage] = useState(1);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [journeyPage, setJourneyPage] = useState(1);
  const [journeySearch, setJourneySearch] = useState('');

  const query = useQuery({
    queryKey: ['monitoring', 'scores'],
    queryFn: () => apiGet<MonitoringScores>('/monitoring/scores'),
  });

  const companies = query.data?.companies ?? [];
  const picked = companies.find((c) => c.code === selectedCode) ?? (companyRole ? companies.find((c) => c.code === me?.company) : companies[0]) ?? null;
  // Seule une ligne détaillée alimente le profil et la vue par dossier (journeys : 403 hors de sa compagnie).
  const selected = picked && picked.details && picked.profile ? { ...picked, details: picked.details, profile: picked.profile } : null;
  const pageRows = companies.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Nouvelle compagnie sélectionnée : la "Vue par dossier" repart à la page 1 (le filtre de recherche, lui, reste — sélectionner une autre compagnie n'implique pas qu'on cherchait autre chose).
  useEffect(() => {
    setJourneyPage(1);
  }, [selected?.code]);

  const journeysQuery = useQuery({
    queryKey: ['monitoring', 'journeys', selected?.code],
    // SEC-13 : pages successives de 100 (plafond `FETCH_ALL_MAX_ITEMS`) pour la recherche locale.
    queryFn: () => fetchAllPages<MonitoringJourney>(apiPath`/monitoring/companies/${selected!.code}/journeys`),
    enabled: !!selected,
  });

  const filteredJourneys = useMemo(() => {
    const all = journeysQuery.data?.items ?? [];
    const q = journeySearch.trim().toLowerCase();
    if (!q) return all;
    return all.filter((j) => j.id.toLowerCase().includes(q) || j.reference.toLowerCase().includes(q) || j.claimId.toLowerCase().includes(q) || j.counterparty.toLowerCase().includes(q));
  }, [journeysQuery.data, journeySearch]);
  const journeyRows = filteredJourneys.slice((journeyPage - 1) * PAGE_SIZE, journeyPage * PAGE_SIZE);

  const columns: Column<MonitoringCompanyScore>[] = useMemo(
    () => [
      { key: 'rank', header: t('monitoring.col.rank'), render: (r) => <span className="mon-rank-n">{r.rank}</span> },
      { key: 'company', header: t('monitoring.col.company'), render: (r) => <CoChip code={r.code} withName /> },
      { key: 'score', header: t('monitoring.col.score'), render: (r) => <ScoreCell score={r.score} grade={r.grade} t={t} /> },
      {
        key: 'grade',
        header: t('monitoring.col.grade'),
        render: (r) => <span className={`mon-grade ${gradeTone(r.grade)}`}>• {r.grade ?? '—'}</span>,
      },
      { key: 'delaisPct', header: t('monitoring.col.delaisPct'), render: (r) => numCell(r.profile ? pctText(r.profile.onTimeResponsePct) : undefined, t) },
      { key: 'silencesPct', header: t('monitoring.col.silencesPct'), render: (r) => numCell(r.profile ? pctText(r.profile.silencesRatePct) : undefined, t) },
      { key: 'oppEmisesPct', header: t('monitoring.col.oppEmisesPct'), render: (r) => numCell(r.profile ? pctText(r.profile.oppositionsRatePct) : undefined, t) },
      { key: 'avgDelay', header: t('monitoring.col.avgDelay'), render: (r) => numCell(r.profile ? daysText(r.profile.avgResponseDays) : undefined, t) },
      { key: 'forclos', header: t('monitoring.col.forclos'), render: (r) => numCell(r.profile ? r.profile.forclosCount : undefined, t) },
      { key: 'donnees', header: t('monitoring.col.donnees'), render: (r) => numCell(r.details ? pctText(r.details.qualiteDonnees.value) : undefined, t) },
    ],
    [t],
  );

  const journeyColumns: Column<MonitoringJourney>[] = useMemo(
    () => [
      {
        key: 'recours',
        header: t('monitoring.journeys.col.recours'),
        render: (j) => (
          <div className="mon-ref">
            <span className="mono" title={j.id}>
              {j.reference}
            </span>
            <span className="mono mon-ref-sub" title={j.claimId}>
              {shortId(j.claimId)}
            </span>
          </div>
        ),
      },
      {
        key: 'sens',
        header: t('monitoring.journeys.col.sens'),
        render: (j) => (
          <span className={`mon-dir ${j.direction === 'EMIS' ? 'emis' : 'recu'}`}>
            {t(j.direction === 'EMIS' ? 'monitoring.journeys.direction.emisPrefix' : 'monitoring.journeys.direction.recuPrefix')} {j.counterparty}
          </span>
        ),
      },
      {
        key: 'parcours',
        header: t('monitoring.journeys.col.parcours'),
        render: (j) => (
          <span className="mon-steps">
            <span aria-hidden="true" className="mon-dots">
              {j.steps.map((s, i) => (
                <span key={`${j.id}-${s.key}-${i}`} className={`mon-dot ${stepTone(s.key)}`} />
              ))}
            </span>
            <span className="mon-steps-n">
              {j.steps.length} {t('monitoring.journeys.steps.suffix')}
            </span>
          </span>
        ),
      },
      {
        key: 'etat',
        header: t('monitoring.journeys.col.etat'),
        render: (j) => <span className={`tag ${stateTone(j.state)} mon-state`}>• {t(`exchanges.state.${j.state}` as TranslationKey)}</span>,
      },
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

  const na = t('common.noData');
  const tiles = selected
    ? [
        { key: 'onTime', value: pctText(selected.profile.onTimeResponsePct), label: `${t('monitoring.tile.onTimePrefix')} ${silenceDays} j` },
        { key: 'avgDelay', value: daysText(selected.profile.avgResponseDays), label: t('monitoring.tile.avgDelay') },
        { key: 'oppEmises', value: selected.profile.oppositionsEmisesCount, label: t('monitoring.tile.oppEmises') },
        { key: 'oppSubies', value: selected.profile.oppositionsSubiesCount, label: t('monitoring.tile.oppSubies') },
        { key: 'silences', value: selected.profile.silencesCount, label: t('monitoring.tile.silences') },
        { key: 'contestations', value: selected.profile.contestationsCount, label: t('monitoring.tile.contestations') },
        { key: 'forclos', value: selected.profile.forclosCount, label: t('monitoring.tile.forclos') },
        { key: 'donnees', value: pctText(selected.details.qualiteDonnees.value), label: t('monitoring.tile.donnees') },
      ]
    : [];

  // Export CSV (« ⤓ Excel » de la maquette) — généré côté front depuis les données RÉELLEMENT
  // chargées (aucun endpoint d'export côté API, même convention que `/matching`/`/quarter`) :
  // pas un classeur Excel mis en forme. Les lignes sans détail (SEC-26) restent vides.
  function exportRanking() {
    const header = columns.map((c) => c.header);
    const rows = companies.map((r) => [
      r.rank,
      r.code,
      r.score ?? '',
      r.grade ?? '',
      r.profile?.onTimeResponsePct ?? '',
      r.profile?.silencesRatePct ?? '',
      r.profile?.oppositionsRatePct ?? '',
      r.profile?.avgResponseDays ?? '',
      r.profile?.forclosCount ?? '',
      r.details?.qualiteDonnees.value ?? '',
    ]);
    downloadCsv('classement-conformite.csv', buildCsv(header, rows));
  }

  function exportJourneys() {
    if (!selected) return;
    const header = [
      t('monitoring.journeys.col.recours'),
      t('monitoring.journeys.col.sens'),
      t('monitoring.journeys.amount'),
      t('monitoring.journeys.col.parcours'),
      t('monitoring.journeys.col.etat'),
    ];
    const rows = filteredJourneys.map((j) => [
      j.reference,
      `${t(j.direction === 'EMIS' ? 'monitoring.journeys.direction.emisPrefix' : 'monitoring.journeys.direction.recuPrefix')} ${j.counterparty}`,
      j.amount,
      j.steps.map((s) => s.key).join(' > '),
      j.state,
    ]);
    downloadCsv(`parcours-${selected.code}.csv`, buildCsv(header, rows));
  }

  return (
    <>
      <FolioHeader
        badge="Module F · §6.8"
        title={t('monitoring.title')}
        subtitle={t('monitoring.subtitle')}
        actions={
          <Link href="/stats" className="btn-outline mon-kpi-link" title={t('monitoring.action.kpi.title')}>
            <Table2 size={16} aria-hidden="true" />
            {t('monitoring.action.kpi')}
          </Link>
        }
      />

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
          <div className={`sheet mon-rank${companies.length <= PAGE_SIZE ? ' single' : ''}`}>
            <div className="sheet-head">
              <span>{t('monitoring.section.ranking')}</span>
              <button type="button" className="mon-xl" onClick={exportRanking} disabled={companies.length === 0} title={t('monitoring.export.ranking.title')}>
                <Download size={14} aria-hidden="true" />
                {t('common.exportExcel')}
              </button>
            </div>
            <div className="sheet-body flush">
              {companyRole ? <p className="mon-restricted">{t('monitoring.restricted.note')}</p> : null}
              <Table
                columns={columns}
                rows={pageRows}
                page={page}
                total={companies.length}
                pageSize={PAGE_SIZE}
                onPageChange={setPage}
                onRowClick={(r) => {
                  if (r.details && r.profile) setSelectedCode(r.code);
                }}
                getRowKey={(r) => r.code}
                selectedKey={selected?.code}
              />
            </div>
          </div>

          {!selected ? (
            <p className="mon-empty">{t('monitoring.panel.empty')}</p>
          ) : (
            <div className="grid g-mon mon-grid">
              <div className="sheet mon-profile">
                <div className="sheet-head">
                  <span>
                    {t('monitoring.section.profile')} — {selected.code}
                  </span>
                </div>
                <div className="sheet-body">
                  <div className="mon-radar">
                    <RadarChart axes={radarAxes} centerValue={selected.score} size={400} />
                  </div>
                  {showOppositionAlert ? (
                    <div className="mon-alert" role="alert">
                      <TriangleAlert size={15} aria-hidden="true" />
                      <span>
                        {t('monitoring.alert.oppositions.prefix')} ({selected.profile.oppositionsRatePct} %) — {t('monitoring.alert.oppositions.suffix')}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="mon-side">
                <div className="mon-tiles">
                  {tiles.map((tile) => (
                    <Kpi key={tile.key} value={tile.value ?? '—'} label={tile.label} title={tile.value === null ? na : undefined} />
                  ))}
                </div>

                <div className="sheet mon-journeys">
                  <div className="sheet-head">
                    <span>{t('monitoring.section.journeys')}</span>
                    <button
                      type="button"
                      className="mon-xl"
                      onClick={exportJourneys}
                      disabled={filteredJourneys.length === 0}
                      title={t('monitoring.export.journeys.title')}
                    >
                      <Download size={14} aria-hidden="true" />
                      {t('common.exportExcel')}
                    </button>
                  </div>
                  <div className="sheet-body">
                    <label className="mon-search">
                      <Search size={16} aria-hidden="true" />
                      <input
                        type="search"
                        value={journeySearch}
                        onChange={(e) => {
                          setJourneySearch(e.target.value);
                          setJourneyPage(1);
                        }}
                        aria-label={t('monitoring.journeys.search.label')}
                        placeholder={t('monitoring.journeys.search.label')}
                      />
                    </label>

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
                      <>
                        <TruncationNote truncated={journeysQuery.data?.truncated} shown={journeysQuery.data?.items.length ?? 0} total={journeysQuery.data?.total ?? 0} />
                        <Table
                          columns={journeyColumns}
                          rows={journeyRows}
                          page={journeyPage}
                          total={filteredJourneys.length}
                          pageSize={PAGE_SIZE}
                          onPageChange={setJourneyPage}
                          getRowKey={(j) => j.id}
                        />
                      </>
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
