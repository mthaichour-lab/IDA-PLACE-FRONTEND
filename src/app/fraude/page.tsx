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
import { FraudAction, FraudCase, FraudSeverity } from '@/lib/types';

const PAGE_SIZE = 6; // pagination fixe 6/p — A.5

/**
 * Les 5 étapes de détection (B.9) — liste fixe de libellés d'écran, utilisée
 * uniquement pour regrouper l'affichage des signaux déjà renvoyés par
 * `GET /fraud/cases` (`signals: string[]`) ; aucune détection n'est faite
 * côté front (règle d'or C.1).
 */
const SIGNAL_STEPS = ['Doublons & e-constat', 'Réseau/récurrence', 'Montants & plafond', 'Incohérences A/B', 'Vélocité'];

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
    queryKey: ['fraud', 'cases'],
    queryFn: () => apiGet<FraudCase[]>('/fraud/cases'),
  });

  const actionsQuery = useQuery({
    queryKey: ['fraud', 'actions'],
    queryFn: () => apiGet<FraudAction[]>('/fraud/actions'),
  });

  // Tri d'affichage par gravité ("file priorisée par gravité", écran 9) — la
  // gravité elle-même est renvoyée par l'API, on ne fait que l'ordonner ici.
  const sortedCases = useMemo(
    () => [...(casesQuery.data ?? [])].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
    [casesQuery.data],
  );
  const casePage = sortedCases.slice((casesPage - 1) * PAGE_SIZE, casesPage * PAGE_SIZE);

  const actions = actionsQuery.data ?? [];
  const actionPage = actions.slice((actionsPage - 1) * PAGE_SIZE, actionsPage * PAGE_SIZE);

  // KPIs (écran 9) : comptages d'affichage dérivés des listes renvoyées par
  // l'API — pas de scoring/verdict, juste des dénombrements (aucun endpoint
  // d'agrégat dédié n'est encore exposé par le back, voir rapport final).
  const kpis = useMemo(() => {
    const companies = new Set<string>();
    for (const c of casesQuery.data ?? []) for (const co of c.companiesInvolved) companies.add(co);
    return {
      cases: casesQuery.data?.length ?? 0,
      severe: (casesQuery.data ?? []).filter((c) => c.severity === 'ELEVEE').length,
      actions: actionsQuery.data?.length ?? 0,
      companies: companies.size,
    };
  }, [casesQuery.data, actionsQuery.data]);

  const caseColumns: Column<FraudCase>[] = [
    { key: 'id', header: t('fraude.col.id'), render: (r) => <span className="mono">{r.id}</span> },
    { key: 'severity', header: t('fraude.col.severity'), render: (r) => <Tag tone={SEVERITY_TONE[r.severity]}>{t(SEVERITY_LABEL[r.severity])}</Tag> },
    { key: 'signals', header: t('fraude.col.signals'), render: (r) => <span>{r.signals.length}</span> },
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
              total={sortedCases.length}
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
              total={actions.length}
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

            <strong style={{ display: 'block', margin: '0 0 var(--s-2)', fontSize: 'var(--k-fs-s)' }}>{t('fraude.panel.companies')}</strong>
            <div style={{ display: 'flex', gap: 6, marginBottom: 'var(--s-4)' }}>
              {selectedCase.companiesInvolved.map((c) => (
                <CoChip key={c} code={c} />
              ))}
            </div>

            <strong style={{ display: 'block', margin: '0 0 var(--s-2)', fontSize: 'var(--k-fs-s)' }}>{t('fraude.panel.signals')}</strong>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {SIGNAL_STEPS.map((step) => {
                const present = selectedCase.signals.includes(step);
                return (
                  <li key={step} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 'var(--k-fs-s)' }}>
                    <span>{step}</span>
                    <Tag tone={present ? 'ko' : 'a'}>{present ? t('fraude.signal.present') : t('fraude.signal.absent')}</Tag>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
      </Modal>
    </>
  );
}
