'use client';

import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolioHeader } from '@/components/FolioHeader';
import { CoChip } from '@/components/ui/CoChip';
import { CountdownBar } from '@/components/ui/CountdownBar';
import { Table, Column } from '@/components/ui/Table';
import { Tabs } from '@/components/ui/Tabs';
import { Tag, TagTone } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { TranslationKey } from '@/i18n/translations';
import { apiGet, apiPost } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { useRealtime } from '@/lib/realtime';
import { Paginated, RecoursFilter, RecoursItem, RecoursState, RecoursTransitionResult } from '@/lib/types';

const PAGE_SIZE = 6; // pagination fixe 6/p — A.5

// Polling de repli (règle d'or : le WS ne doit jamais être le seul mécanisme).
// Le back n'émet pas encore `recours.timer` à ce jour (voir rapport de livraison) ;
// cet abonnement est prévu par anticipation, le polling garantit l'écran utilisable.
const POLL_INTERVAL_MS = 30_000;

const STATE_TONE: Record<RecoursState, TagTone> = {
  EN_ATTENTE: 'warn',
  ACCEPTE_TACITE: 'ok',
  OPPOSITION: 'ko',
  CONTESTATION: 'ko',
  COMMISSION: 'warn',
  REGLE: 'ok',
  FORCLOS: 'a',
};

const STATE_LABEL_KEY: Record<RecoursState, TranslationKey> = {
  EN_ATTENTE: 'exchanges.state.EN_ATTENTE',
  ACCEPTE_TACITE: 'exchanges.state.ACCEPTE_TACITE',
  OPPOSITION: 'exchanges.state.OPPOSITION',
  CONTESTATION: 'exchanges.state.CONTESTATION',
  COMMISSION: 'exchanges.state.COMMISSION',
  REGLE: 'exchanges.state.REGLE',
  FORCLOS: 'exchanges.state.FORCLOS',
};

function formatDzd(amount: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'DZD', maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount.toLocaleString()} DA`;
  }
}

function articleHint(state: RecoursState): TranslationKey | null {
  if (state === 'EN_ATTENTE') return 'exchanges.article.art10';
  if (state === 'CONTESTATION') return 'exchanges.article.art12';
  if (state === 'FORCLOS') return 'exchanges.article.art19';
  return null;
}

export default function ExchangesPage() {
  const { t, locale } = useI18n();
  const { hasPrivilege } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<RecoursFilter>('TOUS');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [motif, setMotif] = useState('');

  const canExchange = hasPrivilege('exchange');
  const canPay = hasPrivilege('pay');

  const listQuery = useQuery({
    queryKey: ['recours', 'list', filter, page],
    queryFn: () =>
      apiGet<Paginated<RecoursItem>>('/recours', {
        page,
        pageSize: PAGE_SIZE,
        state: filter === 'TOUS' ? undefined : filter,
      }),
    refetchInterval: POLL_INTERVAL_MS,
  });

  const onRealtimeEvent = useCallback(() => {
    void listQuery.refetch();
  }, [listQuery]);

  useRealtime(['recours.timer'], onRealtimeEvent);

  const items = listQuery.data?.items ?? [];

  useEffect(() => {
    if (items.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!items.some((i) => i.id === selectedId)) {
      setSelectedId(items[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.map((i) => i.id).join(',')]);

  useEffect(() => {
    setMotif('');
  }, [selectedId]);

  const selected = items.find((i) => i.id === selectedId) ?? null;

  function onActionSettled(ok: boolean) {
    toast(t(ok ? 'exchanges.toast.success' : 'exchanges.toast.error'), ok ? 'ok' : 'ko');
    if (ok) void queryClient.invalidateQueries({ queryKey: ['recours'] });
  }

  const opposerMutation = useMutation({
    mutationFn: ({ id, motif: m }: { id: string; motif: string }) =>
      apiPost<RecoursTransitionResult>(`/recours/${id}/opposer`, { motif: m }),
    onSuccess: () => onActionSettled(true),
    onError: () => onActionSettled(false),
  });

  const contesterMutation = useMutation({
    mutationFn: ({ id, motif: m }: { id: string; motif: string }) =>
      apiPost<RecoursTransitionResult>(`/recours/${id}/contester`, { motif: m }),
    onSuccess: () => onActionSettled(true),
    onError: () => onActionSettled(false),
  });

  const settleMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => apiPost<RecoursTransitionResult>(`/recours/${id}/settle`, {}),
    onSuccess: () => onActionSettled(true),
    onError: () => onActionSettled(false),
  });

  function changeFilter(next: string) {
    setFilter(next as RecoursFilter);
    setPage(1);
  }

  function submitOpposer() {
    if (!selected || !canExchange || !motif.trim() || opposerMutation.isPending) return;
    opposerMutation.mutate({ id: selected.id, motif: motif.trim() });
  }

  function submitContester() {
    if (!selected || !canExchange || !motif.trim() || contesterMutation.isPending) return;
    contesterMutation.mutate({ id: selected.id, motif: motif.trim() });
  }

  function submitSettle() {
    if (!selected || !canPay || settleMutation.isPending) return;
    settleMutation.mutate({ id: selected.id });
  }

  const columns: Column<RecoursItem>[] = useMemo(
    () => [
      { key: 'claimId', header: t('exchanges.col.dossier'), render: (r) => <span className="mono">{r.claimId}</span> },
      {
        key: 'parties',
        header: t('exchanges.col.parties'),
        render: (r) => (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <CoChip code={r.from} /> <span style={{ color: 'var(--ink-3)' }}>→</span> <CoChip code={r.to} />
          </span>
        ),
      },
      { key: 'amount', header: t('exchanges.col.amount'), render: (r) => <span className="mono">{formatDzd(r.amount, locale)}</span> },
      { key: 'state', header: t('exchanges.col.state'), render: (r) => <Tag tone={STATE_TONE[r.state]}>{t(STATE_LABEL_KEY[r.state])}</Tag> },
      {
        key: 'deadline',
        header: t('exchanges.col.deadline'),
        render: (r) => (r.currentDeadlineAt ? <CountdownBar startAt={r.requestSentAt} deadlineAt={r.currentDeadlineAt} /> : <span>—</span>),
      },
    ],
    [t, locale],
  );

  return (
    <>
      <FolioHeader badge="Module B · §6.4" title={t('exchanges.title')} subtitle={t('exchanges.subtitle')} />

      <div className="grid g-side">
        <div className="sheet">
          <div className="sheet-body">
            <Tabs
              items={[
                { key: 'TOUS', label: t('exchanges.tab.tous') },
                { key: 'EN_ATTENTE', label: t('exchanges.tab.enAttente') },
                { key: 'OPPOSITION', label: t('exchanges.tab.opposition') },
                { key: 'CONTESTATION', label: t('exchanges.tab.contestation') },
                { key: 'COMMISSION', label: t('exchanges.tab.commission') },
                { key: 'FORCLOS', label: t('exchanges.tab.forclos') },
              ]}
              activeKey={filter}
              onChange={changeFilter}
            />

            {listQuery.isLoading ? (
              <p>{t('common.loading')}</p>
            ) : listQuery.error ? (
              <div className="note ko" role="alert">
                <span>{t('common.error')}</span>
                <button type="button" onClick={() => listQuery.refetch()}>
                  {t('common.retry')}
                </button>
              </div>
            ) : (
              <Table
                columns={columns}
                rows={items}
                page={listQuery.data?.page ?? 1}
                total={listQuery.data?.total ?? 0}
                pageSize={PAGE_SIZE}
                onPageChange={setPage}
                onRowClick={(r) => setSelectedId(r.id)}
                getRowKey={(r) => r.id}
              />
            )}
          </div>
        </div>

        <aside className="sheet" aria-label={t('exchanges.panel.title')}>
          <div className="sheet-head">
            <span>{t('exchanges.panel.title')}</span>
          </div>
          <div className="sheet-body">
            {!selected ? (
              <p style={{ color: 'var(--ink-3)' }}>{t('exchanges.panel.empty')}</p>
            ) : (
              <>
                <div style={{ marginBottom: 'var(--s-4)', display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="mono">{selected.claimId}</span>
                    <Tag tone={STATE_TONE[selected.state]}>{t(STATE_LABEL_KEY[selected.state])}</Tag>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <CoChip code={selected.from} /> <span style={{ color: 'var(--ink-3)' }}>→</span> <CoChip code={selected.to} />
                  </div>
                  <div style={{ fontSize: 'var(--k-fs-s)' }}>
                    <strong>{t('exchanges.panel.amount')}</strong> : {formatDzd(selected.amount, locale)}
                  </div>
                  <div style={{ fontSize: 'var(--k-fs-s)' }}>
                    <strong>{t('exchanges.panel.sentAt')}</strong> : {new Date(selected.requestSentAt).toLocaleString(locale)}
                  </div>
                  {selected.currentDeadlineAt ? (
                    <div>
                      <div style={{ fontSize: 'var(--k-fs-s)', marginBottom: 4 }}>
                        <strong>{t('exchanges.panel.deadline')}</strong> : {new Date(selected.currentDeadlineAt).toLocaleString(locale)}
                      </div>
                      <CountdownBar startAt={selected.requestSentAt} deadlineAt={selected.currentDeadlineAt} />
                    </div>
                  ) : null}
                </div>

                {articleHint(selected.state) ? (
                  <p className="note warn" style={{ fontSize: 'var(--k-fs-xs)' }}>
                    {t(articleHint(selected.state) as TranslationKey)}
                  </p>
                ) : null}

                <div style={{ marginTop: 'var(--s-4)' }}>
                  {selected.state === 'EN_ATTENTE' ? (
                    <>
                      <strong style={{ display: 'block', marginBottom: 'var(--s-2)', fontSize: 'var(--k-fs-s)' }}>
                        {t('exchanges.action.opposer.title')}
                      </strong>
                      {!canExchange ? <p className="note warn">{t('common.forbidden')}</p> : null}
                      <label htmlFor="motif-opposer" style={{ display: 'block', fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)', marginBottom: 4 }}>
                        {t('exchanges.action.opposer.motif')}
                      </label>
                      <textarea
                        id="motif-opposer"
                        value={motif}
                        disabled={!canExchange}
                        onChange={(e) => setMotif(e.target.value)}
                        rows={3}
                        style={{ width: '100%', marginBottom: 'var(--s-3)', padding: '6px 10px', border: '1px solid var(--rule-strong)', borderRadius: 'var(--k-r-s)', font: 'inherit', background: 'var(--paper)', color: 'var(--ink)' }}
                      />
                      <button
                        type="button"
                        className="tag warn"
                        style={{ cursor: canExchange ? 'pointer' : 'not-allowed', border: 'none' }}
                        disabled={!canExchange || !motif.trim() || opposerMutation.isPending}
                        onClick={submitOpposer}
                      >
                        {t('exchanges.action.opposer.submit')}
                      </button>
                    </>
                  ) : selected.state === 'OPPOSITION' ? (
                    <>
                      <strong style={{ display: 'block', marginBottom: 'var(--s-2)', fontSize: 'var(--k-fs-s)' }}>
                        {t('exchanges.action.contester.title')}
                      </strong>
                      {!canExchange ? <p className="note warn">{t('common.forbidden')}</p> : null}
                      <label htmlFor="motif-contester" style={{ display: 'block', fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)', marginBottom: 4 }}>
                        {t('exchanges.action.contester.motif')}
                      </label>
                      <textarea
                        id="motif-contester"
                        value={motif}
                        disabled={!canExchange}
                        onChange={(e) => setMotif(e.target.value)}
                        rows={3}
                        style={{ width: '100%', marginBottom: 'var(--s-3)', padding: '6px 10px', border: '1px solid var(--rule-strong)', borderRadius: 'var(--k-r-s)', font: 'inherit', background: 'var(--paper)', color: 'var(--ink)' }}
                      />
                      <button
                        type="button"
                        className="tag ko"
                        style={{ cursor: canExchange ? 'pointer' : 'not-allowed', border: 'none' }}
                        disabled={!canExchange || !motif.trim() || contesterMutation.isPending}
                        onClick={submitContester}
                      >
                        {t('exchanges.action.contester.submit')}
                      </button>
                    </>
                  ) : selected.state === 'ACCEPTE_TACITE' || selected.state === 'COMMISSION' ? (
                    <>
                      <strong style={{ display: 'block', marginBottom: 'var(--s-2)', fontSize: 'var(--k-fs-s)' }}>
                        {t('exchanges.action.settle.title')}
                      </strong>
                      {!canPay ? <p className="note warn">{t('common.forbidden')}</p> : null}
                      <p style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)', marginBottom: 'var(--s-3)' }}>{t('exchanges.action.settle.note')}</p>
                      <button
                        type="button"
                        className="tag ok"
                        style={{ cursor: canPay ? 'pointer' : 'not-allowed', border: 'none' }}
                        disabled={!canPay || settleMutation.isPending}
                        onClick={submitSettle}
                      >
                        {t('exchanges.action.settle.submit')}
                      </button>
                    </>
                  ) : (
                    <p style={{ color: 'var(--ink-3)' }}>{t('exchanges.action.none')}</p>
                  )}
                </div>
              </>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
