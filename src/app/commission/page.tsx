'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { FolioHeader } from '@/components/FolioHeader';
import { Column, Table } from '@/components/ui/Table';
import { Tag, TagTone } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { TranslationKey } from '@/i18n/translations';
import { apiGet, apiPost } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { CommissionCase, CommissionCaseStatus, CommissionPenaltyResult, CommissionPvSignResult, Paginated } from '@/lib/types';

const PAGE_SIZE = 6; // pagination fixe 6/p — A.5

const STATUS_TONE: Record<CommissionCaseStatus, TagTone> = {
  A_INSTRUIRE: 'a',
  EN_DELIBERE: 'warn',
  PRONONCE: 'ok',
};

const STATUS_LABEL_KEY: Record<CommissionCaseStatus, TranslationKey> = {
  A_INSTRUIRE: 'commission.status.A_INSTRUIRE',
  EN_DELIBERE: 'commission.status.EN_DELIBERE',
  PRONONCE: 'commission.status.PRONONCE',
};

export default function CommissionPage() {
  const { t, locale } = useI18n();
  const { me, hasPrivilege } = useAuth();
  const { toast } = useToast();

  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  // L'API mock n'expose pas de GET d'historique pour les pénalités/PV déjà
  // prononcés (voir rapport de livraison) — tenu en mémoire pour la session
  // courante, même limite documentée que le journal d'import (/import).
  const [penaltyByCase, setPenaltyByCase] = useState<Record<string, CommissionPenaltyResult>>({});
  const [signByCase, setSignByCase] = useState<Record<string, CommissionPvSignResult>>({});

  const canPenalize = hasPrivilege('penaltyOrder');
  const canSign = hasPrivilege('pvSign');

  const casesQuery = useQuery({
    queryKey: ['commission', 'cases', page],
    queryFn: () => apiGet<Paginated<CommissionCase>>('/commission/cases', { page, pageSize: PAGE_SIZE }),
  });

  const pageRows = casesQuery.data?.items ?? [];

  useEffect(() => {
    if (pageRows.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!pageRows.some((c) => c.id === selectedId)) {
      setSelectedId(pageRows[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageRows.map((c) => c.id).join(',')]);

  const selected = pageRows.find((c) => c.id === selectedId) ?? null;

  const penaltyMutation = useMutation({
    mutationFn: ({ id, amount, reason }: { id: string; amount: number; reason: string }) =>
      apiPost<CommissionPenaltyResult>(`/commission/${id}/penalty`, { amount, reason }),
    onSuccess: (result, variables) => {
      setPenaltyByCase((prev) => ({ ...prev, [variables.id]: result }));
      setAmount('');
      setReason('');
      toast(t('commission.toast.penaltySuccess'), 'ok');
    },
    onError: () => toast(t('commission.toast.error'), 'ko'),
  });

  const signMutation = useMutation({
    mutationFn: (id: string) => apiPost<CommissionPvSignResult>(`/commission/${id}/pv-sign`),
    onSuccess: (result, id) => {
      setSignByCase((prev) => ({ ...prev, [id]: result }));
      toast(t('commission.toast.pvSuccess'), 'ok');
    },
    onError: () => toast(t('commission.toast.error'), 'ko'),
  });

  function submitPenalty() {
    const amountNumber = Number(amount);
    if (!selected || !canPenalize || !amount || Number.isNaN(amountNumber) || penaltyMutation.isPending) return;
    penaltyMutation.mutate({ id: selected.id, amount: amountNumber, reason });
  }

  function submitSign() {
    if (!selected || !canSign || signMutation.isPending) return;
    signMutation.mutate(selected.id);
  }

  const columns: Column<CommissionCase>[] = [
    { key: 'id', header: t('commission.col.id'), render: (r) => <span className="mono">{r.id}</span> },
    { key: 'recoursId', header: t('commission.col.recours'), render: (r) => <span className="mono">{r.recoursId}</span> },
    { key: 'status', header: t('commission.col.status'), render: (r) => <Tag tone={STATUS_TONE[r.status]}>{t(STATUS_LABEL_KEY[r.status])}</Tag> },
    { key: 'scheduledAt', header: t('commission.col.scheduledAt'), render: (r) => new Date(r.scheduledAt).toLocaleDateString(locale) },
  ];

  const penalty = selected ? penaltyByCase[selected.id] : undefined;
  const signature = selected ? signByCase[selected.id] : undefined;

  return (
    <>
      <FolioHeader badge="Module E · §6.7" title={t('commission.title')} subtitle={t('commission.subtitle')} />

      <div className="grid g-side">
        <div className="sheet">
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
                columns={columns}
                rows={pageRows}
                page={page}
                total={casesQuery.data?.total ?? 0}
                pageSize={PAGE_SIZE}
                onPageChange={setPage}
                onRowClick={(r) => setSelectedId(r.id)}
                getRowKey={(r) => r.id}
              />
            )}
          </div>
        </div>

        <aside className="sheet" aria-label={t('commission.panel.title')}>
          <div className="sheet-head">
            <span>{t('commission.panel.title')}</span>
          </div>
          <div className="sheet-body">
            {!selected ? (
              <p style={{ color: 'var(--ink-3)' }}>{t('commission.panel.empty')}</p>
            ) : (
              <>
                <div style={{ marginBottom: 'var(--s-4)', display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="mono">{selected.id}</span>
                    <Tag tone={STATUS_TONE[selected.status]}>{t(STATUS_LABEL_KEY[selected.status])}</Tag>
                  </div>
                  <div style={{ fontSize: 'var(--k-fs-s)' }}>
                    <strong>{t('commission.col.recours')}</strong> : <span className="mono">{selected.recoursId}</span>
                  </div>
                  <div style={{ fontSize: 'var(--k-fs-s)' }}>
                    <strong>{t('commission.col.scheduledAt')}</strong> : {new Date(selected.scheduledAt).toLocaleString(locale)}
                  </div>
                </div>

                <div style={{ marginBottom: 'var(--s-5)' }}>
                  <strong style={{ display: 'block', marginBottom: 'var(--s-2)', fontSize: 'var(--k-fs-s)' }}>{t('commission.penalty.title')}</strong>
                  {!canPenalize ? <p className="note warn">{t('common.forbidden')}</p> : null}
                  <label htmlFor="penalty-amount" style={{ display: 'block', fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)', marginBottom: 4 }}>
                    {t('commission.penalty.amount')}
                  </label>
                  <input
                    id="penalty-amount"
                    type="number"
                    min={0}
                    value={amount}
                    disabled={!canPenalize}
                    onChange={(e) => setAmount(e.target.value)}
                    style={{ width: '100%', marginBottom: 'var(--s-2)', padding: '6px 10px', border: '1px solid var(--rule-strong)', borderRadius: 'var(--k-r-s)', font: 'inherit', background: 'var(--paper)', color: 'var(--ink)' }}
                  />
                  <label htmlFor="penalty-reason" style={{ display: 'block', fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)', marginBottom: 4 }}>
                    {t('commission.penalty.reason')}
                  </label>
                  <input
                    id="penalty-reason"
                    type="text"
                    value={reason}
                    disabled={!canPenalize}
                    onChange={(e) => setReason(e.target.value)}
                    style={{ width: '100%', marginBottom: 'var(--s-3)', padding: '6px 10px', border: '1px solid var(--rule-strong)', borderRadius: 'var(--k-r-s)', font: 'inherit', background: 'var(--paper)', color: 'var(--ink)' }}
                  />
                  <button
                    type="button"
                    className="tag warn"
                    style={{ cursor: canPenalize ? 'pointer' : 'not-allowed', border: 'none' }}
                    disabled={!canPenalize || !amount || penaltyMutation.isPending}
                    onClick={submitPenalty}
                  >
                    {t('commission.penalty.submit')}
                  </button>
                </div>

                <div>
                  <strong style={{ display: 'block', marginBottom: 'var(--s-2)', fontSize: 'var(--k-fs-s)' }}>{t('commission.pv.title')}</strong>
                  <dl style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 'var(--s-2)', margin: 0 }}>
                    <div>
                      <dt style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)' }}>{t('commission.pv.motif')}</dt>
                      <dd style={{ margin: 0 }} className="mono">
                        {selected.recoursId}
                      </dd>
                    </div>
                    <div>
                      <dt style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)' }}>{t('commission.pv.decision')}</dt>
                      <dd style={{ margin: 0 }}>
                        {penalty ? (
                          <span>
                            {penalty.reason || '—'} ·{' '}
                            <span className="mono">
                              {new Intl.NumberFormat(locale, { style: 'currency', currency: 'DZD', maximumFractionDigits: 0 }).format(penalty.amount)}
                            </span>
                          </span>
                        ) : (
                          <span style={{ color: 'var(--ink-3)' }}>—</span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)' }}>{t('commission.pv.signataires')}</dt>
                      <dd style={{ margin: 0 }}>
                        {signature ? (
                          <span>
                            {me?.user.name ?? '—'} · {new Date(signature.signedAt).toLocaleString(locale)}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--ink-3)' }}>{t('commission.pv.notSigned')}</span>
                        )}
                      </dd>
                    </div>
                  </dl>

                  {!canSign ? <p className="note warn">{t('common.forbidden')}</p> : null}
                  <button
                    type="button"
                    className="tag ok"
                    style={{ marginTop: 'var(--s-3)', cursor: canSign ? 'pointer' : 'not-allowed', border: 'none' }}
                    disabled={!canSign || signMutation.isPending || !!signature}
                    onClick={submitSign}
                  >
                    {t('commission.pv.sign')}
                  </button>
                  <p style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)', marginTop: 'var(--s-2)' }}>{t('commission.pv.signedNote')}</p>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
