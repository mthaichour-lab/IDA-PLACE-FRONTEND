'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { FolioHeader } from '@/components/FolioHeader';
import { CoChip } from '@/components/ui/CoChip';
import { Table, Column } from '@/components/ui/Table';
import { Tag } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { TranslationKey } from '@/i18n/translations';
import { apiGet, apiPost } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { SettlementMonthly, SettlementMonthlyCompany } from '@/lib/types';

const PAGE_SIZE = 7; // pagination fixe 7/p — A.5

function formatDzd(amount: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'DZD', maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount.toLocaleString()} DA`;
  }
}

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default function MonthlyPage() {
  const { t, locale } = useI18n();
  const { hasPrivilege } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [period, setPeriod] = useState(currentPeriod);
  const [page, setPage] = useState(1);

  const canGenerate = hasPrivilege('synth');

  const monthlyQuery = useQuery({
    queryKey: ['settlement', 'monthly', period],
    queryFn: () => apiGet<SettlementMonthly>(`/settlement/monthly/${period}`),
  });

  // Clôture par compagnie — forme réelle : `POST /settlement/monthly/:period/close`
  // avec `{company}` (idempotent, 409 si déjà clôturée), pas un bordereau
  // global pour toute la place.
  const closeMutation = useMutation({
    mutationFn: (company: string) => apiPost(`/settlement/monthly/${period}/close`, { company }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settlement', 'monthly', period] });
      toast(t('monthly.toast.generated'), 'ok');
    },
    onError: () => toast(t('monthly.toast.error'), 'ko'),
  });

  const companies = monthlyQuery.data?.companies ?? [];
  const pageRows = companies.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const columns: Column<SettlementMonthlyCompany>[] = useMemo(
    () => [
      {
        key: 'company',
        header: t('monthly.col.company'),
        render: (r) => (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <CoChip code={r.code} /> <span className="mono">{r.code}</span>
          </span>
        ),
      },
      { key: 'claimsCount', header: t('monthly.col.claimsCount'), render: (r) => <span className="mono">{r.claimsCount}</span> },
      { key: 'totalAmount', header: t('monthly.col.totalAmount'), render: (r) => <span className="mono">{formatDzd(r.totalAmount, locale)}</span> },
      {
        key: 'status',
        header: t('monthly.col.status'),
        render: (r) => <Tag tone={r.status === 'CLOTURE' ? 'ok' : 'warn'}>{t(`monthly.status.${r.status}` as TranslationKey)}</Tag>,
      },
      {
        key: 'action',
        header: '',
        render: (r) =>
          r.status === 'CLOTURE' ? (
            <span className="mono" style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)' }}>
              {r.bordereauRef}
            </span>
          ) : (
            <button
              type="button"
              className="tag ok"
              style={{ border: 'none', cursor: canGenerate ? 'pointer' : 'not-allowed' }}
              disabled={!canGenerate || closeMutation.isPending}
              onClick={() => closeMutation.mutate(r.code)}
              title={!canGenerate ? t('common.forbidden') : undefined}
            >
              {t('monthly.action.generateBordereau')}
            </button>
          ),
      },
    ],
    [t, locale, canGenerate, closeMutation],
  );

  return (
    <>
      <FolioHeader badge="Module C · §6.5" title={t('monthly.title')} subtitle={t('monthly.subtitle')} />

      <div className="sheet" style={{ marginBottom: 'var(--s-5)' }}>
        <div className="sheet-body">
          <label htmlFor="monthly-period" style={{ display: 'block', fontSize: 'var(--k-fs-s)', color: 'var(--ink-2)', marginBottom: 4 }}>
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

          {!canGenerate ? <p className="note warn" style={{ marginTop: 'var(--s-3)' }}>{t('common.forbidden')}</p> : null}
        </div>
      </div>

      <div className="sheet">
        <div className="sheet-body">
          {monthlyQuery.isLoading ? (
            <p>{t('common.loading')}</p>
          ) : monthlyQuery.error ? (
            <div className="note ko" role="alert">
              <span>{t('common.error')}</span>
              <button type="button" onClick={() => monthlyQuery.refetch()}>
                {t('common.retry')}
              </button>
            </div>
          ) : (
            <Table columns={columns} rows={pageRows} page={page} total={companies.length} pageSize={PAGE_SIZE} onPageChange={setPage} getRowKey={(r) => r.code} />
          )}
        </div>
      </div>
    </>
  );
}
