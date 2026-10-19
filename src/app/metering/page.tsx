'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { FolioHeader } from '@/components/FolioHeader';
import { CompanyPeriodPicker } from '@/components/metering/CompanyPeriodPicker';
import { ConsumptionHistoryChart } from '@/components/metering/ConsumptionHistoryChart';
import { PriceGridEditor } from '@/components/metering/PriceGridEditor';
import { Table, Column } from '@/components/ui/Table';
import { Tag } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { apiGet, apiPath, apiPut } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { isCompanyRole } from '@/lib/auth/roles';
import { useApiErrorMessage } from '@/lib/error-message';
import { buildRecentPeriods } from '@/lib/period-options';
import { useRealtime } from '@/lib/realtime';
import { CompanyView, InvoiceLine, InvoiceStatus, MeteringHistory, MeteringInvoice, Paginated, PriceGrid } from '@/lib/types';
import { TranslationKey } from '@/i18n/translations';
import { TagTone } from '@/components/ui/Tag';

const PAGE_SIZE = 6; // pagination fixe 6/p — A.5
const POLL_INTERVAL_MS = 20_000; // repli polling (B.12) — voir /cockpit
const PERIODS = buildRecentPeriods(12);

/** SEC-37 : `SIMULEE` (consommation simulée, jamais émise) est affichée comme telle, distincte d'une facture réelle. */
const INVOICE_STATUS_LABEL: Record<InvoiceStatus, TranslationKey> = {
  SIMULEE: 'metering.invoice.status.SIMULEE',
  EMISE: 'metering.invoice.status.EMISE',
  PAYEE: 'metering.invoice.status.PAYEE',
  EN_RETARD: 'metering.invoice.status.EN_RETARD',
};
const INVOICE_STATUS_TONE: Record<InvoiceStatus, TagTone> = { SIMULEE: 'warn', EMISE: 'a', PAYEE: 'ok', EN_RETARD: 'ko' };

function formatDzd(amount: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'DZD', maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount.toLocaleString()} DA`;
  }
}

export default function MeteringPage() {
  const { t, locale } = useI18n();
  const { me, hasPrivilege } = useAuth();
  const { toast } = useToast();
  const errorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();

  // SEC-38 : la compagnie de départ vient de l'identité réelle (`GET /me`,
  // claims du jeton), jamais d'une valeur codée en dur. Rôle compagnie :
  // uniquement SA compagnie ; rôle place : sélection libre, première
  // compagnie du référentiel par défaut.
  const companyRole = isCompanyRole(me?.role);
  const [pickedCompany, setPickedCompany] = useState<string | undefined>(undefined);
  const [period, setPeriod] = useState(PERIODS[0]);
  const [invoicePage, setInvoicePage] = useState(1);
  const [historyMetric, setHistoryMetric] = useState('claimsIngested'); // "Dossiers ingérés" — sélection par défaut du guide illustré (écran 10)

  const canEditGrid = hasPrivilege('grid');

  const companiesQuery = useQuery({
    queryKey: ['referential', 'companies', 'all'],
    queryFn: () => apiGet<Paginated<CompanyView>>('/referential/companies', { page: 1, pageSize: 50 }),
    enabled: !!me,
  });

  const allCompanies = companiesQuery.data?.items ?? [];
  const companies: CompanyView[] = companyRole
    ? allCompanies.filter((c) => c.code === me?.company)
    : allCompanies;
  const company = companyRole ? me?.company ?? '' : pickedCompany ?? allCompanies[0]?.code ?? '';
  const setCompany = (code: string) => {
    if (!companyRole) setPickedCompany(code);
  };

  const invoiceQuery = useQuery({
    queryKey: ['metering', 'invoice', company, period],
    queryFn: () => apiGet<MeteringInvoice>(apiPath`/metering/${company}/${period}`),
    enabled: !!company && !!period,
    refetchInterval: POLL_INTERVAL_MS,
  });

  const gridQuery = useQuery({
    queryKey: ['pricing', 'grid'],
    queryFn: () => apiGet<PriceGrid>('/pricing/grid'),
  });

  // Historique "Consommation mensuelle" (écran 10, guide illustré) — 10 mois
  // d'une métrique sélectionnable, additif (`GET
  // /metering/{company}/{period}/history/{metric}`, MOCK déterministe
  // côté back, voir types.ts). Indépendante de `invoiceQuery` : on affiche
  // l'historique même si la facture du mois en cours est encore en chargement.
  const historyQuery = useQuery({
    queryKey: ['metering', 'history', company, period, historyMetric],
    queryFn: () => apiGet<MeteringHistory>(apiPath`/metering/${company}/${period}/history/${historyMetric}`),
    enabled: !!company && !!period && !!historyMetric,
  });

  // SEC-07 : invalide `['metering', …]` (facture, historique), rechargées par l'API.
  useRealtime(['metering.tick']);

  const saveGridMutation = useMutation({
    mutationFn: (next: PriceGrid) => apiPut<PriceGrid>('/pricing/grid', next),
    onSuccess: (next) => {
      // SEC-37 : la nouvelle version peut prendre effet plus tard — on relit la grille en vigueur.
      void queryClient.invalidateQueries({ queryKey: ['pricing', 'grid'] });
      toast(`${t('metering.toast.gridSaved')} ${next.version} — ${t('metering.grid.effectiveFrom')} ${next.effectiveFrom}`, 'ok');
    },
    onError: (err: unknown) => {
      toast(errorMessage(err, t('metering.toast.gridError')), 'ko');
    },
  });

  const invoice = invoiceQuery.data;
  const companyLabel = companies.find((c) => c.code === company)?.name ?? company;
  const gridMetrics = gridQuery.data?.metrics ?? [];
  const selectedHistoryMetric = gridMetrics.find((m) => m.metric === historyMetric);

  const historySelectStyle: React.CSSProperties = {
    font: 'inherit',
    border: '1px solid var(--rule-strong)',
    borderRadius: 'var(--k-r-s)',
    padding: '6px 10px',
    background: 'var(--paper)',
    color: 'var(--ink)',
  };

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
            companyLocked={companyRole}
            onCompanyChange={setCompany}
            period={period}
            onPeriodChange={setPeriod}
            periods={PERIODS}
          />
        }
      />

      {companyRole && !me?.company ? (
        <div className="note warn" role="alert">
          <span>{t('auth.companyMissing')}</span>
        </div>
      ) : !company || invoiceQuery.isLoading ? (
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
              <span>
                {t('metering.history.title')} — {companyLabel}
              </span>
            </div>
            <div className="sheet-body">
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)', maxWidth: 260, marginBottom: 'var(--s-4)' }}>
                {t('metering.history.metric')}
                <select style={historySelectStyle} value={historyMetric} onChange={(e) => setHistoryMetric(e.target.value)}>
                  {gridMetrics.map((m) => (
                    <option key={m.metric} value={m.metric}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>

              {historyQuery.isLoading ? (
                <p>{t('common.loading')}</p>
              ) : historyQuery.error || !historyQuery.data ? (
                <div className="note ko" role="alert">
                  <span>{t('common.error')}</span>
                  <button type="button" onClick={() => historyQuery.refetch()}>
                    {t('common.retry')}
                  </button>
                </div>
              ) : (
                <ConsumptionHistoryChart
                  points={historyQuery.data.points}
                  quota={selectedHistoryMetric?.includedQuota ?? 0}
                  unit={selectedHistoryMetric?.unit ?? ''}
                />
              )}
            </div>
          </div>

          <div className="sheet" style={{ marginBottom: 'var(--s-5)' }}>
            <div className="sheet-head">
              <span>
                {t('metering.invoice.title')} · {invoice.period}
              </span>
              <Tag tone={INVOICE_STATUS_TONE[invoice.status] ?? 'a'}>{INVOICE_STATUS_LABEL[invoice.status] ? t(INVOICE_STATUS_LABEL[invoice.status]) : invoice.status}</Tag>
            </div>
            <div className="sheet-body">
              {invoice.status === 'SIMULEE' || invoice.simulated ? (
                <p className="note warn" role="note" style={{ fontSize: 'var(--k-fs-xs)', marginTop: 0 }}>
                  {t('metering.invoice.simulatedNote')}
                </p>
              ) : null}
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
                <Tag tone={INVOICE_STATUS_TONE[invoice.status] ?? 'a'}>{INVOICE_STATUS_LABEL[invoice.status] ? t(INVOICE_STATUS_LABEL[invoice.status]) : invoice.status}</Tag>
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
