'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download, FileText, Inbox, Link2, Search, ShieldCheck, Table2 } from 'lucide-react';
import { TruncationNote } from '@/components/ui/TruncationNote';
import { FolioHeader } from '@/components/FolioHeader';
import { PlaceOnlyGuard } from '@/components/PlaceOnlyGuard';
import { Tag } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { apiGet } from '@/lib/api-client';
import { fetchAllPages } from '@/lib/paginate';
import { buildLedgerCsv, downloadCsv } from '@/lib/csv';
import { useRealtime } from '@/lib/realtime';
import { LedgerEntry, LedgerVerifyResult } from '@/lib/types';

const PAGE_SIZE = 6; // pagination fixe 6/p — A.5 (la maquette affiche 6 entrées par page)

// Polling de repli — le back n'émet pas encore `ledger.appended` à ce jour
// (voir rapport de livraison) ; cet abonnement est prévu par anticipation,
// le polling garantit l'écran utilisable (règle d'or : jamais le WS seul).
const POLL_INTERVAL_MS = 30_000;

const TYPE_FILTER_ALL = '__ALL__';

/** Empreintes abrégées comme la maquette : « 60b21dbab1 ← d002a5 » (10 caractères ← 6 caractères). */
function shortHash(h: string | null, len: number): string {
  if (!h) return '—';
  return h.slice(0, len);
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

/**
 * Résumé lisible d'une entrée : certains `summary` sont un objet JSON
 * sérialisé par le back — affiché « clé valeur · clé valeur » (mise en
 * forme seule, aucune valeur ajoutée ni retirée hors objets imbriqués,
 * résumés par leur JSON compact). Un résumé texte est rendu tel quel.
 */
function formatSummary(summary: string): string {
  const s = summary.trim();
  if (!s.startsWith('{')) return summary;
  try {
    const obj = JSON.parse(s) as unknown;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return summary;
    return Object.entries(obj as Record<string, unknown>)
      .map(([k, v]) => {
        if (v === null || v === undefined) return `${k} —`;
        if (Array.isArray(v)) return `${k} ${v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ')}`;
        if (typeof v === 'object') return `${k} ${JSON.stringify(v)}`;
        return `${k} ${String(v)}`;
      })
      .join(' · ');
  } catch {
    return summary;
  }
}

/** Date + heure « 13 oct. 2026 23:41 » de la maquette. */
function formatAt(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })} ${d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`;
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
  return (
    <span className={`row-icon lg-icon lg-${tone}`} aria-hidden="true">
      {tone === 'match' ? <Link2 size={16} /> : tone === 'ingest' ? <Inbox size={16} /> : <FileText size={16} />}
    </span>
  );
}

/** SEC-05/SEC-21 : écran réservé aux rôles de la place (403 pour un rôle compagnie). */
export default function LedgerPage() {
  return (
    <PlaceOnlyGuard titleKey="ledger.title">
      <LedgerContent />
    </PlaceOnlyGuard>
  );
}

function LedgerContent() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [typeFilter, setTypeFilter] = useState(TYPE_FILTER_ALL);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const listQuery = useQuery({
    queryKey: ['ledger', 'list', from, to],
    // `GET /ledger` est paginé (pageSize ≤ 100, SEC-13) : pages successives
    // jusqu'au plafond `FETCH_ALL_MAX_ITEMS` ; bornes en ISO 8601.
    queryFn: () =>
      fetchAllPages<LedgerEntry>('/ledger', {
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

  const entries = useMemo(() => listQuery.data?.items ?? [], [listQuery.data]);

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
  const nf = (n: number) => n.toLocaleString(locale);
  const totalEntries = listQuery.data?.total ?? entries.length;

  function onExport() {
    if (filtered.length === 0) return;
    downloadCsv(`journal-scelle-${new Date().toISOString().slice(0, 10)}.csv`, buildLedgerCsv(filtered));
  }

  return (
    <div className="lg-screen">
      <FolioHeader
        badge="§6.5 · Art. 17"
        title={t('ledger.title')}
        subtitle={t('ledger.subtitle')}
        actions={
          <>
            <button type="button" className="btn-primary lg-verify" onClick={onVerifyClick} disabled={verifyQuery.isFetching}>
              <ShieldCheck size={16} aria-hidden="true" />
              {t('ledger.verify.cta')}
            </button>
            {/* Pas d'endpoint de page de journal dédiée côté API (voir HANDOFF.md) — bouton volontairement désactivé plutôt qu'une fausse destination. */}
            <button type="button" className="lg-page" disabled title={t('ledger.page.tooltip')}>
              <Table2 size={16} aria-hidden="true" />
              {t('ledger.page.label')}
            </button>
          </>
        }
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
        <>
          <div className="sheet lg-sheet">
            <div className="sheet-head">
              <span>
                {t('ledger.list.title')} ({nf(totalEntries)} {t('ledger.list.entriesSuffix')})
              </span>
              {verifyQuery.data ? (
                <Tag tone={verifyQuery.data.valid ? 'ok' : 'ko'}>
                  {verifyQuery.data.valid ? t('ledger.verify.valid') : `${t('ledger.verify.invalid')} (${verifyQuery.data.brokenAt ?? '?'})`}
                </Tag>
              ) : (
                <Tag tone="a">{t('ledger.verify.checking')}</Tag>
              )}
            </div>
            <div className="sheet-body flush">
              <TruncationNote truncated={listQuery.data?.truncated} shown={entries.length} total={listQuery.data?.total ?? 0} />
              <div className="lg-filters">
                <select
                  className="lg-select"
                  value={typeFilter}
                  aria-label={t('ledger.filter.allTypes')}
                  onChange={(e) => {
                    setTypeFilter(e.target.value);
                    setPage(1);
                  }}
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
                <label className="lg-search">
                  <Search size={15} aria-hidden="true" />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                    aria-label={t('ledger.search.placeholder')}
                    placeholder={t('ledger.search.placeholder')}
                  />
                </label>
                <div className="lg-range" role="group" aria-label={t('ledger.filter.range')}>
                  <label htmlFor="ledger-from">{t('ledger.filter.from')}</label>
                  <input
                    id="ledger-from"
                    type="date"
                    value={from}
                    onChange={(e) => {
                      setFrom(e.target.value);
                      setPage(1);
                    }}
                  />
                  <label htmlFor="ledger-to">{t('ledger.filter.to')}</label>
                  <input
                    id="ledger-to"
                    type="date"
                    value={to}
                    onChange={(e) => {
                      setTo(e.target.value);
                      setPage(1);
                    }}
                  />
                </div>
                <button type="button" className="lg-export" onClick={onExport} disabled={filtered.length === 0} title={t('ledger.export.note')}>
                  <Download size={15} aria-hidden="true" />
                  {t('ledger.export.button')}
                </button>
              </div>

              {pageRows.length === 0 ? (
                <p className="lg-empty">{t('common.noData')}</p>
              ) : (
                <ul className="lg-list">
                  {pageRows.map((entry) => (
                    <li key={entry.id} className="lg-row">
                      <LedgerTypeIcon type={entry.type} />
                      <div className="lg-main">
                        <p className="lg-title">
                          <span className="lg-seq">#{entry.seq}</span> <strong>
                            {formatTypeLabel(entry.type)} · <span className="mono">{entry.ref}</span>
                          </strong>
                        </p>
                        <p className="lg-summary">
                          {formatSummary(entry.summary)} — {entry.actor}
                        </p>
                      </div>
                      <div className="lg-meta">
                        <div className="mono">{formatAt(entry.at, locale)}</div>
                        <div className="mono" title={`${t('ledger.hash.title')} : ${entry.hash} ← ${entry.prevHash ?? '—'}`}>
                          {shortHash(entry.hash, 10)} ← {shortHash(entry.prevHash, 6)}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <div className="pager">
                <span>
                  {filtered.length === 0 ? 0 : nf((page - 1) * PAGE_SIZE + 1)}–{nf(Math.min(page * PAGE_SIZE, filtered.length))} {t('common.of')} {nf(filtered.length)} · {t('common.page')}{' '}
                  {nf(page)} / {nf(pageCount)}
                </span>
                <div className="lg-pager-btns">
                  <button type="button" aria-label={t('common.previous')} disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
                  </button>
                  <button type="button" aria-label={t('common.next')} disabled={page >= pageCount} onClick={() => setPage(page + 1)}>
                    <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
