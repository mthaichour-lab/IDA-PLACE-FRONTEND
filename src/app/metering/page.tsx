'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { FolioHeader } from '@/components/FolioHeader';
import { CompanyPeriodPicker } from '@/components/metering/CompanyPeriodPicker';
import { PriceGridEditor } from '@/components/metering/PriceGridEditor';
import { BarChart } from '@/components/ui/BarChart';
import { Table, Column } from '@/components/ui/Table';
import { Tag } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { apiGet, apiPut } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { buildRecentPeriods } from '@/lib/period-options';
import { useRealtime } from '@/lib/realtime';
import { CompanyView, InvoiceLine, MeteringInvoice, Paginated, PriceGrid } from '@/lib/types';

const PAGE_SIZE = 7; // pagination fixe 7/p — A.5
const POLL_INTERVAL_MS = 20_000; // repli polling (B.12) — voir /cockpit
const PERIODS = buildRecentPeriods(12);

function formatDzd(amount: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'DZD', maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount.toLocaleString()} DA`;
  }
}

export default function MeteringPage() {
  const { t, locale } = useI18n();
  const { hasPrivilege } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [company, setCompany] = useState('CAAT');
  const [period, setPeriod] = useState(PERIODS[0]);
  const [invoicePage, setInvoicePage] = useState(1);

  const canEditGrid = hasPrivilege('grid');

  const companiesQuery = useQuery({
    queryKey: ['referential', 'companies', 'all'],
    queryFn: () => apiGet<Paginated<CompanyView>>('/referential/companies', { page: 1, pageSize: 50 }),
  });

  const invoiceQuery = useQuery({
    queryKey: ['metering', 'invoice', company, period],
    queryFn: () => apiGet<MeteringInvoice>(`/metering/${company}/${period}`),
    enabled: !!company && !!period,
    refetchInterval: POLL_INTERVAL_MS,
  });

  const gridQuery = useQuery({
    queryKey: ['pricing', 'grid'],
    queryFn: () => apiGet<PriceGrid>('/pricing/grid'),
  });

  const onRealtimeEvent = useCallback(() => {
    void invoiceQuery.refetch();
  }, [invoiceQuery]);
  useRealtime(['metering.tick'], onRealtimeEvent);

  const saveGridMutation = useMutation({
    mutationFn: (next: PriceGrid) => apiPut<PriceGrid>('/pricing/grid', next),
    onSuccess: (next) => {
      queryClient.setQueryData(['pricing', 'grid'], next);
      toast(t('metering.toast.gridSaved'), 'ok');
    },
    onError: () => {
      toast(t('metering.toast.gridError'), 'ko');
    },
  });

  const companies = companiesQuery.data?.items ?? [];
  const invoice = invoiceQuery.data;

  const invoiceColumns: Column<InvoiceLine>[] = useMemo(
    () => [
      { key: 'label', header: t('metering.invoice.col.metric'), render: (r) => r.label },
      { key: 'measured', header: t('metering.invoice.col.measured'), render: (r) => <span className="mono">{r.measured.toLocaleString(locale)}</span> },
      { key: 'quota', header: t('metering.invoice.col.quota'), render: (r) => <span className="mono">{r.includedQuota.toLocaleString(locale)}</span> },
      {
        key: 'facturable',
        header: t('metering.invoice.col.facturable'),
        render: (r) => <Tag tone={r.facturable > 0 ? 'warn' : 'ok'}>{r.facturable.toLocaleString(locale)}</Tag>,
      },
      { key: 'amount', header: t('metering.invoice.col.amount'), render: (r) => <span className="mono">{formatDzd(r.amount, locale)}</span> },
    ],
    [t, locale],
  );

  const invoicePageRows = invoice ? invoice.lines.slice((invoicePage - 1) * PAGE_SIZE, invoicePage * PAGE_SIZE) : [];

  return (
    <>
      <FolioHeader
        badge="Module G · §6.9 / B.8"
        title={t('metering.title')}
        subtitle={t('metering.subtitle')}
        actions={
          <CompanyPeriodPicker
            companies={companies}
            company={company}
            onCompanyChange={setCompany}
            period={period}
            onPeriodChange={setPeriod}
            periods={PERIODS}
          />
        }
      />

      {invoiceQuery.isLoading ? (
        <p>{t('common.loading')}</p>
      ) : invoiceQuery.error || !invoice ? (
        <div className="note ko" role="alert">
          <span>{t('common.error')}</span>
          <button type="button" onClick={() => invoiceQuery.refetch()}>
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <>
          <div className="sheet" style={{ marginBottom: 'var(--s-5)' }}>
            <div className="sheet-head">
              <span>{t('metering.tiles.title')}</span>
            </div>
            <div className="sheet-body">
              <div className="kpi-row">
                {invoice.lines.map((l) => (
                  <div key={l.metric} className="kpi">
                    <div className="kpi-value" style={{ fontSize: 'var(--k-fs-xl)' }}>
                      {l.measured.toLocaleString(locale)}
                    </div>
                    <div className="kpi-label">{l.label}</div>
                    <div className="kpi-extra">
                      {t('metering.tile.quota')} {l.includedQuota.toLocaleString(locale)}
                      {l.facturable > 0 ? (
                        <>
                          {' · '}
                          <span style={{ color: 'var(--warn)' }}>
                            {t('metering.tile.over')} {l.facturable.toLocaleString(locale)}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="sheet" style={{ marginBottom: 'var(--s-5)' }}>
            <div className="sheet-head">
              <span>{t('metering.chart.title')}</span>
            </div>
            <div className="sheet-body">
              <BarChart data={invoice.lines.map((l) => ({ label: l.label, value: l.amount }))} />
            </div>
          </div>

          <div className="sheet" style={{ marginBottom: 'var(--s-5)' }}>
            <div className="sheet-head">
              <span>
                {t('metering.invoice.title')} · {invoice.period}
              </span>
              <Tag tone="a">{invoice.status}</Tag>
            </div>
            <div className="sheet-body">
              <p style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)', marginTop: 0 }}>
                {t('metering.invoice.subscription')}: {invoice.subscription.label} — {formatDzd(invoice.subscription.monthly, locale)}
              </p>
              <Table
                columns={invoiceColumns}
                rows={invoicePageRows}
                page={invoicePage}
                total={invoice.lines.length}
                pageSize={PAGE_SIZE}
                onPageChange={setInvoicePage}
                getRowKey={(r) => r.metric}
              />
              <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--s-3)', marginTop: 'var(--s-4)' }}>
                <Field label={t('metering.invoice.totalHT')}>{formatDzd(invoice.totalHT, locale)}</Field>
                <Field label={t('metering.invoice.totalTVA')}>{formatDzd(invoice.totalTVA, locale)}</Field>
                <Field label={t('metering.invoice.totalTTC')}>
                  <strong>{formatDzd(invoice.totalTTC, locale)}</strong>
                </Field>
              </dl>
            </div>
          </div>

          <div className="sheet" style={{ marginBottom: 'var(--s-5)' }}>
            <div className="sheet-head">
              <span>{t('metering.payments.title')}</span>
            </div>
            <div className="sheet-body">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--s-2)' }}>
                <span>{t('metering.invoice.status')}:</span>
                <Tag tone={invoice.status === 'PAYEE' ? 'ok' : invoice.status === 'EN_RETARD' ? 'ko' : 'warn'}>{invoice.status}</Tag>
              </div>
              <p style={{ color: 'var(--ink-3)', fontSize: 'var(--k-fs-xs)' }}>{t('metering.payments.empty')}</p>
            </div>
          </div>
        </>
      )}

      {gridQuery.data ? (
        <PriceGridEditor grid={gridQuery.data} canEdit={canEditGrid} onSave={(next) => saveGridMutation.mutateAsync(next)} saving={saveGridMutation.isPending} />
      ) : gridQuery.isLoading ? (
        <p>{t('common.loading')}</p>
      ) : (
        <div className="note ko" role="alert">
          <span>{t('common.error')}</span>
          <button type="button" onClick={() => gridQuery.refetch()}>
            {t('common.retry')}
          </button>
        </div>
      )}
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
