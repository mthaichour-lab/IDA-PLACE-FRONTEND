'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { FolioHeader } from '@/components/FolioHeader';
import { CoChip } from '@/components/ui/CoChip';
import { CountdownBar } from '@/components/ui/CountdownBar';
import { Modal } from '@/components/ui/Modal';
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

const PAGE_SIZE = 7; // pagination fixe 7/p — A.5

// Polling de repli (B.12) : `recours.timer` n'est pas encore émis par le
// back (RealtimeModule n'émet que claim.ingested/match.updated/metering.tick
// au moment de cette vague, voir HANDOFF backend) — l'écran s'y abonne par
// anticipation (même esprit que /cockpit), sans jamais s'appuyer sur lui seul.
const POLL_INTERVAL_MS = 30_000;

const TABS: { key: RecoursFilter; label: TranslationKey }[] = [
  { key: 'TOUS', label: 'exchanges.tab.tous' },
  { key: 'EN_ATTENTE', label: 'exchanges.tab.enAttente' },
  { key: 'OPPOSITION', label: 'exchanges.tab.opposition' },
  { key: 'CONTESTATION', label: 'exchanges.tab.contestation' },
  { key: 'COMMISSION', label: 'exchanges.tab.commission' },
  { key: 'FORCLOS', label: 'exchanges.tab.forclos' },
];

const ALL_STATES: RecoursState[] = ['ENVOYE', 'EN_ATTENTE', 'OPPOSITION', 'CONTESTATION', 'COMMISSION', 'FORCLOS'];

function stateTone(state: RecoursState): TagTone {
  if (state === 'FORCLOS') return 'ko';
  if (state === 'OPPOSITION' || state === 'CONTESTATION') return 'warn';
  if (state === 'COMMISSION') return 'a';
  return 'ok';
}

function formatDzd(amount: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'DZD', maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount.toLocaleString()} DA`;
  }
}

function recoursQuery(filter: RecoursFilter, page: number) {
  const base = { page, pageSize: PAGE_SIZE };
  return filter === 'TOUS' ? base : { ...base, state: filter };
}

interface TransitionLogEntry {
  state: string;
  transitionedAt: string;
}

export default function ExchangesPage() {
  const { t, locale } = useI18n();
  const { hasPrivilege } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<RecoursFilter>('TOUS');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<RecoursItem | null>(null);
  // Historique de transitions côté client, session courante uniquement —
  // RecoursController n'expose aucun endpoint d'historique (voir HANDOFF).
  const [transitionLog, setTransitionLog] = useState<Record<string, TransitionLogEntry[]>>({});

  const canTransition = hasPrivilege('exchange');

  // Pas de `GET /recours/counters` côté back (contrairement à
  // `/matching/queue/counters`) : les compteurs par onglet sont obtenus en
  // lisant `.total` de requêtes paginées (pageSize=1) par état — aucun
  // calcul métier, juste une lecture de compteur déjà renvoyé par l'API.
  const countersQuery = useQuery({
    queryKey: ['recours', 'counters'],
    queryFn: async () => {
      const entries = await Promise.all(
        TABS.map(async (tab) => {
          // pageSize=1 : on ne lit que `.total` (compteur déjà renvoyé par l'API), pas les lignes elles-mêmes.
          const query = tab.key === 'TOUS' ? { page: 1, pageSize: 1 } : { state: tab.key, page: 1, pageSize: 1 };
          const res = await apiGet<Paginated<RecoursItem>>('/recours', query);
          return [tab.key, res.total] as const;
        }),
      );
      return Object.fromEntries(entries) as Record<RecoursFilter, number>;
    },
    refetchInterval: POLL_INTERVAL_MS,
  });

  const listQuery = useQuery({
    queryKey: ['recours', 'list', filter, page],
    queryFn: () => apiGet<Paginated<RecoursItem>>('/recours', recoursQuery(filter, page)),
    refetchInterval: POLL_INTERVAL_MS,
  });

  const onRealtimeEvent = useCallback(() => {
    void listQuery.refetch();
    void countersQuery.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useRealtime(['recours.timer'], onRealtimeEvent);

  const items = listQuery.data?.items ?? [];

  const transitionMutation = useMutation({
    mutationFn: ({ id, toState }: { id: string; toState: string }) => apiPost<RecoursTransitionResult>(`/recours/${id}/transition`, { toState }),
    onSuccess: (result, variables) => {
      setTransitionLog((prev) => ({
        ...prev,
        [variables.id]: [{ state: result.state, transitionedAt: result.transitionedAt }, ...(prev[variables.id] ?? [])],
      }));
      setSelected((prev) => (prev && prev.id === variables.id ? { ...prev, state: result.state as RecoursState } : prev));
      toast(t('exchanges.detail.transition.toast.ok'), 'ok');
      void queryClient.invalidateQueries({ queryKey: ['recours'] });
    },
    onError: () => {
      toast(t('exchanges.detail.transition.toast.error'), 'ko');
    },
  });

  function changeFilter(next: string) {
    setFilter(next as RecoursFilter);
    setPage(1);
  }

  const columns: Column<RecoursItem>[] = useMemo(
    () => [
      { key: 'claimId', header: t('exchanges.col.dossier'), render: (r) => <span className="mono">{r.claimId}</span> },
      {
        key: 'parties',
        header: t('exchanges.col.parties'),
        render: (r) => (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <CoChip code={r.from} /> <span aria-hidden="true">→</span> <CoChip code={r.to} />
          </span>
        ),
      },
      { key: 'amount', header: t('exchanges.col.amount'), render: (r) => <span className="mono">{formatDzd(r.amount, locale)}</span> },
      { key: 'state', header: t('exchanges.col.state'), render: (r) => <Tag tone={stateTone(r.state)}>{t(`exchanges.state.${r.state}` as TranslationKey)}</Tag> },
      {
        key: 'deadline',
        header: t('exchanges.col.deadline'),
        render: (r) => (
          <CountdownBar
            startAt={r.requestSentAt}
            deadlineAt={r.conventionalDeadlineAt}
            renderLabel={({ remainingDays, overdue }) => `${remainingDays} ${overdue ? t('exchanges.countdown.overdue') : t('exchanges.countdown.remaining')}`}
          />
        ),
      },
    ],
    [t, locale],
  );

  return (
    <>
      <FolioHeader badge="Module B · §6.4" title={t('exchanges.title')} subtitle={t('exchanges.subtitle')} />

      <div className="sheet">
        <div className="sheet-body">
          <Tabs items={TABS.map((tab) => ({ key: tab.key, label: t(tab.label), count: countersQuery.data?.[tab.key] }))} activeKey={filter} onChange={changeFilter} />

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
              onRowClick={setSelected}
              getRowKey={(r) => r.id}
            />
          )}
        </div>
      </div>

      <Modal open={!!selected} title={selected ? `${t('exchanges.detail.titlePrefix')} ${selected.id}` : ''} onClose={() => setSelected(null)}>
        {selected ? (
          <>
            <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--s-3)', marginBottom: 'var(--s-4)' }}>
              <Field label={t('exchanges.detail.claim')}>
                <span className="mono">{selected.claimId}</span>
              </Field>
              <Field label={t('exchanges.detail.from')}>
                <CoChip code={selected.from} />
              </Field>
              <Field label={t('exchanges.detail.to')}>
                <CoChip code={selected.to} />
              </Field>
              <Field label={t('exchanges.detail.amount')}>
                <span className="mono">{formatDzd(selected.amount, locale)}</span>
              </Field>
              <Field label={t('exchanges.detail.state')}>
                <Tag tone={stateTone(selected.state)}>{t(`exchanges.state.${selected.state}` as TranslationKey)}</Tag>
              </Field>
              <Field label={t('exchanges.detail.sentAt')}>{new Date(selected.requestSentAt).toLocaleDateString(locale)}</Field>
            </dl>

            <div style={{ marginBottom: 'var(--s-4)' }}>
              <strong style={{ display: 'block', marginBottom: 'var(--s-2)', fontSize: 'var(--k-fs-s)' }}>{t('exchanges.detail.deadline')}</strong>
              <CountdownBar
                startAt={selected.requestSentAt}
                deadlineAt={selected.conventionalDeadlineAt}
                renderLabel={({ remainingDays, overdue }) => `${remainingDays} ${overdue ? t('exchanges.countdown.overdue') : t('exchanges.countdown.remaining')}`}
              />
            </div>

            {!canTransition ? <p className="note warn">{t('common.forbidden')}</p> : null}

            <div style={{ marginBottom: 'var(--s-4)' }}>
              <strong style={{ display: 'block', marginBottom: 'var(--s-2)', fontSize: 'var(--k-fs-s)' }}>{t('exchanges.detail.transition.title')}</strong>
              <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap' }}>
                {ALL_STATES.filter((s) => s !== selected.state).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="tag a"
                    style={{ cursor: canTransition ? 'pointer' : 'not-allowed', border: 'none' }}
                    disabled={!canTransition || transitionMutation.isPending}
                    onClick={() => transitionMutation.mutate({ id: selected.id, toState: s })}
                  >
                    {t(`exchanges.state.${s}` as TranslationKey)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <strong style={{ display: 'block', marginBottom: 'var(--s-2)', fontSize: 'var(--k-fs-s)' }}>{t('exchanges.detail.transitions')}</strong>
              {(transitionLog[selected.id]?.length ?? 0) === 0 ? (
                <p style={{ color: 'var(--ink-3)', fontSize: 'var(--k-fs-s)' }}>{t('exchanges.detail.transitions.empty')}</p>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {transitionLog[selected.id].map((entry, i) => (
                    <li key={`${entry.transitionedAt}-${i}`} style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)', display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                      <span>{t(`exchanges.state.${entry.state}` as TranslationKey)}</span>
                      <span className="mono">{new Date(entry.transitionedAt).toLocaleString(locale)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
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
