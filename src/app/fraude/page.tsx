'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { TruncationNote } from '@/components/ui/TruncationNote';
import { FolioHeader } from '@/components/FolioHeader';
import { CoChip } from '@/components/ui/CoChip';
import { Kpi, KpiRow } from '@/components/ui/Kpi';
import { ScoreBar } from '@/components/ui/ScoreBar';
import { Table, Column } from '@/components/ui/Table';
import { Tag, TagTone } from '@/components/ui/Tag';
import { useI18n } from '@/i18n/provider';
import { TranslationKey } from '@/i18n/translations';
import { fetchAllPages } from '@/lib/paginate';
import { apiGet } from '@/lib/api-client';
import { FraudAction, FraudCase, FraudSeverity, FraudSignalGroup, FraudSignalGroupResult, Paginated } from '@/lib/types';

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

function formatDzd(amount: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'DZD', maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount.toLocaleString()} DA`;
  }
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

export default function FraudePage() {
  const { t, locale } = useI18n();
  const [casesPage, setCasesPage] = useState(1);
  const [actionsPage, setActionsPage] = useState(1);
  const [selectedCase, setSelectedCase] = useState<FraudCase | null>(null);

  const casesQuery = useQuery({
    queryKey: ['fraud', 'cases', casesPage],
    queryFn: () => apiGet<Paginated<FraudCase>>('/fraud/cases', { page: casesPage, pageSize: PAGE_SIZE }),
  });

  const actionsQuery = useQuery({
    queryKey: ['fraud', 'actions', actionsPage],
    queryFn: () => apiGet<Paginated<FraudAction>>('/fraud/actions', { page: actionsPage, pageSize: PAGE_SIZE }),
  });

  // KPIs (écran 9) : pas d'endpoint d'agrégat dédié (voir rapport de
  // livraison) — un second appel pleine page sert uniquement au décompte
  // (gravité élevée, compagnies concernées), jamais affiché tel quel comme
  // liste (la liste affichée reste la page courante, paginée serveur).
  const casesAllQuery = useQuery({
    queryKey: ['fraud', 'cases', 'all'],
    // SEC-13 : pages successives de 100 (plafond `FETCH_ALL_MAX_ITEMS`).
    queryFn: () => fetchAllPages<FraudCase>('/fraud/cases'),
  });

  const primaryCompany = selectedCase?.companiesInvolved[0];
  const signalsQuery = useQuery({
    queryKey: ['fraud', 'adherents', primaryCompany, 'signals'],
    queryFn: () => apiGet<FraudSignalGroupResult[]>(`/fraud/adherents/${encodeURIComponent(primaryCompany!)}/signals`),
    enabled: !!primaryCompany,
  });

  // Tri d'affichage par gravité ("file priorisée par gravité", écran 9) — la
  // gravité elle-même est renvoyée par l'API, on ne fait que l'ordonner ici.
  const casePage = useMemo(
    () => [...(casesQuery.data?.items ?? [])].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
    [casesQuery.data],
  );
  const actionPage = actionsQuery.data?.items ?? [];

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

  const caseColumns: Column<FraudCase>[] = [
    { key: 'id', header: t('fraude.col.declaration'), render: (r) => <span className="mono">{r.id}</span> },
    { key: 'adherent', header: t('fraude.col.adherent'), render: (r) => <CoChip code={r.companiesInvolved[0] ?? '—'} /> },
    { key: 'score', header: t('fraude.col.score'), render: (r) => <ScoreBar score={r.score} /> },
    { key: 'severity', header: t('fraude.col.severity'), render: (r) => <Tag tone={SEVERITY_TONE[r.severity]}>{t(SEVERITY_LABEL[r.severity])}</Tag> },
    { key: 'plate', header: t('fraude.col.plate'), render: (r) => <span className="mono">{r.plateA ?? '—'}</span> },
  ];

  // "Réf." dérivée de `claimId` (TRANSMISSION_TARDIVE) sinon `matchId`
  // (APPARIEMENT_MANUEL/DELIAGE/RELIAGE) sinon l'id de l'action elle-même —
  // jamais une valeur fabriquée (voir `FraudActionViewDto`, back). La colonne
  // "Poids" de la capture de référence est volontairement omise : aucun champ
  // back ne porte de pondération par action (voir HANDOFF.md).
  const actionColumns: Column<FraudAction>[] = [
    { key: 'ref', header: t('fraude.action.col.ref'), render: (r) => <span className="mono">{r.claimId ?? r.matchId ?? r.id}</span> },
    { key: 'type', header: t('fraude.action.col.type'), render: (r) => <Tag tone="a">{t(ACTION_LABEL[r.type])}</Tag> },
    { key: 'actor', header: t('fraude.action.col.actor'), render: (r) => <span className="mono">{r.actor}</span> },
    { key: 'at', header: t('fraude.action.col.at'), render: (r) => new Date(r.at).toLocaleString(locale) },
  ];

  return (
    <>
      <FolioHeader badge="Module G · §6.9" title={t('fraude.title')} subtitle={t('fraude.subtitle')} />

      <KpiRow>
        <Kpi value={kpis.cases} label={t('fraude.kpi.cases')} />
        <Kpi value={kpis.severe} label={t('fraude.kpi.severe')} />
        <Kpi value={kpis.actions} label={t('fraude.kpi.actions')} />
        <Kpi value={kpis.companies} label={t('fraude.kpi.companies')} />
      </KpiRow>
      <TruncationNote truncated={casesAllQuery.data?.truncated} shown={casesAllQuery.data?.items.length ?? 0} total={casesAllQuery.data?.total ?? 0} />

      <div className="grid g-side" style={{ marginTop: 'var(--s-5)' }}>
        <div className="sheet">
          <div className="sheet-head">
            <span>{t('fraude.panel.queueTitle')}</span>
          </div>
          <div className="sheet-body">
            {casesQuery.isLoading ? (
              <p>{t('common.loading')}</p>
            ) : casesQuery.error ? (
              <div className="note ko" role="alert">
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
                onPageChange={setCasesPage}
                onRowClick={setSelectedCase}
                getRowKey={(r) => r.id}
              />
            )}
          </div>
        </div>

        <aside className="sheet" aria-label={t('fraude.panel.title')}>
          <div className="sheet-head">
            <span>{selectedCase ? `${t('fraude.col.id')} ${selectedCase.id}` : t('fraude.panel.title')}</span>
          </div>
          <div className="sheet-body">
            {!selectedCase ? (
              <p style={{ color: 'var(--ink-3)' }}>{t('fraude.panel.empty')}</p>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--s-4)', flexWrap: 'wrap' }}>
                  <CoChip code={primaryCompany ?? '—'} />
                  <span className="mono" style={{ fontSize: 'var(--k-fs-s)' }}>
                    {selectedCase.plateA ?? '—'}
                  </span>
                  <Tag tone={SEVERITY_TONE[selectedCase.severity]}>
                    {t(SEVERITY_LABEL[selectedCase.severity])} · {selectedCase.score}/100
                  </Tag>
                </div>

                {signalsQuery.isLoading ? (
                  <p>{t('common.loading')}</p>
                ) : signalsQuery.error ? (
                  <p className="note ko">{t('fraude.panel.signalsError')}</p>
                ) : (signalsQuery.data ?? []).length === 0 ? (
                  <p style={{ color: 'var(--ink-3)' }}>{t('fraude.panel.empty')}</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-4)', marginBottom: 'var(--s-4)' }}>
                    {(signalsQuery.data ?? []).map((group) => {
                      const dominant = group.cases[0];
                      return (
                        <div key={group.group} style={{ borderBottom: '1px solid var(--rule)', paddingBottom: 'var(--s-3)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                            <strong style={{ fontSize: 'var(--k-fs-s)' }}>{t(SIGNAL_GROUP_LABEL[group.group])}</strong>
                            {group.count > 1 ? <Tag tone="a">+{group.count - 1}</Tag> : null}
                          </div>
                          {dominant ? (
                            <p style={{ margin: 0, fontSize: 'var(--k-fs-s)', color: 'var(--ink-2)' }}>{describeDominantCase(dominant, locale)}</p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}

                <Link
                  href="/matching"
                  style={{
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
                  }}
                >
                  {t('fraude.panel.matchingLink')}
                </Link>
              </>
            )}
          </div>
        </aside>
      </div>

      <div className="sheet" style={{ marginTop: 'var(--s-5)' }}>
        <div className="sheet-head">
          <span>
            {t('fraude.actions.title')} ({actionsQuery.data?.total ?? 0})
          </span>
        </div>
        <div className="sheet-body">
          {actionsQuery.isLoading ? (
            <p>{t('common.loading')}</p>
          ) : actionsQuery.error ? (
            <div className="note ko" role="alert">
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
    </>
  );
}
