'use client';

import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolioHeader } from '@/components/FolioHeader';
import { CoChip } from '@/components/ui/CoChip';
import { ScoreBar } from '@/components/ui/ScoreBar';
import { Tabs } from '@/components/ui/Tabs';
import { Table, Column } from '@/components/ui/Table';
import { Tag, TagTone } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { TranslationKey } from '@/i18n/translations';
import { apiGet, apiPost } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import {
  MatchCounters,
  MatchCriteria,
  MatchDecisionAction,
  MatchDecisionResult,
  MatchFilter,
  MatchQueueItem,
  MatchStatus,
  MatchThresholds,
} from '@/lib/types';
import { Paginated } from '@/lib/types';

const PAGE_SIZE = 7; // pagination fixe 7/p — A.5

/**
 * Critères pondérés du score d'appariement (B.5) — libellés + poids
 * **d'affichage uniquement**. Le score final (`row.score`) vient toujours
 * de l'API ; rien n'est recalculé ici (règle d'or C.1).
 */
const CRITERIA_WEIGHTS: { key: keyof MatchCriteria; label: TranslationKey; weight: number }[] = [
  { key: 'econstatPartage', label: 'matching.criteria.econstatPartage', weight: 0 },
  { key: 'plaquesCroisees', label: 'matching.criteria.plaquesCroisees', weight: 35 },
  { key: 'policeCroisee', label: 'matching.criteria.policeCroisee', weight: 15 },
  { key: 'dateHeure', label: 'matching.criteria.dateHeure', weight: 15 },
  { key: 'compagniesCroisees', label: 'matching.criteria.compagniesCroisees', weight: 10 },
  { key: 'gps', label: 'matching.criteria.gps', weight: 10 },
];

function statusTone(status: MatchStatus): TagTone {
  if (status === 'AUTO_CONFIRME' || status === 'CONFIRME_MANUEL') return 'ok';
  if (status === 'A_CONFIRMER') return 'warn';
  if (status === 'REJETE') return 'ko';
  return 'a';
}

export default function MatchingPage() {
  const { t, locale } = useI18n();
  const { hasPrivilege } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<MatchFilter>('TOUS');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const canDecide = hasPrivilege('matchDecide');

  const countersQuery = useQuery({
    queryKey: ['matching', 'counters'],
    queryFn: () => apiGet<MatchCounters>('/matching/queue/counters'),
  });

  const thresholdsQuery = useQuery({
    queryKey: ['matching', 'thresholds'],
    queryFn: () => apiGet<MatchThresholds>('/matching/thresholds'),
  });

  const queueQuery = useQuery({
    queryKey: ['matching', 'queue', filter, page],
    queryFn: () => apiGet<Paginated<MatchQueueItem>>('/matching/queue', { filter, page, pageSize: PAGE_SIZE }),
  });

  const items = queueQuery.data?.items ?? [];

  // Garde une sélection valide quand la page/filtre change (première ligne par défaut).
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

  const selected = items.find((i) => i.id === selectedId) ?? null;

  const decideMutation = useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: MatchDecisionAction; reason?: string }) =>
      apiPost<MatchDecisionResult>(`/matching/${id}/decide`, { action, reason }),
    onSuccess: (_result, variables) => {
      const toneByAction: Record<MatchDecisionAction, 'ok' | 'ko' | 'warn'> = {
        confirm: 'ok',
        reject: 'ko',
        complement: 'warn',
        link: 'ok',
      };
      const msgByAction: Record<MatchDecisionAction, TranslationKey> = {
        confirm: 'matching.toast.confirmed',
        reject: 'matching.toast.rejected',
        complement: 'matching.toast.complement',
        link: 'matching.toast.confirmed',
      };
      toast(t(msgByAction[variables.action]), toneByAction[variables.action]);
      setRejectReason('');
      void queryClient.invalidateQueries({ queryKey: ['matching'] });
    },
    onError: () => {
      toast(t('matching.toast.error'), 'ko');
    },
  });

  const decide = useCallback(
    (action: MatchDecisionAction) => {
      if (!selected || !canDecide || decideMutation.isPending) return;
      decideMutation.mutate({ id: selected.id, action, reason: action === 'reject' ? rejectReason || undefined : undefined });
    },
    [selected, canDecide, decideMutation, rejectReason],
  );

  const moveSelection = useCallback(
    (delta: 1 | -1) => {
      if (items.length === 0) return;
      const idx = Math.max(0, items.findIndex((i) => i.id === selectedId));
      const next = Math.min(items.length - 1, Math.max(0, idx + delta));
      setSelectedId(items[next].id);
    },
    [items, selectedId],
  );

  // Raccourcis clavier C/R/↑↓ (A.4, A.5) — désactivés quand le focus est
  // sur un champ de saisie (ex: motif de rejet) pour ne pas intercepter la frappe.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (typing) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveSelection(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveSelection(-1);
      } else if (e.key.toLowerCase() === 'c') {
        decide('confirm');
      } else if (e.key.toLowerCase() === 'r') {
        decide('reject');
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [moveSelection, decide]);

  function changeFilter(next: string) {
    setFilter(next as MatchFilter);
    setPage(1);
  }

  const columns: Column<MatchQueueItem>[] = useMemo(
    () => [
      { key: 'refA', header: t('matching.col.ref'), render: (r) => <span className="mono">{r.refA}</span> },
      {
        key: 'partyA',
        header: t('matching.col.partyA'),
        render: (r) => (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <CoChip code={r.companyA} />
            <span className="mono">{r.plateA}</span>
          </span>
        ),
      },
      {
        key: 'partyB',
        header: t('matching.col.partyB'),
        render: (r) =>
          r.companyB && r.plateB ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <CoChip code={r.companyB} />
              <span className="mono">{r.plateB}</span>
            </span>
          ) : (
            <span style={{ color: 'var(--ink-3)' }}>{t('matching.noPartyB')}</span>
          ),
      },
      { key: 'score', header: t('matching.col.score'), render: (r) => <ScoreBar score={r.score} /> },
      { key: 'status', header: t('matching.col.status'), render: (r) => <Tag tone={statusTone(r.status)}>{r.status}</Tag> },
    ],
    [t],
  );

  return (
    <>
      <FolioHeader badge="Module A · §6.3" title={t('matching.title')} subtitle={t('matching.subtitle')} />

      <div className="grid g-side">
        <div className="sheet">
          <div className="sheet-body">
            <Tabs
              items={[
                { key: 'TOUS', label: t('matching.tab.tous'), count: countersQuery.data?.TOUS },
                { key: 'AUTO', label: t('matching.tab.auto'), count: countersQuery.data?.AUTO },
                { key: 'A_CONFIRMER', label: t('matching.tab.aConfirmer'), count: countersQuery.data?.A_CONFIRMER },
                { key: 'NON_APPARIES', label: t('matching.tab.nonApparies'), count: countersQuery.data?.NON_APPARIES },
              ]}
              activeKey={filter}
              onChange={changeFilter}
            />

            <p style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)', marginTop: 0 }}>{t('matching.shortcuts.hint')}</p>

            {queueQuery.isLoading ? (
              <p>{t('common.loading')}</p>
            ) : queueQuery.error ? (
              <div className="note ko" role="alert">
                <span>{t('common.error')}</span>
                <button type="button" onClick={() => queueQuery.refetch()}>
                  {t('common.retry')}
                </button>
              </div>
            ) : (
              <Table
                columns={columns}
                rows={items}
                page={queueQuery.data?.page ?? 1}
                total={queueQuery.data?.total ?? 0}
                pageSize={PAGE_SIZE}
                onPageChange={setPage}
                onRowClick={(r) => setSelectedId(r.id)}
                getRowKey={(r) => r.id}
              />
            )}
          </div>
        </div>

        <aside className="sheet" aria-label={t('matching.panel.title')}>
          <div className="sheet-head">
            <span>{t('matching.panel.title')}</span>
          </div>
          <div className="sheet-body">
            {!selected ? (
              <p style={{ color: 'var(--ink-3)' }}>{t('matching.panel.empty')}</p>
            ) : (
              <>
                <div style={{ marginBottom: 'var(--s-4)' }}>
                  <strong style={{ display: 'block', marginBottom: 'var(--s-2)', fontSize: 'var(--k-fs-s)' }}>
                    {t('matching.panel.confrontation')}
                  </strong>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <CoChip code={selected.companyA} />
                      <span className="mono">{selected.plateA}</span>
                      <span className="mono" style={{ color: 'var(--ink-3)' }}>
                        {selected.refA}
                      </span>
                    </div>
                    {selected.companyB && selected.plateB ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <CoChip code={selected.companyB} />
                        <span className="mono">{selected.plateB}</span>
                        <span className="mono" style={{ color: 'var(--ink-3)' }}>
                          {selected.refB}
                        </span>
                      </div>
                    ) : (
                      <Tag tone="warn">{t('matching.noPartyB')}</Tag>
                    )}
                  </div>
                </div>

                <div style={{ marginBottom: 'var(--s-4)' }}>
                  <strong style={{ display: 'block', marginBottom: 'var(--s-2)', fontSize: 'var(--k-fs-s)' }}>
                    {t('matching.panel.criteria')}
                  </strong>
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {CRITERIA_WEIGHTS.map((c) => (
                      <li key={c.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 'var(--k-fs-s)' }}>
                        <span>
                          {t(c.label)} {c.weight > 0 ? <span className="mono" style={{ color: 'var(--ink-3)' }}>({c.weight})</span> : null}
                        </span>
                        <Tag tone={selected.criteria[c.key] ? 'ok' : 'a'}>{selected.criteria[c.key] ? 'OK' : '—'}</Tag>
                      </li>
                    ))}
                  </ul>
                </div>

                {thresholdsQuery.data ? (
                  <div style={{ marginBottom: 'var(--s-4)', fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)' }}>
                    <strong>{t('matching.panel.thresholds')}</strong> · {t('matching.panel.auto')} ≥ {thresholdsQuery.data.autoThreshold} ·{' '}
                    {t('matching.panel.confirm')} ≥ {thresholdsQuery.data.confirmThreshold}
                  </div>
                ) : null}

                {selected.status === 'REJETE' && selected.rejectReason ? (
                  <p className="note ko" style={{ fontSize: 'var(--k-fs-xs)' }}>
                    {t('matching.rejectReason')}: {selected.rejectReason}
                  </p>
                ) : null}

                {selected.confirmedBy ? (
                  <p style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)' }}>
                    {t('matching.decidedBy')}: {selected.confirmedBy} ({selected.confirmedAt ? new Date(selected.confirmedAt).toLocaleString(locale) : ''})
                  </p>
                ) : null}

                {!canDecide ? <p className="note warn">{t('common.forbidden')}</p> : null}

                <label htmlFor="reject-reason" style={{ display: 'block', fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)', marginBottom: 4 }}>
                  {t('matching.action.reason')}
                </label>
                <input
                  id="reject-reason"
                  type="text"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  disabled={!canDecide}
                  style={{ width: '100%', marginBottom: 'var(--s-3)', padding: '6px 10px', border: '1px solid var(--rule-strong)', borderRadius: 'var(--k-r-s)', font: 'inherit', background: 'var(--paper)', color: 'var(--ink)' }}
                />

                <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="tag ok"
                    style={{ cursor: canDecide ? 'pointer' : 'not-allowed', border: 'none' }}
                    disabled={!canDecide || decideMutation.isPending}
                    onClick={() => decide('confirm')}
                    aria-label={t('matching.action.confirm')}
                  >
                    {t('matching.action.confirm')} (C)
                  </button>
                  <button
                    type="button"
                    className="tag ko"
                    style={{ cursor: canDecide ? 'pointer' : 'not-allowed', border: 'none' }}
                    disabled={!canDecide || decideMutation.isPending}
                    onClick={() => decide('reject')}
                    aria-label={t('matching.action.reject')}
                  >
                    {t('matching.action.reject')} (R)
                  </button>
                  <button
                    type="button"
                    className="tag warn"
                    style={{ cursor: canDecide ? 'pointer' : 'not-allowed', border: 'none' }}
                    disabled={!canDecide || decideMutation.isPending}
                    onClick={() => decide('complement')}
                    aria-label={t('matching.action.complement')}
                  >
                    {t('matching.action.complement')}
                  </button>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
