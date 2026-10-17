'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FolioHeader } from '@/components/FolioHeader';
import { CoChip } from '@/components/ui/CoChip';
import { Column, Table } from '@/components/ui/Table';
import { Tag } from '@/components/ui/Tag';
import { Kpi, KpiRow } from '@/components/ui/Kpi';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { apiGet } from '@/lib/api-client';
import { MonthlyCompanySynthesis, MonthlySettlement } from '@/lib/types';

const PAGE_SIZE = 6; // pagination fixe 6/p — A.5

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function formatDzd(amount: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'DZD', maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount.toLocaleString()} DA`;
  }
}

/** Export CSV client (placeholder documenté — voir rapport de livraison : pas d'endpoint back de génération de bordereau pour le cycle mensuel). */
function buildMonthlyCsv(data: MonthlySettlement): string {
  const header = 'period;code;claimsCount;totalAmount;status';
  const lines = data.companies.map((c) => [data.period, c.code, c.claimsCount, c.totalAmount, c.status].join(';'));
  return [header, ...lines].join('\n');
}

function downloadText(fileName: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function MonthlyPage() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const [period, setPeriod] = useState(currentPeriod());
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ['settlement', 'monthly', period],
    queryFn: () => apiGet<MonthlySettlement>(`/settlement/monthly/${period}`),
    enabled: /^\d{4}-\d{2}$/.test(period),
  });

  const data = query.data;
  const companies = data?.companies ?? [];
  const closedCount = companies.filter((c) => c.status === 'CLOTURE').length;
  const totalAmount = companies.reduce((sum, c) => sum + c.totalAmount, 0);

  const pageRows = useMemo(() => companies.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [companies, page]);

  const columns: Column<MonthlyCompanySynthesis>[] = [
    {
      key: 'code',
      header: t('monthly.col.company'),
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <CoChip code={r.code} />
        </span>
      ),
    },
    { key: 'claimsCount', header: t('monthly.col.claims'), render: (r) => <span className="mono">{r.claimsCount}</span> },
    { key: 'totalAmount', header: t('monthly.col.amount'), render: (r) => <span className="mono">{formatDzd(r.totalAmount, locale)}</span> },
    {
      key: 'status',
      header: t('monthly.col.status'),
      render: (r) => <Tag tone={r.status === 'CLOTURE' ? 'ok' : 'warn'}>{t(`monthly.status.${r.status}`)}</Tag>,
    },
  ];

  function onGenerate() {
    if (!data) return;
    downloadText(`bordereau-mensuel-${data.period}.csv`, buildMonthlyCsv(data));
    toast(t('monthly.generate.success'), 'ok');
  }

  return (
    <>
      <FolioHeader
        badge="Module C · §6.5"
        title={t('monthly.title')}
        subtitle={t('monthly.subtitle')}
        actions={
          <button
            type="button"
            onClick={onGenerate}
            disabled={!data}
            style={{
              padding: '8px 16px',
              borderRadius: 'var(--k-r-s)',
              border: '1px solid var(--k-pri)',
              background: 'var(--k-pri)',
              color: '#fff',
              font: 'inherit',
              cursor: data ? 'pointer' : 'not-allowed',
            }}
          >
            {t('monthly.generate.button')}
          </button>
        }
      />

      <div className="sheet" style={{ marginBottom: 'var(--s-5)' }}>
        <div className="sheet-body" style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)', flexWrap: 'wrap' }}>
          <label htmlFor="monthly-period" style={{ fontSize: 'var(--k-fs-s)', color: 'var(--ink-2)' }}>
            {t('monthly.period.label')}
          </label>
          <input
            id="monthly-period"
            type="month"
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value);
              setPage(1);
            }}
            style={{ padding: '6px 10px', border: '1px solid var(--rule-strong)', borderRadius: 'var(--k-r-s)', font: 'inherit', background: 'var(--paper)', color: 'var(--ink)' }}
          />
        </div>
      </div>

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
          <KpiRow>
            <Kpi value={companies.length} label={t('monthly.kpi.companies')} />
            <Kpi value={closedCount} label={t('monthly.kpi.closed')} />
            <Kpi value={formatDzd(totalAmount, locale)} label={t('monthly.kpi.total')} />
          </KpiRow>

          <div className="sheet" style={{ marginTop: 'var(--s-5)' }}>
            <div className="sheet-head">
              <span>{t('monthly.table.title')}</span>
            </div>
            <div className="sheet-body">
              <Table columns={columns} rows={pageRows} page={page} total={companies.length} pageSize={PAGE_SIZE} onPageChange={setPage} getRowKey={(r) => r.code} />
            </div>
          </div>

          <p style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)', marginTop: 'var(--s-3)' }}>{t('monthly.generate.note')}</p>
        </>
      )}
    </>
  );
}
