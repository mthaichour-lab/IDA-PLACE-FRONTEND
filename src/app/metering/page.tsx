'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { FolioHeader } from '@/components/FolioHeader';
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
import { MeteringChart } from './MeteringChart';
import { MeteringGridCard } from './MeteringGridCard';

const PAGE_SIZE = 6; // pagination fixe 6/p — A.5
const POLL_INTERVAL_MS = 20_000; // repli polling (B.12) — voir /cockpit
const PERIODS = buildRecentPeriods(12);
const TILE_COUNT = 6; // maquette r19 : 6 tuiles de consommation (les autres inducteurs restent dans la facture)

/** SEC-37 : `SIMULEE` (consommation simulée, jamais émise) est affichée comme telle, distincte d'une facture réelle. */
const INVOICE_STATUS_LABEL: Record<InvoiceStatus, TranslationKey> = {
  SIMULEE: 'metering.invoice.status.SIMULEE',
  EMISE: 'metering.invoice.status.EMISE',
  PAYEE: 'metering.invoice.status.PAYEE',
  EN_RETARD: 'metering.invoice.status.EN_RETARD',
};
const INVOICE_STATUS_TONE: Record<InvoiceStatus, TagTone> = { SIMULEE: 'warn', EMISE: 'a', PAYEE: 'ok', EN_RETARD: 'ko' };

/**
 * Ventilation « infrastructure » de la facture (emplacement du showback de
 * la maquette). L'API n'expose AUCUN coût d'infrastructure attribué : on
 * regroupe uniquement les montants HT réellement facturés (dépassements)
 * des inducteurs d'infrastructure de la facture, sans rien estimer.
 */
const INFRA_GROUPS: { key: string; label: TranslationKey; metrics: string[] }[] = [
  { key: 'cpu', label: 'metering.infra.cpu', metrics: ['cpuHours'] },
  { key: 'mem', label: 'metering.infra.memory', metrics: ['memGBh'] },
  { key: 'storage', label: 'metering.infra.storage', metrics: ['storageGB', 'backupsGB'] },
  { key: 'net', label: 'metering.infra.network', metrics: ['bandwidthGB'] },
  { key: 'msg', label: 'metering.infra.messaging', metrics: ['sms', 'emails'] },
];

/** Diviseur porté par l'unité de prix (« 1 000 appels », « 100 e-mails ») — `null` si l'unité est simple. */
function unitDivisor(unit: string): number | null {
  const m = /^(\d[\d\s  ]*)\s/.exec(unit);
  if (!m) return null;
  const n = Number(m[1].replace(/[\s  ]/g, ''));
  return n > 1 ? n : null;
}

function monthLabel(period: string, locale: string): string {
  const [y, m] = period.split('-').map(Number);
  if (!y || !m) return period;
  try {
    // timeZone UTC : libellé identique serveur/client (pas d'écart d'hydratation).
    return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
  } catch {
    return period;
  }
}

type InvoiceRow = { key: string; label: string; measured: number; included: number | null; facturable: number; line?: InvoiceLine; unitPrice: number; amount: number };

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
  const companies: CompanyView[] = companyRole ? allCompanies.filter((c) => c.code === me?.company) : allCompanies;
  const company = companyRole ? me?.company ?? '' : pickedCompany ?? allCompanies[0]?.code ?? '';
  const setCompany = (code: string) => {
    if (!companyRole) setPickedCompany(code);
    setInvoicePage(1);
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

  const num = (n: number) => n.toLocaleString(locale);
  const da = (n: number) => `${num(n)} ${t('metering.unit.da')}`;
  const pct = (ratio: number, signed = false) => {
    try {
      return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0, signDisplay: signed ? 'always' : 'auto' }).format(ratio);
    } catch {
      return `${signed && ratio > 0 ? '+' : ''}${Math.round(ratio * 100)} %`;
    }
  };

  // Facture : ligne d'abonnement (quantité 1 sur le mois) puis une ligne par inducteur, paginées 6/p.
  const invoiceRows: InvoiceRow[] = invoice
    ? [
        { key: '__subscription', label: invoice.subscription.label, measured: 1, included: null, facturable: 1, unitPrice: invoice.subscription.monthly, amount: invoice.subscription.monthly },
        ...invoice.lines.map((l) => ({ key: l.metric, label: l.label, measured: l.measured, included: l.includedQuota, facturable: l.facturable, line: l, unitPrice: l.unitPrice, amount: l.amount })),
      ]
    : [];
  const invoicePageCount = Math.max(1, Math.ceil(invoiceRows.length / PAGE_SIZE));
  const invoicePageRows = invoiceRows.slice((invoicePage - 1) * PAGE_SIZE, invoicePage * PAGE_SIZE);

  const infraGroups = invoice
    ? INFRA_GROUPS.map((g) => {
        const lines = invoice.lines.filter((l) => g.metrics.includes(l.metric));
        return { ...g, present: lines.length > 0, amount: lines.reduce((s, l) => s + l.amount, 0) };
      }).filter((g) => g.present)
    : [];
  const infraTotal = infraGroups.reduce((s, g) => s + g.amount, 0);

  const statusTag = invoice ? (
    <span className={`tag ${INVOICE_STATUS_TONE[invoice.status] ?? 'a'} mtr-status`}>
      <span className="mtr-dot" aria-hidden="true" />
      {INVOICE_STATUS_LABEL[invoice.status] ? t(INVOICE_STATUS_LABEL[invoice.status]) : invoice.status}
    </span>
  ) : null;

  return (
    <div className="mtr">
      <FolioHeader
        badge="Module G · §6.9"
        title={t('metering.title')}
        subtitle={t('metering.subtitle')}
        actions={
          <>
            <span className="mtr-sel">
              <select className="mtr-select"
              aria-label={t('metering.selector.company')}
              value={company}
              disabled={companyRole}
              onChange={(e) => setCompany(e.target.value)}
            >
              {company && !companies.some((c) => c.code === company) ? <option value={company}>{company}</option> : null}
              {companies.map((c) => (
                <option key={c.id} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
              <ChevronDown size={15} strokeWidth={2.4} aria-hidden="true" />
            </span>
            <span className="mtr-sel">
              <select className="mtr-select"
              aria-label={t('metering.selector.period')}
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value);
                setInvoicePage(1);
              }}
            >
              {PERIODS.map((p) => (
                <option key={p} value={p}>
                  {monthLabel(p, locale)}
                </option>
              ))}
            </select>
              <ChevronDown size={15} strokeWidth={2.4} aria-hidden="true" />
            </span>
          </>
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
          <section className="mtr-tiles" aria-label={t('metering.tiles.title')}>
            {invoice.lines.slice(0, TILE_COUNT).map((l) => {
              const over = l.facturable > 0;
              const ratio = l.includedQuota > 0 ? l.measured / l.includedQuota : l.measured > 0 ? 2 : 0;
              return (
                <div key={l.metric} className="kpi mtr-tile">
                  <div className="kpi-value">{num(l.measured)}</div>
                  <div className="kpi-label">
                    {l.label}
                    {over && l.includedQuota > 0 ? (
                      <>
                        {' '}
                        <span className="mtr-over" title={t('metering.tile.overAria')}>
                          {pct((l.measured - l.includedQuota) / l.includedQuota, true)}
                        </span>
                      </>
                    ) : null}
                  </div>
                  {/* Jauge : 0 → 2 × quota inclus (le quota à mi-course), rouge en dépassement. */}
                  <div className={over ? 'mtr-gauge over' : 'mtr-gauge'} aria-hidden="true">
                    <div style={{ width: `${Math.min(100, ratio * 50)}%` }} />
                  </div>
                  <div className="mtr-quota-txt">
                    {t('metering.tile.quotaShort')} {num(l.includedQuota)}
                  </div>
                </div>
              );
            })}
          </section>

          <div className="mtr-row">
            <div className="sheet">
              <div className="sheet-head">
                <span>
                  {t('metering.history.title')} — {companyLabel}
                </span>
              </div>
              <div className="sheet-body">
                <label className="mtr-metric">
                  <span>{t('metering.history.metric')}</span>
                  <span className="mtr-sel">
                    <select className="mtr-select" value={historyMetric} onChange={(e) => setHistoryMetric(e.target.value)}>
                    {gridMetrics.map((m) => (
                      <option key={m.metric} value={m.metric}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                    <ChevronDown size={15} strokeWidth={2.4} aria-hidden="true" />
                  </span>
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
                  <MeteringChart points={historyQuery.data.points} quota={selectedHistoryMetric?.includedQuota ?? 0} unit={selectedHistoryMetric?.unit ?? ''} />
                )}
              </div>
            </div>

            <div className="sheet mtr-infra">
              <div className="sheet-head">
                <span>{t('metering.infra.title')}</span>
              </div>
              <div className="sheet-body">
                {infraGroups.length === 0 || infraTotal <= 0 ? (
                  <p className="muted">{t('metering.infra.empty')}</p>
                ) : (
                  <>
                    <div className="mtr-stack" aria-hidden="true">
                      {infraGroups.map((g, i) => (
                        <div key={g.key} className={`mtr-c${i}`} style={{ width: `${(g.amount / infraTotal) * 100}%` }} />
                      ))}
                    </div>
                    <table className="mtr-infra-t">
                      <tbody>
                        {infraGroups.map((g, i) => (
                          <tr key={g.key}>
                            <td>
                              <span className="mtr-infra-lbl">
                                <span className={`mtr-sw mtr-c${i}`} aria-hidden="true" />
                                {t(g.label)}
                              </span>
                            </td>
                            <td className="num mono">{da(g.amount)}</td>
                            <td className="num mono mtr-share">{pct(g.amount / infraTotal)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td>{t('metering.infra.total')}</td>
                          <td className="num mono">{da(infraTotal)}</td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </>
                )}
                <p className="mtr-note">{t('metering.infra.note')}</p>
              </div>
            </div>
          </div>
        </>
      )}

      <div className="mtr-row mtr-row-bottom">
        <div className="mtr-col">
          {invoice && !invoiceQuery.error ? (
            <>
              <div className="sheet mtr-invoice">
                <div className="sheet-head">
                  <span>
                    {t('metering.invoice.heading')} — {monthLabel(invoice.period, locale)}
                  </span>
                </div>
                <div className="sheet-body flush">
                  <div className="mtr-inv-meta">
                    {statusTag}
                    <span>
                      {t('metering.invoice.gridLabel')} <span className="mono">{invoice.gridVersion}</span>
                    </span>
                    <span className="mtr-inv-co">{companyLabel}</span>
                  </div>
                  {invoice.status === 'SIMULEE' || invoice.simulated ? (
                    <p className="note warn mtr-sim" role="note">
                      {t('metering.invoice.simulatedNote')}
                    </p>
                  ) : null}
                  <div className="t-wrap">
                    <table className="t mtr-inv-t">
                      <thead>
                        <tr>
                          <th>{t('metering.invoice.col.line')}</th>
                          <th className="num">{t('metering.invoice.col.measured')}</th>
                          <th className="num">{t('metering.invoice.col.included')}</th>
                          <th className="num">{t('metering.invoice.col.facturable')}</th>
                          <th>{t('metering.invoice.col.units')}</th>
                          <th className="num">{t('metering.invoice.col.unitPrice')}</th>
                          <th className="num">{t('metering.invoice.col.amountDa')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invoicePageRows.map((r) => {
                          const divisor = r.line ? unitDivisor(r.line.unit) : null;
                          return (
                            <tr key={r.key} className={r.line && r.facturable > 0 ? 'mtr-overrow' : undefined}>
                              <td className={r.line ? undefined : 'mtr-strong'}>{r.label}</td>
                              <td className="num mono">{num(r.measured)}</td>
                              <td className="num mono">{r.included === null ? '' : num(r.included)}</td>
                              <td className="num mono">{num(r.facturable)}</td>
                              <td className="mtr-units">{divisor && r.facturable > 0 ? `÷ ${num(divisor)} = ${(r.facturable / divisor).toLocaleString(locale, { maximumFractionDigits: 2 })}` : ''}</td>
                              <td className="num mono">{num(r.unitPrice)}</td>
                              <td className="num mono">{num(r.amount)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="pager">
                    <span>
                      {invoiceRows.length === 0 ? 0 : (invoicePage - 1) * PAGE_SIZE + 1}–{Math.min(invoicePage * PAGE_SIZE, invoiceRows.length)} {t('common.of')} {invoiceRows.length} · {t('common.page')} {invoicePage} / {invoicePageCount}
                    </span>
                    <div className="mtr-pager-btns">
                      <button type="button" aria-label={t('common.previous')} disabled={invoicePage <= 1} onClick={() => setInvoicePage(invoicePage - 1)}>
                        <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
                      </button>
                      <button type="button" aria-label={t('common.next')} disabled={invoicePage >= invoicePageCount} onClick={() => setInvoicePage(invoicePage + 1)}>
                        <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <dl className="mtr-totals">
                    <div>
                      <dt>{t('metering.invoice.totalHT')}</dt>
                      <dd className="mono">{da(invoice.totalHT)}</dd>
                    </div>
                    <div>
                      <dt>{t('metering.invoice.totalTVA')}</dt>
                      <dd className="mono">{da(invoice.totalTVA)}</dd>
                    </div>
                    <div className="ttc">
                      <dt>{t('metering.invoice.totalTTC')}</dt>
                      <dd className="mono">{da(invoice.totalTTC)}</dd>
                    </div>
                  </dl>
                </div>
              </div>

              <div className="sheet">
                <div className="sheet-head">
                  <span>{t('metering.payments.title')}</span>
                </div>
                <div className="sheet-body">
                  <div className="mtr-pay-state">
                    <span>{t('metering.invoice.status')} :</span>
                    {statusTag}
                  </div>
                  <p className="mtr-note">{t('metering.payments.empty')}</p>
                </div>
              </div>
            </>
          ) : null}
        </div>

        <div className="mtr-col">
          {gridQuery.data ? (
            <MeteringGridCard grid={gridQuery.data} canEdit={canEditGrid} onSave={(next) => saveGridMutation.mutateAsync(next)} saving={saveGridMutation.isPending} />
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
        </div>
      </div>
    </div>
  );
}
