'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link2, Table2 } from 'lucide-react';
import { TruncationNote } from '@/components/ui/TruncationNote';
import { FolioHeader } from '@/components/FolioHeader';
import { CoChip } from '@/components/ui/CoChip';
import { Kpi, KpiRow } from '@/components/ui/Kpi';
import { Table, Column } from '@/components/ui/Table';
import { Tag, TagTone } from '@/components/ui/Tag';
import { useI18n } from '@/i18n/provider';
import { TranslationKey } from '@/i18n/translations';
import { fetchAllPages } from '@/lib/paginate';
import { apiGet, apiPath } from '@/lib/api-client';
import { buildCsv, downloadCsv } from '@/lib/csv';
import { useAuth } from '@/lib/auth-context';
import { isCompanyRole } from '@/lib/auth/roles';
import { FraudAction, FraudCase, FraudCasesPage, FraudSeverity, FraudSignalGroup, FraudSignalGroupResult, Paginated } from '@/lib/types';

const PAGE_SIZE = 6; // pagination fixe 6/p — A.5

const SEVERITY_ORDER: Record<FraudSeverity, number> = { ELEVEE: 0, MOYENNE: 1, FAIBLE: 2 };
const SEVERITY_TONE: Record<FraudSeverity, TagTone> = { ELEVEE: 'ko', MOYENNE: 'warn', FAIBLE: 'a' };
const SEVERITY_LABEL: Record<FraudSeverity, TranslationKey> = {
  ELEVEE: 'fraude.severity.ELEVEE',
  MOYENNE: 'fraude.severity.MOYENNE',
  FAIBLE: 'fraude.severity.FAIBLE',
};
const ACTION_LABEL: Record<FraudAction['type'], TranslationKey> = {
  APPARIEMENT_MANUEL: 'fraude.action.type.APPARIEMENT_MANUEL',
  DELIAGE: 'fraude.action.type.DELIAGE',
  RELIAGE: 'fraude.action.type.RELIAGE',
  TRANSMISSION_TARDIVE: 'fraude.action.type.TRANSMISSION_TARDIVE',
};

/** Libellés des groupes de signaux (dossier technique §9, panneau de détail) — voir `FraudSignalGroup` (`fraud.dto.ts` back, additif 2026-10-18). */
const SIGNAL_GROUP_LABEL: Record<FraudSignalGroup, TranslationKey> = {
  DOUBLONS_ECONSTAT: 'fraude.signal.group.DOUBLONS_ECONSTAT',
  RESEAU_RECURRENCE: 'fraude.signal.group.RESEAU_RECURRENCE',
  MONTANTS_PLAFOND: 'fraude.signal.group.MONTANTS_PLAFOND',
  INCOHERENCES_AB: 'fraude.signal.group.INCOHERENCES_AB',
  VELOCITE: 'fraude.signal.group.VELOCITE',
};

/** Ordre d'affichage des sections du panneau (celui du dossier technique §9 et de la maquette). */
const SIGNAL_GROUP_ORDER: FraudSignalGroup[] = ['DOUBLONS_ECONSTAT', 'RESEAU_RECURRENCE', 'MONTANTS_PLAFOND', 'INCOHERENCES_AB', 'VELOCITE'];

function formatDzd(amount: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'DZD', maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount.toLocaleString()} DA`;
  }
}

/** Date courte « 5 juil. 2026 09:57 » de la maquette (journal des actions). */
function formatDateTime(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
}

function asNum(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

function asStr(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  return String(v);
}

/**
 * Description courte du signal dominant d'un groupe (dossier technique §9,
 * panneau de détail) — composée des SEULS champs réellement présents dans
 * `details` pour le `type` du cas (voir `fraud.detection.ts` back pour la
 * forme exacte de chaque `details`), jamais une donnée inventée.
 */
function describeDominantCase(c: FraudCase, locale: string): string {
  const d = c.details;
  switch (c.type) {
    case 'DOUBLON': {
      const plate = asStr(d.plateA) ?? '—';
      const count = asNum(d.count);
      const date = asStr(d.accidentDate);
      return `Plaque ${plate} déclarée ${count ?? 'plusieurs'} fois${date ? ` le ${new Date(date).toLocaleDateString(locale)}` : ''}`;
    }
    case 'ECONSTAT_REUTILISE': {
      const num = asStr(d.numEconstat) ?? '—';
      const count = asNum(d.count);
      return `N° e-constat ${num} réutilisé sur ${count ?? 'plusieurs'} déclarations divergentes`;
    }
    case 'RECURRENCE_VEHICULE': {
      const plate = asStr(d.plateA) ?? '—';
      const companies = asNum(d.companiesCount);
      const days = asNum(d.windowDays);
      return `Véhicule ${plate} déclaré par ${companies ?? 'plusieurs'} compagnies en ${days ?? '—'} jours`;
    }
    case 'MONTANT_CALIBRE': {
      const bandMax = asNum(d.bandMax);
      return `Montant calibré juste sous le plafond IDA${bandMax !== undefined ? ` (${formatDzd(bandMax, locale)})` : ''}`;
    }
    case 'INCOHERENCE_AB': {
      const diffRatio = asNum(d.diffRatio);
      const amountA = asNum(d.amountA);
      const amountB = asNum(d.amountB);
      const pct = diffRatio !== undefined ? Math.round(diffRatio * 100) : undefined;
      const amounts = amountA !== undefined && amountB !== undefined ? ` (${formatDzd(amountA, locale)} / ${formatDzd(amountB, locale)})` : '';
      return `Montants A/B divergents${pct !== undefined ? ` de plus de ${pct}%` : ''}${amounts}`;
    }
    case 'VELOCITE_ADHERENT': {
      const count = asNum(d.count);
      const day = asStr(d.day);
      return `Rafale de ${count ?? 'plusieurs'} déclarations de l'adhérent le même jour${day ? ` (${new Date(day).toLocaleDateString(locale)})` : ''}`;
    }
    default:
      return '';
  }
}

/**
 * Barre de score d'un cas (maquette : piste grise, remplissage teinté, score
 * en gras). Propre à l'écran : le `ScoreBar` partagé colore en vert les
 * scores élevés (score d'appariement), alors qu'ici un score élevé est un
 * risque — la teinte suit donc la gravité renvoyée par l'API.
 */
function CaseScore({ score, severity }: { score: number; severity: FraudSeverity }) {
  return (
    <span className={`fr-score sev-${severity}`}>
      <span className="fr-score-track" aria-hidden="true">
        <span className="fr-score-fill" style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
      </span>
      <span className="fr-score-val">{score}</span>
    </span>
  );
}

export default function FraudePage() {
  const { t, locale } = useI18n();
  const { me } = useAuth();
  const [casesPage, setCasesPage] = useState(1);
  const [actionsPage, setActionsPage] = useState(1);
  const [selectedCase, setSelectedCase] = useState<FraudCase | null>(null);
  const [exportingActions, setExportingActions] = useState(false);

  // SEC-21/SEC-26 : le journal des actions suspectes est l'audit trail de la
  // place (403 pour un rôle compagnie) ; un rôle compagnie ne voit des cas que
  // ses propres dossiers, les autres parties étant seulement dénombrées.
  const companyRole = isCompanyRole(me?.role);
  const showActions = !!me && !companyRole;

  const casesQuery = useQuery({
    queryKey: ['fraud', 'cases', casesPage],
    queryFn: () => apiGet<FraudCasesPage>('/fraud/cases', { page: casesPage, pageSize: PAGE_SIZE }),
  });

  const actionsQuery = useQuery({
    queryKey: ['fraud', 'actions', actionsPage],
    queryFn: () => apiGet<Paginated<FraudAction>>('/fraud/actions', { page: actionsPage, pageSize: PAGE_SIZE }),
    enabled: showActions,
  });

  // KPIs (écran 9) : pas d'endpoint d'agrégat dédié (voir rapport de
  // livraison) — un second appel pleine page sert uniquement au décompte
  // (gravité élevée, compagnies concernées) et à l'export CSV, jamais
  // affiché tel quel comme liste (la liste affichée reste la page courante,
  // paginée serveur).
  const casesAllQuery = useQuery({
    queryKey: ['fraud', 'cases', 'all'],
    // SEC-13 : pages successives de 100 (plafond `FETCH_ALL_MAX_ITEMS`).
    queryFn: () => fetchAllPages<FraudCase>('/fraud/cases'),
  });

  // Tri d'affichage par gravité ("file priorisée par gravité", écran 9) — la
  // gravité elle-même est renvoyée par l'API, on ne fait que l'ordonner ici.
  const casePage = useMemo(
    () => [...(casesQuery.data?.items ?? [])].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
    [casesQuery.data],
  );
  const actionPage = actionsQuery.data?.items ?? [];

  // Maquette : le panneau de détail est ouvert sur le premier cas de la file
  // tant qu'aucun cas n'a été choisi (clic sur une ligne pour en changer).
  const currentCase = selectedCase ?? casePage[0] ?? null;

  // Rôle compagnie : uniquement SA compagnie (le backend refuse toute autre, SEC-38).
  const primaryCompany = companyRole ? me?.company : currentCase?.companiesInvolved[0];
  const signalsQuery = useQuery({
    queryKey: ['fraud', 'adherents', primaryCompany, 'signals'],
    queryFn: () => apiGet<FraudSignalGroupResult[]>(apiPath`/fraud/adherents/${primaryCompany!}/signals`),
    enabled: !!currentCase && !!primaryCompany,
  });
  const analysis = casesQuery.data?.analysis;

  const signalGroups = useMemo(
    () => [...(signalsQuery.data ?? [])].sort((a, b) => SIGNAL_GROUP_ORDER.indexOf(a.group as FraudSignalGroup) - SIGNAL_GROUP_ORDER.indexOf(b.group as FraudSignalGroup)),
    [signalsQuery.data],
  );

  const kpis = useMemo(() => {
    const allCases = casesAllQuery.data?.items ?? [];
    const companies = new Set<string>();
    for (const c of allCases) for (const co of c.companiesInvolved) companies.add(co);
    return {
      cases: casesAllQuery.data?.total ?? casesQuery.data?.total ?? 0,
      severe: allCases.filter((c) => c.severity === 'ELEVEE').length,
      actions: actionsQuery.data?.total ?? 0,
      companies: companies.size,
    };
  }, [casesAllQuery.data, casesQuery.data, actionsQuery.data]);

  // Export CSV côté front (aucun endpoint d'export côté API) : la population
  // déjà lue pour les KPI, telle que renvoyée par l'API (filtrée par rôle côté
  // back, SEC-26) — jamais enrichie.
  function exportCases() {
    const items = casesAllQuery.data?.items ?? [];
    if (items.length === 0) return;
    const header = [
      t('fraude.col.declaration'),
      t('fraude.col.type'),
      t('fraude.col.score'),
      t('fraude.col.severity'),
      t('fraude.col.companies'),
      t('fraude.col.plate'),
      t('fraude.col.detectedAt'),
    ];
    const rows = items.map((c) => [c.id, c.type, c.score, c.severity, c.companiesInvolved.join(' '), c.plateA ?? '', c.detectedAt]);
    downloadCsv(`cas-suspects-${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(header, rows));
  }

  async function exportActions() {
    setExportingActions(true);
    try {
      // SEC-13 : pages successives de 100 ; SEC-21 : bouton absent pour un rôle compagnie.
      const all = await fetchAllPages<FraudAction>('/fraud/actions');
      const header = [t('fraude.action.col.ref'), t('fraude.action.col.type'), t('fraude.action.col.actor'), t('fraude.action.col.at')];
      const rows = all.items.map((a) => [a.claimId ?? a.matchId ?? a.id, a.type, a.actor, a.at]);
      downloadCsv(`actions-suspectes-${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(header, rows));
    } finally {
      setExportingActions(false);
    }
  }

  const caseColumns: Column<FraudCase>[] = [
    {
      key: 'id',
      header: t('fraude.col.declaration'),
      render: (r) => (
        <span className="mono fr-id" title={r.id}>
          {r.id}
        </span>
      ),
    },
    { key: 'adherent', header: t('fraude.col.adherent'), render: (r) => <CoChip code={r.companiesInvolved[0] ?? '—'} /> },
    { key: 'score', header: t('fraude.col.score'), render: (r) => <CaseScore score={r.score} severity={r.severity} /> },
    {
      key: 'severity',
      header: t('fraude.col.severity'),
      render: (r) => (
        <span className="fr-sev">
          <Tag tone={SEVERITY_TONE[r.severity]}>{t(SEVERITY_LABEL[r.severity])}</Tag>
        </span>
      ),
    },
    { key: 'plate', header: t('fraude.col.plate'), render: (r) => <span className="mono">{r.plateA ?? '—'}</span> },
    ...(companyRole
      ? [
          {
            key: 'counterpart',
            header: t('fraude.col.counterpart'),
            render: (r: FraudCase) =>
              r.counterpartClaims || r.counterpartCompanies ? (
                <span className="fr-counterpart">
                  {r.counterpartClaims ?? 0} {t('fraude.counterpart.claims')} · {r.counterpartCompanies ?? 0} {t('fraude.counterpart.companies')}
                </span>
              ) : (
                <span className="fr-muted">—</span>
              ),
          } satisfies Column<FraudCase>,
        ]
      : []),
  ];

  // "Réf." dérivée de `claimId` (TRANSMISSION_TARDIVE) sinon `matchId`
  // (APPARIEMENT_MANUEL/DELIAGE/RELIAGE) sinon l'id de l'action elle-même —
  // jamais une valeur fabriquée (voir `FraudActionViewDto`, back). La colonne
  // "Poids" de la capture de référence est volontairement omise : aucun champ
  // back ne porte de pondération par action (voir HANDOFF.md).
  const actionColumns: Column<FraudAction>[] = [
    { key: 'ref', header: t('fraude.action.col.ref'), render: (r) => <span className="mono">{r.claimId ?? r.matchId ?? r.id}</span> },
    { key: 'type', header: t('fraude.action.col.type'), render: (r) => t(ACTION_LABEL[r.type]) },
    { key: 'actor', header: t('fraude.action.col.actor'), render: (r) => r.actor },
    { key: 'at', header: t('fraude.action.col.at'), render: (r) => <span className="mono">{formatDateTime(r.at, locale)}</span> },
  ];

  return (
    <div className="fr-screen">
      <FolioHeader
        badge="Module G · §6.9"
        title={t('fraude.title')}
        subtitle={t('fraude.subtitle')}
        actions={
          <button
            type="button"
            className="btn-outline"
            onClick={exportCases}
            disabled={(casesAllQuery.data?.items.length ?? 0) === 0}
            title={t('fraude.export.cases.title')}
          >
            <Table2 size={16} aria-hidden="true" />
            {t('fraude.export.cases')}
          </button>
        }
      />

      <KpiRow>
        <Kpi
          value={kpis.cases}
          label={t('fraude.kpi.cases')}
          extra={analysis ? <span className="fr-kpi-chip">{`${analysis.claimsAnalyzed} ${t('fraude.analysis.claims')}`}</span> : undefined}
        />
        <Kpi value={kpis.severe} label={t('fraude.kpi.severe')} extra={<span className="fr-kpi-chip">{t('fraude.kpi.severe.extra')}</span>} />
        {showActions ? <Kpi value={kpis.actions} label={t('fraude.kpi.actions')} extra={<span className="fr-kpi-chip">{t('fraude.kpi.actions.extra')}</span>} /> : null}
        {/* Rôle compagnie : les autres compagnies ne sont que dénombrées par cas (SEC-26), pas identifiables. */}
        {companyRole ? null : <Kpi value={kpis.companies} label={t('fraude.kpi.companies')} />}
      </KpiRow>
      <TruncationNote truncated={casesAllQuery.data?.truncated} shown={casesAllQuery.data?.items.length ?? 0} total={casesAllQuery.data?.total ?? 0} />
      {analysis?.truncated ? (
        <p className="note warn fr-note" role="status">
          {t('fraude.analysis.truncated')} ({analysis.claimsAnalyzed} {t('fraude.analysis.claims')})
        </p>
      ) : null}

      <div className="grid fr-grid">
        <div className="sheet fr-queue">
          <div className="sheet-head">
            <span>{t('fraude.panel.queueTitle')}</span>
          </div>
          <div className="sheet-body flush">
            {casesQuery.isLoading ? (
              <p className="fr-pad">{t('common.loading')}</p>
            ) : casesQuery.error ? (
              <div className="note ko fr-pad" role="alert">
                <span>{t('common.error')}</span>
                <button type="button" onClick={() => casesQuery.refetch()}>
                  {t('common.retry')}
                </button>
              </div>
            ) : (
              <Table
                columns={caseColumns}
                rows={casePage}
                page={casesPage}
                total={casesQuery.data?.total ?? 0}
                pageSize={PAGE_SIZE}
                onPageChange={(p) => {
                  setCasesPage(p);
                  setSelectedCase(null);
                }}
                onRowClick={setSelectedCase}
                getRowKey={(r) => r.id}
                selectedKey={currentCase?.id}
              />
            )}
          </div>
        </div>

        <aside className="sheet fr-panel" aria-label={t('fraude.panel.title')}>
          <div className="sheet-head">
            {currentCase ? (
              <span className="fr-panel-title" title={currentCase.id}>
                {t('fraude.col.id')} <span className="mono">{currentCase.id}</span>
              </span>
            ) : (
              <span>{t('fraude.panel.title')}</span>
            )}
          </div>
          <div className="sheet-body">
            {!currentCase ? (
              <p className="fr-muted">{t('fraude.panel.empty')}</p>
            ) : (
              <>
                <div className="fr-ident">
                  <CoChip code={primaryCompany ?? '—'} />
                  <span className="fr-ident-text">
                    {primaryCompany ?? '—'}
                    <span className="mono"> · {currentCase.plateA ?? '—'}</span>
                  </span>
                  <span className="fr-sev fr-ident-sev">
                    <Tag tone={SEVERITY_TONE[currentCase.severity]}>
                      {t(SEVERITY_LABEL[currentCase.severity])} · {currentCase.score}/100
                    </Tag>
                  </span>
                </div>
                {currentCase.counterpartClaims || currentCase.counterpartCompanies ? (
                  <p className="fr-counterpart-note">
                    {t('fraude.counterpart.note')} {currentCase.counterpartClaims ?? 0} {t('fraude.counterpart.claims')} ·{' '}
                    {currentCase.counterpartCompanies ?? 0} {t('fraude.counterpart.companies')}
                  </p>
                ) : null}

                {signalsQuery.isLoading ? (
                  <p>{t('common.loading')}</p>
                ) : signalsQuery.error ? (
                  <p className="note ko">{t('fraude.panel.signalsError')}</p>
                ) : signalGroups.length === 0 ? (
                  <p className="fr-muted">{t('fraude.panel.empty')}</p>
                ) : (
                  <div className="fr-sections">
                    {signalGroups.map((group) => {
                      const dominant = group.cases[0];
                      const score = dominant?.score ?? group.maxScore;
                      return (
                        <section key={group.group} className="fr-section">
                          <div className="fr-section-head">
                            <strong>{t(SIGNAL_GROUP_LABEL[group.group as FraudSignalGroup])}</strong>
                            {group.count > 1 ? <span title={t('fraude.signal.more.title')}>+{group.count - 1}</span> : null}
                          </div>
                          {dominant ? (
                            <div className={`fr-signal sev-${dominant.severity}`}>
                              <div className="fr-signal-row">
                                <span className="fr-signal-label">{describeDominantCase(dominant, locale)}</span>
                                <span className="fr-signal-score" title={t('fraude.signal.score.title')}>
                                  {score}
                                </span>
                              </div>
                              <span className="fr-signal-bar" aria-hidden="true">
                                <span style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
                              </span>
                            </div>
                          ) : null}
                        </section>
                      );
                    })}
                  </div>
                )}

                <Link href="/matching" className="fr-matching-link">
                  <Link2 size={14} aria-hidden="true" />
                  <span>{t('fraude.panel.matchingLink')}</span>
                </Link>
              </>
            )}
          </div>
        </aside>
      </div>

      {showActions ? (
        <div className="sheet fr-journal">
          <div className="sheet-head">
            <span>
              {t('fraude.actions.title')} ({actionsQuery.data?.total ?? 0})
            </span>
            <button
              type="button"
              className="btn-outline fr-export"
              onClick={() => void exportActions()}
              disabled={exportingActions || (actionsQuery.data?.total ?? 0) === 0}
              title={t('fraude.export.actions.title')}
            >
              <Table2 size={15} aria-hidden="true" />
              {t('fraude.export.actions')}
            </button>
          </div>
          <div className="sheet-body flush">
            {actionsQuery.isLoading ? (
              <p className="fr-pad">{t('common.loading')}</p>
            ) : actionsQuery.error ? (
              <div className="note ko fr-pad" role="alert">
                <span>{t('common.error')}</span>
                <button type="button" onClick={() => actionsQuery.refetch()}>
                  {t('common.retry')}
                </button>
              </div>
            ) : (
              <Table
                columns={actionColumns}
                rows={actionPage}
                page={actionsPage}
                total={actionsQuery.data?.total ?? 0}
                pageSize={PAGE_SIZE}
                onPageChange={setActionsPage}
                getRowKey={(r) => r.id}
              />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
