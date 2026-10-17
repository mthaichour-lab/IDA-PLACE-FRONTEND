'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FolioHeader } from '@/components/FolioHeader';
import { Column, Table } from '@/components/ui/Table';
import { Tag } from '@/components/ui/Tag';
import { useI18n } from '@/i18n/provider';
import { apiGet } from '@/lib/api-client';
import { useRealtime } from '@/lib/realtime';
import { LedgerEntry, LedgerVerifyResult } from '@/lib/types';

const PAGE_SIZE = 6; // pagination fixe 6/p — A.5

// Polling de repli — le back n'émet pas encore `ledger.appended` à ce jour
// (voir rapport de livraison) ; cet abonnement est prévu par anticipation,
// le polling garantit l'écran utilisable (règle d'or : jamais le WS seul).
const POLL_INTERVAL_MS = 30_000;

function truncHash(h: string | null): string {
  if (!h) return '—';
  return h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-8)}` : h;
}

/** Export CSV client (placeholder documenté — voir rapport de livraison : l'API n'expose pas d'endpoint d'export). */
function buildLedgerCsv(entries: LedgerEntry[]): string {
  const header = 'id;at;type;ref;actor;summary;hash;prevHash';
  const lines = entries.map((e) => [e.id, e.at, e.type, e.ref, e.actor, e.summary, e.hash, e.prevHash ?? ''].join(';'));
  return [header, ...lines].join('\n');
}

function downloadText(fileName: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function LedgerPage() {
  const { t, locale } = useI18n();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const listQuery = useQuery({
    queryKey: ['ledger', 'list', from, to],
    queryFn: () =>
      apiGet<LedgerEntry[]>('/ledger', {
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(to).toISOString() : undefined,
      }),
    refetchInterval: POLL_INTERVAL_MS,
  });

  const verifyQuery = useQuery({
    queryKey: ['ledger', 'verify'],
    queryFn: () => apiGet<LedgerVerifyResult>('/ledger/verify'),
    refetchInterval: POLL_INTERVAL_MS,
  });

  const onRealtimeEvent = useCallback(() => {
    void listQuery.refetch();
    void verifyQuery.refetch();
  }, [listQuery, verifyQuery]);

  useRealtime(['ledger.appended'], onRealtimeEvent);

  const entries = listQuery.data ?? [];
  const pageRows = useMemo(() => entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [entries, page]);

  const columns: Column<LedgerEntry>[] = [
    { key: 'at', header: t('ledger.col.at'), render: (r) => new Date(r.at).toLocaleString(locale) },
    { key: 'type', header: t('ledger.col.type'), render: (r) => <span className="mono">{r.type}</span> },
    { key: 'ref', header: t('ledger.col.ref'), render: (r) => <span className="mono">{r.ref}</span> },
    { key: 'actor', header: t('ledger.col.actor'), render: (r) => r.actor },
    { key: 'summary', header: t('ledger.col.summary'), render: (r) => r.summary },
    { key: 'hash', header: t('ledger.col.hash'), render: (r) => <span className="mono" title={r.hash}>{truncHash(r.hash)}</span> },
    { key: 'prevHash', header: t('ledger.col.prevHash'), render: (r) => <span className="mono" title={r.prevHash ?? undefined}>{truncHash(r.prevHash)}</span> },
  ];

  function onExport() {
    if (entries.length === 0) return;
    downloadText(`journal-scelle-${new Date().toISOString().slice(0, 10)}.csv`, buildLedgerCsv(entries));
  }

  return (
    <>
      <FolioHeader
        badge="Module XI"
        title={t('ledger.title')}
        subtitle={t('ledger.subtitle')}
        actions={
          verifyQuery.data ? (
            <Tag tone={verifyQuery.data.valid ? 'ok' : 'ko'}>
              {verifyQuery.data.valid ? t('ledger.verify.valid') : `${t('ledger.verify.invalid')} (${verifyQuery.data.brokenAt ?? '?'})`}
            </Tag>
          ) : (
            <Tag tone="a">{t('ledger.verify.checking')}</Tag>
          )
        }
      />

      <div className="sheet" style={{ marginBottom: 'var(--s-5)' }}>
        <div className="sheet-body" style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)', flexWrap: 'wrap' }}>
          <label htmlFor="ledger-from" style={{ fontSize: 'var(--k-fs-s)', color: 'var(--ink-2)' }}>
            {t('ledger.filter.from')}
          </label>
          <input
            id="ledger-from"
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
            style={{ padding: '6px 10px', border: '1px solid var(--rule-strong)', borderRadius: 'var(--k-r-s)', font: 'inherit', background: 'var(--paper)', color: 'var(--ink)' }}
          />
          <label htmlFor="ledger-to" style={{ fontSize: 'var(--k-fs-s)', color: 'var(--ink-2)' }}>
            {t('ledger.filter.to')}
          </label>
          <input
            id="ledger-to"
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
            style={{ padding: '6px 10px', border: '1px solid var(--rule-strong)', borderRadius: 'var(--k-r-s)', font: 'inherit', background: 'var(--paper)', color: 'var(--ink)' }}
          />
          <button
            type="button"
            onClick={onExport}
            disabled={entries.length === 0}
            style={{
              marginInlineStart: 'auto',
              padding: '8px 16px',
              borderRadius: 'var(--k-r-s)',
              border: '1px solid var(--k-pri)',
              background: 'var(--k-pri)',
              color: '#fff',
              font: 'inherit',
              cursor: entries.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {t('ledger.export.button')}
          </button>
        </div>
      </div>

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
        <>
          <div className="sheet">
            <div className="sheet-head">
              <span>{t('ledger.verify.title')}</span>
            </div>
            <div className="sheet-body">
              <Table columns={columns} rows={pageRows} page={page} total={entries.length} pageSize={PAGE_SIZE} onPageChange={setPage} getRowKey={(r) => r.id} />
            </div>
          </div>
          <p style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)', marginTop: 'var(--s-3)' }}>{t('ledger.export.note')}</p>
        </>
      )}
    </>
  );
}
