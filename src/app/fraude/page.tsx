'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { FolioHeader } from '@/components/FolioHeader';
import { CoChip } from '@/components/ui/CoChip';
import { Kpi, KpiRow } from '@/components/ui/Kpi';
import { Modal } from '@/components/ui/Modal';
import { Table, Column } from '@/components/ui/Table';
import { Tag, TagTone } from '@/components/ui/Tag';
import { useI18n } from '@/i18n/provider';
import { TranslationKey } from '@/i18n/translations';
import { apiGet } from '@/lib/api-client';
import { FraudAction, FraudCase, FraudSeverity, Paginated } from '@/lib/types';

const PAGE_SIZE = 7; // pagination fixe 7/p — A.5

const CASE_TYPE_LABEL: Record<FraudCase['type'], TranslationKey> = {
  DOUBLON: 'fraude.type.DOUBLON',
  ECONSTAT_REUTILISE: 'fraude.type.ECONSTAT_REUTILISE',
  RECURRENCE_VEHICULE: 'fraude.type.RECURRENCE_VEHICULE',
  MONTANT_CALIBRE: 'fraude.type.MONTANT_CALIBRE',
  INCOHERENCE_AB: 'fraude.type.INCOHERENCE_AB',
};

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
    queryFn: () => apiGet<Paginated<FraudCase>>('/fraud/cases', { page: 1, pageSize: 10_000 }),
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
    { key: 'id', header: t('fraude.col.id'), render: (r) => <span className="mono">{r.id}</span> },
    { key: 'severity', header: t('fraude.col.severity'), render: (r) => <Tag tone={SEVERITY_TONE[r.severity]}>{t(SEVERITY_LABEL[r.severity])}</Tag> },
    { key: 'type', header: t('fraude.col.type'), render: (r) => <Tag tone="a">{t(CASE_TYPE_LABEL[r.type])}</Tag> },
    { key: 'score', header: t('fraude.col.score'), render: (r) => <span className="mono">{r.score}</span> },
    {
      key: 'companies',
      header: t('fraude.col.companies'),
      render: (r) => (
        <span style={{ display: 'inline-flex', gap: 4 }}>
          {r.companiesInvolved.map((c) => (
            <CoChip key={c} code={c} />
          ))}
        </span>
      ),
    },
    { key: 'detectedAt', header: t('fraude.col.detectedAt'), render: (r) => new Date(r.detectedAt).toLocaleDateString(locale) },
  ];

  const actionColumns: Column<FraudAction>[] = [
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

      <div className="sheet" style={{ marginTop: 'var(--s-5)' }}>
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

      <div className="sheet" style={{ marginTop: 'var(--s-5)' }}>
        <div className="sheet-head">
          <span>{t('fraude.actions.title')}</span>
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

      <Modal open={!!selectedCase} title={`${t('fraude.panel.title')} — ${selectedCase?.id ?? ''}`} onClose={() => setSelectedCase(null)}>
        {selectedCase ? (
          <>
            <p style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)', marginTop: 0 }}>
              {t('fraude.panel.detectedAt')} {new Date(selectedCase.detectedAt).toLocaleString(locale)}
            </p>

            <div style={{ display: 'flex', gap: 6, marginBottom: 'var(--s-4)', alignItems: 'center' }}>
              <Tag tone={SEVERITY_TONE[selectedCase.severity]}>{t(SEVERITY_LABEL[selectedCase.severity])}</Tag>
              <Tag tone="a">{t(CASE_TYPE_LABEL[selectedCase.type])}</Tag>
              <span className="mono" style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)' }}>
                score {selectedCase.score}
              </span>
            </div>

            <strong style={{ display: 'block', margin: '0 0 var(--s-2)', fontSize: 'var(--k-fs-s)' }}>{t('fraude.panel.companies')}</strong>
            <div style={{ display: 'flex', gap: 6, marginBottom: 'var(--s-4)' }}>
              {selectedCase.companiesInvolved.map((c) => (
                <CoChip key={c} code={c} />
              ))}
            </div>

            <strong style={{ display: 'block', margin: '0 0 var(--s-2)', fontSize: 'var(--k-fs-s)' }}>{t('fraude.panel.claims')}</strong>
            <p className="mono" style={{ marginTop: 0, marginBottom: 'var(--s-4)' }}>
              {selectedCase.claimIds.join(', ')}
            </p>

            <strong style={{ display: 'block', margin: '0 0 var(--s-2)', fontSize: 'var(--k-fs-s)' }}>{t('fraude.panel.details')}</strong>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {Object.entries(selectedCase.details).map(([key, value]) => (
                <li key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 'var(--k-fs-s)' }}>
                  <span>{key}</span>
                  <span className="mono">{String(value)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Modal>
    </>
  );
}
