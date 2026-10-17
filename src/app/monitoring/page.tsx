'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { FolioHeader } from '@/components/FolioHeader';
import { CoChip } from '@/components/ui/CoChip';
import { ScoreBar } from '@/components/ui/ScoreBar';
import { Table, Column } from '@/components/ui/Table';
import { useI18n } from '@/i18n/provider';
import { TranslationKey } from '@/i18n/translations';
import { apiGet } from '@/lib/api-client';
import { MonitoringCompanyScore, MonitoringScores, MonitoringWeights } from '@/lib/types';

const PAGE_SIZE = 6; // pagination fixe 6/p — A.5

/**
 * Libellés des 7 critères du scoring composite (B.2 écran 8) — mapping
 * clé→libellé **d'affichage uniquement** ; les poids et les valeurs par
 * compagnie viennent toujours de `GET /monitoring/scores` (aucun calcul
 * recodé côté front, règle d'or C.1).
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

export default function MonitoringPage() {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['monitoring', 'scores'],
    queryFn: () => apiGet<MonitoringScores>('/monitoring/scores'),
  });

  const companies = query.data?.companies ?? [];
  const selected = companies.find((c) => c.code === selectedCode) ?? companies[0] ?? null;
  const pageRows = companies.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const columns: Column<MonitoringCompanyScore>[] = useMemo(
    () => [
      { key: 'rank', header: t('monitoring.col.rank'), render: (r) => <span className="mono">#{r.rank}</span> },
      { key: 'company', header: t('monitoring.col.company'), render: (r) => <CoChip code={r.code} /> },
      { key: 'score', header: t('monitoring.col.score'), render: (r) => <ScoreBar score={r.score} /> },
    ],
    [t],
  );

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
        <div className="grid g-side">
          <div>
            <div className="sheet" style={{ marginBottom: 'var(--s-5)' }}>
              <div className="sheet-head">
                <span>{t('monitoring.weights.title')}</span>
              </div>
              <div className="sheet-body" style={{ display: 'flex', gap: 'var(--s-4)', flexWrap: 'wrap' }}>
                {WEIGHT_LABELS.map((w) => (
                  <span key={w.key} style={{ fontSize: 'var(--k-fs-s)' }}>
                    {t(w.label)} <strong className="mono">{Math.round(query.data!.weights[w.key] * 100)}%</strong>
                  </span>
                ))}
              </div>
            </div>

            <div className="sheet">
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
          </div>

          <aside className="sheet" aria-label={t('monitoring.panel.title')}>
            <div className="sheet-head">
              <span>{t('monitoring.panel.title')}</span>
            </div>
            <div className="sheet-body">
              {!selected ? (
                <p style={{ color: 'var(--ink-3)' }}>{t('monitoring.panel.empty')}</p>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--s-4)' }}>
                    <CoChip code={selected.code} />
                    <strong>#{selected.rank}</strong>
                    <ScoreBar score={selected.score} />
                  </div>

                  <strong style={{ display: 'block', marginBottom: 'var(--s-2)', fontSize: 'var(--k-fs-s)' }}>
                    {t('monitoring.panel.breakdown')}
                  </strong>
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 'var(--s-5)' }}>
                    {WEIGHT_LABELS.map((w) => (
                      <li key={w.key}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)', marginBottom: 2 }}>
                          <span>
                            {t(w.label)} <span className="mono">({Math.round(query.data!.weights[w.key] * 100)}%)</span>
                          </span>
                        </div>
                        <ScoreBar score={selected.details[w.key]} />
                      </li>
                    ))}
                  </ul>

                  <div className="note warn">
                    <div>
                      <strong style={{ display: 'block', marginBottom: 4 }}>{t('monitoring.panel.journey')}</strong>
                      <p style={{ margin: 0 }}>{t('monitoring.panel.journey.note')}</p>
                    </div>
                  </div>
                  <Link
                    href="/matching"
                    style={{
                      display: 'inline-flex',
                      marginTop: 'var(--s-3)',
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
                    {t('monitoring.panel.matchingLink')}
                  </Link>
                </>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
