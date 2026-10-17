'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
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
import { CommissionCase, CommissionCaseStatus, CommissionPenaltyResult, CommissionPvSignResult } from '@/lib/types';

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

  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<CommissionCase | null>(null);
  const [penaltyAmount, setPenaltyAmount] = useState('');
  const [penaltyReason, setPenaltyReason] = useState('');
  // `CommissionController` est un mock sans persistance (voir HANDOFF
  // backend) : les POST renvoient bien une réponse, mais ne modifient pas
  // `cases()`. On garde donc les décisions localement (session courante,
  // même limite documentée que le journal d'import) pour refléter l'action
  // à l'écran en attendant un vrai CommissionModule.
  const [decisions, setDecisions] = useState<Record<string, LocalDecision>>({});

  const canPenalty = hasPrivilege('penaltyOrder');
  const canSignPv = hasPrivilege('pvSign');

  // `GET /commission/cases` ne supporte pas la pagination côté back
  // (contrairement à `/recours`/`/matching/queue`) : pagination 7/p
  // appliquée côté front sur la liste complète.
  const casesQuery = useQuery({
    queryKey: ['commission', 'cases'],
    queryFn: () => apiGet<CommissionCase[]>('/commission/cases'),
  });

  const allCases = casesQuery.data ?? [];
  const pageRows = allCases.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const penaltyMutation = useMutation({
    mutationFn: ({ id, amount, reason }: { id: string; amount: number; reason: string }) =>
      apiPost<CommissionPenaltyResult>(`/commission/${id}/penalty`, { amount, reason }),
    onSuccess: (result, variables) => {
      setDecisions((prev) => ({ ...prev, [variables.id]: { ...prev[variables.id], penalty: { amount: result.amount, reason: result.reason, orderedAt: result.orderedAt } } }));
      setPenaltyAmount('');
      setPenaltyReason('');
      toast(t('commission.toast.penaltyOk'), 'ok');
    },
    onError: () => toast(t('commission.toast.penaltyError'), 'ko'),
  });

  const pvSignMutation = useMutation({
    mutationFn: (id: string) => apiPost<CommissionPvSignResult>(`/commission/${id}/pv-sign`),
    onSuccess: (result, id) => {
      setDecisions((prev) => ({ ...prev, [id]: { ...prev[id], pvSignedAt: result.signedAt } }));
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
              total={allCases.length}
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
            {selectedDecision?.pvSignedAt ? (
              <p className="note ok">
                <strong>{t('commission.decision.pvSigned')}</strong> : {new Date(selectedDecision.pvSignedAt).toLocaleString(locale)}
              </p>
            ) : null}

            <div style={{ marginTop: 'var(--s-4)', paddingTop: 'var(--s-4)', borderTop: '1px solid var(--rule)' }}>
              <strong style={{ display: 'block', marginBottom: 'var(--s-2)', fontSize: 'var(--k-fs-s)' }}>{t('commission.action.penalty.title')}</strong>
              {!canPenalty ? <p className="note warn">{t('commission.forbidden.penalty')}</p> : null}

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
                  onClick={() => penaltyMutation.mutate({ id: selected.id, amount: Number(penaltyAmount), reason: penaltyReason })}
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
