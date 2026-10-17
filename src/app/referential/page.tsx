'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { FolioHeader } from '@/components/FolioHeader';
import { CoChip } from '@/components/ui/CoChip';
import { Modal } from '@/components/ui/Modal';
import { Tabs } from '@/components/ui/Tabs';
import { Tag, TagTone } from '@/components/ui/Tag';
import { Table, Column } from '@/components/ui/Table';
import { useI18n } from '@/i18n/provider';
import { apiGet } from '@/lib/api-client';
import { AgencyView, CompanyView, ExpertView, Paginated } from '@/lib/types';

const PAGE_SIZE = 7; // pagination fixe 7/p — A.5

type TabKey = 'companies' | 'agencies' | 'experts';

function statusTone(status: string): TagTone {
  if (status === 'ACTIF') return 'ok';
  if (status === 'SUSPENDU' || status === 'EN_RETRAIT') return 'warn';
  return 'ko';
}

/**
 * Écran de référence RÉEL — Module X "Référentiel de place" (écran 12).
 * Branché sur l'API réelle du back-end (`GET /referential/companies|
 * agencies|experts`) via TanStack Query. Les autres écrans (A.4) restent
 * "en construction" pour ce sprint (voir HANDOFF.md).
 */
export default function ReferentialPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<TabKey>('companies');
  const [page, setPage] = useState(1);
  const [selectedCompany, setSelectedCompany] = useState<CompanyView | null>(null);

  const companiesQuery = useQuery({
    queryKey: ['referential', 'companies', page],
    queryFn: () => apiGet<Paginated<CompanyView>>('/referential/companies', { page, pageSize: PAGE_SIZE }),
    enabled: tab === 'companies',
  });

  const agenciesQuery = useQuery({
    queryKey: ['referential', 'agencies', page],
    queryFn: () => apiGet<Paginated<AgencyView>>('/referential/agencies', { page, pageSize: PAGE_SIZE }),
    enabled: tab === 'agencies',
  });

  const expertsQuery = useQuery({
    queryKey: ['referential', 'experts', page],
    queryFn: () => apiGet<Paginated<ExpertView>>('/referential/experts', { page, pageSize: PAGE_SIZE }),
    enabled: tab === 'experts',
  });

  const companyColumns: Column<CompanyView>[] = [
    { key: 'code', header: t('referential.company.code'), render: (r) => <CoChip code={r.code} color={r.color} /> },
    { key: 'name', header: t('referential.company.identity'), render: (r) => r.name },
    { key: 'feedMode', header: t('referential.company.feedMode'), render: (r) => r.feedMode },
    { key: 'status', header: t('referential.company.status'), render: (r) => <Tag tone={statusTone(r.status)}>{r.status}</Tag> },
  ];

  const agencyColumns: Column<AgencyView>[] = [
    { key: 'code', header: 'Code', render: (r) => r.code },
    { key: 'name', header: 'Nom', render: (r) => r.name },
    { key: 'type', header: 'Type', render: (r) => r.type },
    { key: 'wilaya', header: 'Wilaya', render: (r) => r.wilayaCode ?? '—' },
    { key: 'status', header: t('referential.company.status'), render: (r) => <Tag tone={statusTone(r.status)}>{r.status}</Tag> },
  ];

  const expertColumns: Column<ExpertView>[] = [
    { key: 'name', header: 'Nom', render: (r) => r.name },
    { key: 'firm', header: 'Cabinet', render: (r) => r.firm ?? '—' },
    { key: 'wilayas', header: 'Wilayas', render: (r) => r.wilayas.join(', ') },
    { key: 'status', header: t('referential.company.status'), render: (r) => <Tag tone={statusTone(r.status)}>{r.status}</Tag> },
  ];

  function changeTab(next: string) {
    setTab(next as TabKey);
    setPage(1);
  }

  return (
    <>
      <FolioHeader badge="Module X" title={t('referential.title')} subtitle={t('referential.subtitle')} />

      <div className="sheet">
        <div className="sheet-body">
          <Tabs
            items={[
              { key: 'companies', label: t('referential.tab.companies'), count: companiesQuery.data?.total },
              { key: 'agencies', label: t('referential.tab.agencies'), count: agenciesQuery.data?.total },
              { key: 'experts', label: t('referential.tab.experts'), count: expertsQuery.data?.total },
            ]}
            activeKey={tab}
            onChange={changeTab}
          />

          {tab === 'companies' && (
            <QueryState query={companiesQuery}>
              {(data) => (
                <Table
                  columns={companyColumns}
                  rows={data.items}
                  page={data.page}
                  total={data.total}
                  pageSize={PAGE_SIZE}
                  onPageChange={setPage}
                  onRowClick={setSelectedCompany}
                  getRowKey={(r) => r.id}
                />
              )}
            </QueryState>
          )}

          {tab === 'agencies' && (
            <QueryState query={agenciesQuery}>
              {(data) => (
                <Table
                  columns={agencyColumns}
                  rows={data.items}
                  page={data.page}
                  total={data.total}
                  pageSize={PAGE_SIZE}
                  onPageChange={setPage}
                  getRowKey={(r) => r.id}
                />
              )}
            </QueryState>
          )}

          {tab === 'experts' && (
            <QueryState query={expertsQuery}>
              {(data) => (
                <Table
                  columns={expertColumns}
                  rows={data.items}
                  page={data.page}
                  total={data.total}
                  pageSize={PAGE_SIZE}
                  onPageChange={setPage}
                  getRowKey={(r) => r.id}
                />
              )}
            </QueryState>
          )}
        </div>
      </div>

      <Modal open={!!selectedCompany} title={selectedCompany?.name ?? ''} onClose={() => setSelectedCompany(null)}>
        {selectedCompany ? (
          <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label={t('referential.company.code')}>
              <CoChip code={selectedCompany.code} color={selectedCompany.color} />
            </Field>
            <Field label={t('referential.company.status')}>
              <Tag tone={statusTone(selectedCompany.status)}>{selectedCompany.status}</Tag>
            </Field>
            <Field label={t('referential.company.color')}>
              <span className="mono">{selectedCompany.color}</span>
            </Field>
            <Field label={t('referential.company.feedMode')}>{selectedCompany.feedMode}</Field>
            <Field label={t('referential.company.apiKey')}>
              <span className="mono">{selectedCompany.apiKeyMasked}</span>
            </Field>
          </dl>
        ) : null}
      </Modal>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)' }}>{label}</dt>
      <dd style={{ margin: 0 }}>{children}</dd>
    </div>
  );
}

function QueryState<T>({
  query,
  children,
}: {
  query: { data?: T; isLoading: boolean; error: unknown; refetch: () => void };
  children: (data: T) => React.ReactNode;
}) {
  const { t } = useI18n();
  if (query.isLoading) return <p>{t('common.loading')}</p>;
  if (query.error) {
    return (
      <div className="note ko">
        <span>{t('common.error')}</span>
        <button type="button" onClick={() => query.refetch()}>
          {t('common.retry')}
        </button>
      </div>
    );
  }
  if (!query.data) return null;
  return <>{children(query.data)}</>;
}
