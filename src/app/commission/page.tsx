'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { FolioHeader } from '@/components/FolioHeader';
import { Modal } from '@/components/ui/Modal';
import { Table, Column } from '@/components/ui/Table';
import { Tag, TagTone } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { TranslationKey } from '@/i18n/translations';
import { apiGet, apiPost } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { CommissionCase, CommissionCaseStatus, CommissionPenaltyResult, CommissionPvSignResult, Paginated } from '@/lib/types';

const PAGE_SIZE = 7; // pagination fixe 7/p — A.5

function statusTone(status: CommissionCaseStatus): TagTone {
  if (status === 'PRONONCE') return 'ok';
  if (status === 'EN_DELIBERE') return 'warn';
  return 'a';
}

interface LocalDecision {
  penalty?: { amount: number; reason: string; orderedAt: string };
  pvSignedAt?: string;
}

export default function CommissionPage() {
  const { t, locale } = useI18n();
  const { hasPrivilege } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<CommissionCase | null>(null);
  const [penaltyCompany, setPenaltyCompany] = useState<'A' | 'B'>('A');
  const [penaltyAmount, setPenaltyAmount] = useState('');
  const [penaltyReason, setPenaltyReason] = useState('');
  // Les pénalités (`SanctionViewDto`) sont des enregistrements séparés liés
  // par `commissionCaseId`, pas un champ embarqué dans `CommissionCase` —
  // gardées localement pour l'affichage immédiat (session courante) ; le PV,
  // lui, est bien persisté et renvoyé dans la fiche (`selected.pv`) après
  // invalidation de la requête.
  const [decisions, setDecisions] = useState<Record<string, LocalDecision>>({});

  const canPenalty = hasPrivilege('penaltyOrder');
  const canSignPv = hasPrivilege('pvSign');

  const casesQuery = useQuery({
    queryKey: ['commission', 'cases', page],
    queryFn: () => apiGet<Paginated<CommissionCase>>('/commission/cases', { page, pageSize: PAGE_SIZE }),
  });

  const pageRows = casesQuery.data?.items ?? [];

  const penaltyMutation = useMutation({
    mutationFn: ({ id, companyCode, amount, reason }: { id: string; companyCode: string; amount: number; reason: string }) =>
      apiPost<CommissionPenaltyResult>(`/commission/cases/${id}/penalty`, { companyCode, amount, reason }),
    onSuccess: (result, variables) => {
      setDecisions((prev) => ({ ...prev, [variables.id]: { ...prev[variables.id], penalty: { amount: result.amount ?? variables.amount, reason: result.reason, orderedAt: result.orderedAt } } }));
      setPenaltyAmount('');
      setPenaltyReason('');
      toast(t('commission.toast.penaltyOk'), 'ok');
    },
    onError: () => toast(t('commission.toast.penaltyError'), 'ko'),
  });

  const pvSignMutation = useMutation({
    mutationFn: (id: string) => apiPost<CommissionPvSignResult>(`/commission/cases/${id}/pv-sign`, {}),
    onSuccess: (result) => {
      setSelected(result);
      void queryClient.invalidateQueries({ queryKey: ['commission', 'cases'] });
      toast(t('commission.toast.pvSignOk'), 'ok');
    },
    onError: () => toast(t('commission.toast.pvSignError'), 'ko'),
  });

  const columns: Column<CommissionCase>[] = useMemo(
    () => [
      { key: 'recoursId', header: t('commission.col.case'), render: (r) => <span className="mono">{r.recoursId}</span> },
      { key: 'status', header: t('commission.col.status'), render: (r) => <Tag tone={statusTone(r.status)}>{t(`commission.status.${r.status}` as TranslationKey)}</Tag> },
      { key: 'scheduledAt', header: t('commission.col.scheduledAt'), render: (r) => new Date(r.scheduledAt).toLocaleDateString(locale) },
    ],
    [t, locale],
  );

  const selectedDecision = selected ? decisions[selected.id] : undefined;

  return (
    <>
      <FolioHeader badge="Module E · §6.7" title={t('commission.title')} subtitle={t('commission.subtitle')} />

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
              onRowClick={setSelected}
              getRowKey={(r) => r.id}
            />
          )}
        </div>
      </div>

      <Modal open={!!selected} title={selected ? `${t('commission.col.case')} ${selected.recoursId}` : ''} onClose={() => setSelected(null)}>
        {selected ? (
          <>
            <p>
              {t('commission.col.status')} : <Tag tone={statusTone(selected.status)}>{t(`commission.status.${selected.status}` as TranslationKey)}</Tag>
            </p>
            <p style={{ color: 'var(--ink-2)', fontSize: 'var(--k-fs-s)' }}>
              {t('commission.col.scheduledAt')} : {new Date(selected.scheduledAt).toLocaleString(locale)}
            </p>

            {selectedDecision?.penalty ? (
              <p className="note warn">
                <strong>{t('commission.decision.penaltyIssued')}</strong> : {new Intl.NumberFormat(locale, { style: 'currency', currency: 'DZD', maximumFractionDigits: 0 }).format(selectedDecision.penalty.amount)} — {selectedDecision.penalty.reason}
              </p>
            ) : null}
            {selected.pv ? (
              <p className="note ok">
                <strong>{t('commission.decision.pvSigned')}</strong> : {new Date(selected.pv.signedAt).toLocaleString(locale)} ({selected.pv.ref})
              </p>
            ) : null}

            <div style={{ marginTop: 'var(--s-4)', paddingTop: 'var(--s-4)', borderTop: '1px solid var(--rule)' }}>
              <strong style={{ display: 'block', marginBottom: 'var(--s-2)', fontSize: 'var(--k-fs-s)' }}>{t('commission.action.penalty.title')}</strong>
              {!canPenalty ? <p className="note warn">{t('commission.forbidden.penalty')}</p> : null}

              <label htmlFor="penalty-company" style={{ display: 'block', fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)', marginBottom: 4 }}>
                {t('commission.action.penalty.company')}
              </label>
              <select
                id="penalty-company"
                value={penaltyCompany}
                onChange={(e) => setPenaltyCompany(e.target.value as 'A' | 'B')}
                disabled={!canPenalty}
                style={{ width: '100%', marginBottom: 'var(--s-2)', padding: '6px 10px', border: '1px solid var(--rule-strong)', borderRadius: 'var(--k-r-s)', font: 'inherit', background: 'var(--paper)', color: 'var(--ink)' }}
              >
                <option value="A">{selected.companyA}</option>
                <option value="B">{selected.companyB}</option>
              </select>

              <label htmlFor="penalty-amount" style={{ display: 'block', fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)', marginBottom: 4 }}>
                {t('commission.action.penalty.amount')}
              </label>
              <input
                id="penalty-amount"
                type="number"
                min={0}
                value={penaltyAmount}
                onChange={(e) => setPenaltyAmount(e.target.value)}
                disabled={!canPenalty}
                style={{ width: '100%', marginBottom: 'var(--s-2)', padding: '6px 10px', border: '1px solid var(--rule-strong)', borderRadius: 'var(--k-r-s)', font: 'inherit', background: 'var(--paper)', color: 'var(--ink)' }}
              />

              <label htmlFor="penalty-reason" style={{ display: 'block', fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)', marginBottom: 4 }}>
                {t('commission.action.penalty.reason')}
              </label>
              <input
                id="penalty-reason"
                type="text"
                value={penaltyReason}
                onChange={(e) => setPenaltyReason(e.target.value)}
                disabled={!canPenalty}
                style={{ width: '100%', marginBottom: 'var(--s-3)', padding: '6px 10px', border: '1px solid var(--rule-strong)', borderRadius: 'var(--k-r-s)', font: 'inherit', background: 'var(--paper)', color: 'var(--ink)' }}
              />

              <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="tag warn"
                  style={{ border: 'none', cursor: canPenalty ? 'pointer' : 'not-allowed' }}
                  disabled={!canPenalty || !penaltyAmount || penaltyMutation.isPending}
                  onClick={() =>
                    penaltyMutation.mutate({
                      id: selected.id,
                      companyCode: penaltyCompany === 'A' ? selected.companyA : selected.companyB,
                      amount: Number(penaltyAmount),
                      reason: penaltyReason,
                    })
                  }
                >
                  {t('commission.action.penalty.submit')}
                </button>

                {!canSignPv ? (
                  <span className="note warn" style={{ display: 'inline-flex' }}>
                    {t('commission.forbidden.pvSign')}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="tag ok"
                  style={{ border: 'none', cursor: canSignPv ? 'pointer' : 'not-allowed' }}
                  disabled={!canSignPv || pvSignMutation.isPending}
                  onClick={() => pvSignMutation.mutate(selected.id)}
                >
                  {t('commission.action.pvSign')}
                </button>
              </div>
            </div>
          </>
        ) : null}
      </Modal>
    </>
  );
}
