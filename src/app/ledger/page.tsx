'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FolioHeader } from '@/components/FolioHeader';
import { Tag } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { apiGet } from '@/lib/api-client';
import { buildLedgerCsv, downloadCsv } from '@/lib/csv';
import { useRealtime } from '@/lib/realtime';
import { LedgerEntry, LedgerVerifyResult } from '@/lib/types';

const PAGE_SIZE = 6; // pagination fixe 6/p — A.5

// Polling de repli — le back n'émet pas encore `ledger.appended` à ce jour
// (voir rapport de livraison) ; cet abonnement est prévu par anticipation,
// le polling garantit l'écran utilisable (règle d'or : jamais le WS seul).
const POLL_INTERVAL_MS = 30_000;

const TYPE_FILTER_ALL = '__ALL__';

const inputStyle = {
  padding: '6px 10px',
  border: '1px solid var(--rule-strong)',
  borderRadius: 'var(--k-r-s)',
  font: 'inherit',
  background: 'var(--paper)',
  color: 'var(--ink)',
};

const primaryButtonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 16px',
  borderRadius: 'var(--k-r-s)',
  border: '1px solid var(--k-pri)',
  background: 'var(--k-pri)',
  color: '#fff',
  font: 'inherit',
  fontWeight: 600,
};

const secondaryButtonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 16px',
  borderRadius: 'var(--k-r-s)',
  border: '1px solid var(--rule-strong)',
  background: 'var(--paper)',
  color: 'var(--ink-3)',
  font: 'inherit',
  fontWeight: 600,
  cursor: 'not-allowed',
};

function truncHash(h: string | null): string {
  if (!h) return '—';
  return h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-8)}` : h;
}

/**
 * Libellé d'affichage d'un `type` d'entrée — simple mise en forme du code
 * brut renvoyé par l'API (minuscule, underscores → espaces, majuscule
 * initiale par mot). AUCUNE table de correspondance figée sur des valeurs
 * supposées : le seed dev utilise SYSTEM/CLAIM/MATCH, tout type réel futur
 * s'affiche correctement sans modification de ce fichier.
 */
function formatTypeLabel(type: string): string {
  return type
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

type LedgerTypeTone = 'ingest' | 'match' | 'other';

/** Variation d'icône par famille de `type` — reconnaissance par mot-clé, repli neutre pour tout type non reconnu (aucun type inventé). */
function ledgerTypeTone(type: string): LedgerTypeTone {
  const upper = type.toUpperCase();
  if (upper.includes('MATCH')) return 'match';
  if (upper.includes('INGEST') || upper.includes('CLAIM')) return 'ingest';
  return 'other';
}

function LedgerTypeIcon({ type }: { type: string }) {
  const tone = ledgerTypeTone(type);
  const palette: Record<LedgerTypeTone, { bg: string; fg: string }> = {
    ingest: { bg: 'var(--ok-soft)', fg: 'var(--ok)' },
    match: { bg: 'var(--k-mint)', fg: 'var(--k-pri)' },
    other: { bg: 'var(--neutral-soft)', fg: 'var(--neutral)' },
  };
  const { bg, fg } = palette[tone];
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 36,
        height: 36,
        borderRadius: 'var(--k-r-s)',
        background: bg,
        color: fg,
        flexShrink: 0,
      }}
    >
      {tone === 'match' ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      ) : tone === 'ingest' ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 12h-6l-2 3h-4l-2-3H2" />
          <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
        </svg>
      ) : (
        <svg width="10" height="10" viewBox="0 0 10 10">
          <circle cx="5" cy="5" r="5" fill="currentColor" />
        </svg>
      )}
    </span>
  );
}

function ShieldIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5l-8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export default function LedgerPage() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [typeFilter, setTypeFilter] = useState(TYPE_FILTER_ALL);
  const [search, setSearch] = useState('');
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

  // SEC-07 : invalide `['ledger', …]` (liste + vérification), rechargées par l'API.
  useRealtime(['ledger.appended']);

  // Déclenche une vérification immédiate au clic, en plus du polling 30s
  // (`refetchInterval` ci-dessus, conservé) — toujours les deux, jamais l'un
  // sans l'autre (règle d'or : jamais le polling seul sans action manuelle,
  // ni l'inverse).
  function onVerifyClick() {
    void verifyQuery.refetch().then((res) => {
      if (!res.data) return;
      toast(res.data.valid ? t('ledger.verify.valid') : `${t('ledger.verify.invalid')} (${res.data.brokenAt ?? '?'})`, res.data.valid ? 'ok' : 'ko');
    });
  }

  const entries = listQuery.data ?? [];

  // Numéro de séquence (#1806 décroissant dans la capture de référence) —
  // dérivé UNIQUEMENT de la position de l'entrée dans la liste complète
  // renvoyée par l'API (triée seq ASC côté back, voir ledger.service.ts),
  // jamais recalculé après filtrage type/texte, pour rester le vrai numéro
  // de place de l'entrée (pas une position dans la vue filtrée).
  const withSeq = useMemo(() => entries.map((e, i) => ({ ...e, seq: i + 1 })), [entries]);
  const newestFirst = useMemo(() => [...withSeq].reverse(), [withSeq]);

  const typeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) m.set(e.type, (m.get(e.type) ?? 0) + 1);
    return m;
  }, [entries]);
  const types = useMemo(() => [...typeCounts.keys()].sort(), [typeCounts]);

  const filtered = useMemo(() => {
    let list = newestFirst;
    if (typeFilter !== TYPE_FILTER_ALL) list = list.filter((e) => e.type === typeFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((e) => [e.ref, e.actor, e.hash, e.prevHash ?? ''].some((v) => v.toLowerCase().includes(q)));
    return list;
  }, [newestFirst, typeFilter, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page]);

  function onExport() {
    if (filtered.length === 0) return;
    downloadCsv(`journal-scelle-${new Date().toISOString().slice(0, 10)}.csv`, buildLedgerCsv(filtered));
  }

  return (
    <>
      <FolioHeader
        badge="Module XI"
        title={t('ledger.title')}
        subtitle={t('ledger.subtitle')}
        actions={
          <>
            <button type="button" onClick={onVerifyClick} disabled={verifyQuery.isFetching} style={primaryButtonStyle}>
              <ShieldIcon />
              {t('ledger.verify.cta')}
            </button>
            {verifyQuery.data ? (
              <Tag tone={verifyQuery.data.valid ? 'ok' : 'ko'}>
                {verifyQuery.data.valid ? t('ledger.verify.valid') : `${t('ledger.verify.invalid')} (${verifyQuery.data.brokenAt ?? '?'})`}
              </Tag>
            ) : (
              <Tag tone="a">{t('ledger.verify.checking')}</Tag>
            )}
            {/* Pas d'endpoint de page de journal dédiée côté API (voir HANDOFF.md) — bouton volontairement désactivé plutôt qu'une fausse destination. */}
            <button type="button" disabled title={t('ledger.page.tooltip')} style={secondaryButtonStyle}>
              {t('ledger.page.label')}
            </button>
          </>
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
            style={inputStyle}
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
            style={inputStyle}
          />
          <button
            type="button"
            onClick={onExport}
            disabled={filtered.length === 0}
            style={{
              marginInlineStart: 'auto',
              padding: '8px 16px',
              borderRadius: 'var(--k-r-s)',
              border: '1px solid var(--k-pri)',
              background: 'var(--k-pri)',
              color: '#fff',
              font: 'inherit',
              cursor: filtered.length === 0 ? 'not-allowed' : 'pointer',
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
              <span>
                {t('ledger.list.title')} ({entries.length} {t('ledger.list.entriesSuffix')})
              </span>
            </div>
            <div className="sheet-body">
              <div style={{ display: 'flex', gap: 'var(--s-3)', marginBottom: 'var(--s-4)', flexWrap: 'wrap' }}>
                <select
                  value={typeFilter}
                  aria-label={t('ledger.filter.allTypes')}
                  onChange={(e) => {
                    setTypeFilter(e.target.value);
                    setPage(1);
                  }}
                  style={{ ...inputStyle, minWidth: 200 }}
                >
                  <option value={TYPE_FILTER_ALL}>
                    {t('ledger.filter.allTypes')} ({entries.length})
                  </option>
                  {types.map((ty) => (
                    <option key={ty} value={ty}>
                      {formatTypeLabel(ty)} ({typeCounts.get(ty)})
                    </option>
                  ))}
                </select>
                <input
                  type="search"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  aria-label={t('ledger.search.placeholder')}
                  placeholder={t('ledger.search.placeholder')}
                  style={{ ...inputStyle, flex: 1, minWidth: 220 }}
                />
              </div>

              {pageRows.length === 0 ? (
                <p style={{ textAlign: 'center', color: 'var(--ink-3)' }}>{t('common.noData')}</p>
              ) : (
                <div>
                  {pageRows.map((entry) => (
                    <div
                      key={entry.id}
                      style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--s-3)', padding: 'var(--s-3) 0', borderBottom: '1px solid var(--rule)' }}
                    >
                      <LedgerTypeIcon type={entry.type} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontWeight: 600, fontSize: 'var(--k-fs-m)' }}>
                          <span className="mono">#{entry.seq}</span> {formatTypeLabel(entry.type)} · <span className="mono">{entry.ref}</span>
                        </p>
                        <p style={{ margin: '2px 0 0', fontSize: 'var(--k-fs-s)', color: 'var(--ink-2)' }}>
                          {entry.summary} — {entry.actor}
                        </p>
                      </div>
                      <div style={{ textAlign: 'end', flexShrink: 0, fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)' }}>
                        <div className="mono">{new Date(entry.at).toLocaleString(locale)}</div>
                        <div className="mono" title={`${entry.hash} ← ${entry.prevHash ?? '—'}`}>
                          {truncHash(entry.hash)} ← {truncHash(entry.prevHash)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="pager">
                <span>
                  {t('common.page')} {page} {t('common.of')} {pageCount} · {filtered.length}
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    {t('common.previous')}
                  </button>
                  <button type="button" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>
                    {t('common.next')}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <p style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)', marginTop: 'var(--s-3)' }}>{t('ledger.export.note')}</p>
        </>
      )}
    </>
  );
}
