'use client';

import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolioHeader } from '@/components/FolioHeader';
import { Art14Panel } from '@/components/matching/Art14Panel';
import { apiErrorMessage } from '@/components/referential/fields';
import { CoChip } from '@/components/ui/CoChip';
import { isMaskedValue, MaskedValue } from '@/components/ui/Masked';
import { ScoreBar } from '@/components/ui/ScoreBar';
import { Tabs } from '@/components/ui/Tabs';
import { Table, Column } from '@/components/ui/Table';
import { Tag, TagTone } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { TranslationKey } from '@/i18n/translations';
import { apiGet, apiPath, apiPost } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { buildCsv, downloadCsv } from '@/lib/csv';
import {
  FeedMode,
  MATCH_TERMINAL_STATUSES,
  MatchCounters,
  MatchCriteria,
  MatchDecisionAction,
  MatchDecisionHistoryEntry,
  MatchDecisionResult,
  MatchFilter,
  MatchQueueItem,
  MatchStatus,
  MatchThresholds,
} from '@/lib/types';
import { Paginated } from '@/lib/types';

const PAGE_SIZE = 6; // pagination fixe 6/p — A.5

/**
 * Critères pondérés du score d'appariement (B.5) — libellés + poids
 * **d'affichage uniquement**. Le score final (`row.score`) vient toujours
 * de l'API ; rien n'est recalculé ici (règle d'or C.1). `sub` (2026-10-18) :
 * sous-description concordant/discordant — un simple constat booléen (pas de
 * distance/pourcentage inventés, l'algorithme réel n'a jamais été graduel,
 * voir `matching.scoring.ts` back : chaque critère pondéré donne son poids
 * plein ou zéro, jamais une valeur partielle).
 */
const CRITERIA_WEIGHTS: {
  key: keyof MatchCriteria;
  label: TranslationKey;
  weight: number;
  sub?: { ok: TranslationKey; ko: TranslationKey };
}[] = [
  { key: 'econstatPartage', label: 'matching.criteria.econstatPartage', weight: 0 },
  {
    key: 'plaquesCroisees',
    label: 'matching.criteria.plaquesCroisees',
    weight: 35,
    sub: { ok: 'matching.criteria.plaquesCroisees.ok', ko: 'matching.criteria.plaquesCroisees.ko' },
  },
  {
    key: 'policeCroisee',
    label: 'matching.criteria.policeCroisee',
    weight: 15,
    sub: { ok: 'matching.criteria.policeCroisee.ok', ko: 'matching.criteria.policeCroisee.ko' },
  },
  {
    key: 'dateHeure',
    label: 'matching.criteria.dateHeure',
    weight: 15,
    sub: { ok: 'matching.criteria.dateHeure.ok', ko: 'matching.criteria.dateHeure.ko' },
  },
  {
    key: 'compagniesCroisees',
    label: 'matching.criteria.compagniesCroisees',
    weight: 10,
    sub: { ok: 'matching.criteria.compagniesCroisees.ok', ko: 'matching.criteria.compagniesCroisees.ko' },
  },
  {
    key: 'gps',
    label: 'matching.criteria.gps',
    weight: 10,
    sub: { ok: 'matching.criteria.gps.ok', ko: 'matching.criteria.gps.ko' },
  },
];

const CANAL_LABEL: Record<FeedMode, TranslationKey> = {
  ERP: 'matching.canal.ERP',
  ECONSTAT: 'matching.canal.ECONSTAT',
  IMPORT: 'matching.canal.IMPORT',
  API: 'matching.canal.API',
};

const ACTION_LABEL: Record<MatchDecisionAction, TranslationKey> = {
  confirm: 'matching.history.action.confirm',
  reject: 'matching.history.action.reject',
  complement: 'matching.history.action.complement',
  link: 'matching.history.action.link',
};

/** Libellé d'un canal de déclaration — `masqué` si la valeur est masquée (SEC-03), `—` si absente ou inconnue. */
function canalLabel(value: string | undefined, t: (key: TranslationKey) => string): string {
  if (isMaskedValue(value)) return t('common.masked');
  const key = value ? CANAL_LABEL[value as FeedMode] : undefined;
  return key ? t(key) : t('matching.vehicle.unknown');
}

/** Valeur texte d'une carte : « masqué » pour une valeur masquée, repli pour une valeur absente. */
function shown(value: string | undefined, fallback: string, t: (key: TranslationKey) => string): string {
  if (isMaskedValue(value)) return t('common.masked');
  return value ?? fallback;
}

function statusTone(status: MatchStatus): TagTone {
  if (status === 'AUTO_CONFIRME' || status === 'CONFIRME_MANUEL') return 'ok';
  if (status === 'A_CONFIRMER') return 'warn';
  if (status === 'REJETE') return 'ko';
  return 'a';
}

/** Formatage d'affichage d'une date ISO simple (AAAA-MM-JJ) — `—` si absente/invalide, jamais une valeur fabriquée. */
function formatDate(value: string | undefined, locale: string): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(locale);
}

/**
 * Carte de confrontation champ par champ (section additive "Vue de
 * confrontation", 2026-10-18) — badge Concordant/Discordant calculé par
 * l'appelant à partir des VRAIES valeurs A/B (jamais fabriqué ici).
 */
function ConfrontationCard({
  label,
  valueA,
  valueB,
  concordant,
  okLabel,
  koLabel,
  activeParty,
}: {
  label: string;
  valueA: string;
  valueB: string;
  concordant: boolean;
  okLabel: string;
  koLabel: string;
  /** Bascule "Partie A / Partie B" (section additive) — met en évidence la ligne de la partie
      active ; purement visuel, les deux valeurs réelles restent affichées dans tous les cas. */
  activeParty: 'A' | 'B';
}) {
  return (
    <div style={{ border: '1px solid var(--rule-strong)', borderRadius: 'var(--k-r-s)', padding: 'var(--s-3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--s-2)', gap: 6 }}>
        <strong style={{ fontSize: 'var(--k-fs-s)' }}>{label}</strong>
        <Tag tone={concordant ? 'ok' : 'ko'}>{concordant ? okLabel : koLabel}</Tag>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 'var(--k-fs-s)' }}>
        <span style={{ fontWeight: activeParty === 'A' ? 600 : 400 }}>
          <span style={{ color: 'var(--ink-3)' }}>A </span>
          <span className="mono">{valueA}</span>
        </span>
        <span style={{ fontWeight: activeParty === 'B' ? 600 : 400 }}>
          <span style={{ color: 'var(--ink-3)' }}>B </span>
          <span className="mono">{valueB}</span>
        </span>
      </div>
    </div>
  );
}

/**
 * Carte "Véhicule A/B" (section additive, 2026-10-18) — UNIQUEMENT les
 * champs réellement capturés par le modèle 47 colonnes (`claim-47-
 * columns.ts` back) : dossier, identité assuré, immatriculation, canal.
 * Volontairement PAS de "Conducteur" (nom du conducteur s'il diffère de
 * l'assuré — seul un booléen "conducteur = assuré" existe), PAS de
 * modèle de véhicule (seule la plaque est capturée), PAS de point de choc,
 * PAS de schéma d'accident (voir HANDOFF.md) — la référence montre ces
 * champs mais aucun n'existe dans le modèle de données réel.
 */
function VehicleCard({
  title,
  company,
  dossier,
  identite,
  plate,
  canalLabel,
  t,
  active,
}: {
  title: string;
  company: string;
  dossier: string;
  identite?: string;
  plate?: string;
  canalLabel: string;
  t: (key: TranslationKey) => string;
  /** Bascule "Partie A / Partie B" (section additive) — purement visuel (cadre renforcé). */
  active?: boolean;
}) {
  return (
    <div
      style={{
        border: active ? '2px solid var(--k-pri)' : '1px solid var(--rule-strong)',
        borderRadius: 'var(--k-r-s)',
        padding: 'var(--s-3)',
        flex: '1 1 260px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--s-3)' }}>
        <strong style={{ fontSize: 'var(--k-fs-s)' }}>{title}</strong>
        <CoChip code={company} />
      </div>
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 10px', margin: 0, fontSize: 'var(--k-fs-s)' }}>
        <dt style={{ color: 'var(--ink-3)' }}>{t('matching.vehicle.dossier')}</dt>
        <dd className="mono" style={{ margin: 0 }}>
          {dossier}
        </dd>
        <dt style={{ color: 'var(--ink-3)' }}>{t('matching.vehicle.identity')}</dt>
        <dd style={{ margin: 0 }}>
          <MaskedValue value={identite} />
        </dd>
        <dt style={{ color: 'var(--ink-3)' }}>{t('matching.vehicle.plate')}</dt>
        <dd style={{ margin: 0 }}>
          <MaskedValue value={plate} mono />
        </dd>
        <dt style={{ color: 'var(--ink-3)' }}>{t('matching.vehicle.canal')}</dt>
        <dd style={{ margin: 0 }}>{canalLabel}</dd>
      </dl>
    </div>
  );
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
  // Bascule "Partie A / Partie B" de la "Vue de confrontation" (section additive) — purement
  // visuelle (met en évidence une partie), aucune donnée supplémentaire n'existe à afficher.
  const [activeParty, setActiveParty] = useState<'A' | 'B'>('A');

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
  // SEC-28 : revenir sur une décision déjà prise exige un motif (400 MOTIF_REQUIS).
  const reasonRequired = !!selected && MATCH_TERMINAL_STATUSES.includes(selected.status);
  const reasonMissing = reasonRequired && rejectReason.trim() === '';

  const decisionsQuery = useQuery({
    queryKey: ['matching', 'decisions', selected?.id],
    queryFn: () => apiGet<MatchDecisionHistoryEntry[]>(apiPath`/matching/${selected!.id}/decisions`),
    enabled: !!selected,
  });

  const decideMutation = useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: MatchDecisionAction; reason?: string }) =>
      apiPost<MatchDecisionResult>(apiPath`/matching/${id}/decide`, { action, reason }),
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
    onError: (err) => {
      toast(apiErrorMessage(err, t('matching.toast.error'), t), 'ko');
    },
  });

  // Export CSV (A.3 : "⤓ Excel" de la capture) — généré depuis la file RÉELLEMENT chargée pour
  // le filtre courant (une page de 100, maximum autorisé par l'API — SEC-13), pas un classeur
  // Excel mis en forme (aucun endpoint d'export côté back pour cet écran, même limite
  // documentée que `/quarter` et `ledger.export.*` — voir HANDOFF.md).
  const exportMutation = useMutation({
    mutationFn: async () => {
      const res = await apiGet<Paginated<MatchQueueItem>>('/matching/queue', { filter, page: 1, pageSize: 100 });
      if (res.items.length === 0) throw new Error('EMPTY');
      const csv = buildCsv(
        [
          t('matching.col.ref'),
          t('matching.col.partyA'),
          t('matching.col.partyB'),
          t('matching.col.score'),
          t('matching.col.status'),
        ],
        res.items.map((r) => [r.refA, `${r.companyA} ${r.plateA}`, r.companyB ? `${r.companyB} ${r.plateB ?? ''}` : t('matching.noPartyB'), r.score, r.status]),
      );
      downloadCsv(`file-confrontation-${filter}.csv`, csv);
      return res.items.length;
    },
    onError: (err) => {
      toast(err instanceof Error && err.message === 'EMPTY' ? t('matching.export.empty') : apiErrorMessage(err, t('matching.toast.error'), t), 'ko');
    },
  });

  const decide = useCallback(
    (action: MatchDecisionAction) => {
      if (!selected || !canDecide || decideMutation.isPending || reasonMissing) return;
      decideMutation.mutate({ id: selected.id, action, reason: rejectReason.trim() || undefined });
    },
    [selected, canDecide, decideMutation, rejectReason, reasonMissing],
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
            <MaskedValue value={r.plateA} mono />
          </span>
        ),
      },
      {
        key: 'partyB',
        header: t('matching.col.partyB'),
        render: (r) =>
          r.companyB ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <CoChip code={r.companyB} />
              <MaskedValue value={r.plateB} mono />
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
          <div className="sheet-head">
            <span>{t('matching.queue.title')}</span>
            <button
              type="button"
              onClick={() => exportMutation.mutate()}
              disabled={exportMutation.isPending}
              style={{
                padding: '6px 14px',
                borderRadius: 'var(--k-r-s)',
                border: '1px solid var(--k-pri)',
                background: 'var(--k-pri)',
                color: '#fff',
                font: 'inherit',
                fontWeight: 400,
                cursor: exportMutation.isPending ? 'not-allowed' : 'pointer',
              }}
            >
              {t('matching.export.button')}
            </button>
          </div>
          <div className="sheet-body">
            <p style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)', marginTop: 0 }}>{t('matching.export.note')}</p>
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
                      <MaskedValue value={selected.plateA} mono />
                      <span className="mono" style={{ color: 'var(--ink-3)' }}>
                        {selected.refA}
                      </span>
                    </div>
                    {selected.companyB ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <CoChip code={selected.companyB} />
                        <MaskedValue value={selected.plateB} mono />
                        <span className="mono" style={{ color: 'var(--ink-3)' }}>
                          {selected.refB}
                        </span>
                      </div>
                    ) : (
                      <Tag tone="warn">{t('matching.noPartyB')}</Tag>
                    )}
                  </div>
                  {selected.masked ? (
                    <p className="note" role="note" style={{ fontSize: 'var(--k-fs-xs)', marginBottom: 0 }}>
                      {t('matching.masked.note')}
                    </p>
                  ) : null}
                </div>

                <div style={{ marginBottom: 'var(--s-4)' }}>
                  <strong style={{ display: 'block', marginBottom: 'var(--s-2)', fontSize: 'var(--k-fs-s)' }}>
                    {t('matching.panel.criteria')}
                  </strong>
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {CRITERIA_WEIGHTS.map((c) => {
                      const ok = selected.criteria[c.key];
                      if (!c.sub) {
                        // e-constat partagé — poids 0 (clé exacte, pas un critère composite) : tag OK/— inchangé.
                        return (
                          <li key={c.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 'var(--k-fs-s)' }}>
                            <span>{t(c.label)}</span>
                            <Tag tone={ok ? 'ok' : 'a'}>{ok ? 'OK' : '—'}</Tag>
                          </li>
                        );
                      }
                      // Critère pondéré (B.5) — fraction réelle poids/poids (ou 0/poids) : l'algorithme
                      // réel n'accorde jamais de crédit partiel (voir `MATCH_WEIGHTS`, matching.scoring.ts back).
                      return (
                        <li key={c.key} style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 'var(--k-fs-s)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>{t(c.label)}</span>
                            <span className="mono" style={{ color: ok ? 'var(--ok)' : 'var(--ko)', fontWeight: 600 }}>
                              {ok ? c.weight : 0}/{c.weight}
                            </span>
                          </div>
                          <span style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)' }}>{t(ok ? c.sub.ok : c.sub.ko)}</span>
                        </li>
                      );
                    })}
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
                  <p style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span>
                      {t('matching.decidedBy')}: {selected.confirmedBy}
                    </span>
                    {selected.confirmedByCompany && selected.confirmedByCompany !== 'PLACE' ? <CoChip code={selected.confirmedByCompany} /> : null}
                    {selected.confirmedAt ? <span>({new Date(selected.confirmedAt).toLocaleString(locale)})</span> : null}
                  </p>
                ) : null}

                {!canDecide ? <p className="note warn">{t('common.forbidden')}</p> : null}

                <label htmlFor="reject-reason" style={{ display: 'block', fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)', marginBottom: 4 }}>
                  {reasonRequired ? t('matching.action.reasonRequired') : t('matching.action.reason')}
                </label>
                <input
                  id="reject-reason"
                  type="text"
                  value={rejectReason}
                  maxLength={500}
                  required={reasonRequired}
                  aria-required={reasonRequired}
                  onChange={(e) => setRejectReason(e.target.value)}
                  disabled={!canDecide}
                  style={{ width: '100%', marginBottom: reasonMissing && canDecide ? 4 : 'var(--s-3)', padding: '6px 10px', border: '1px solid var(--rule-strong)', borderRadius: 'var(--k-r-s)', font: 'inherit', background: 'var(--paper)', color: 'var(--ink)' }}
                />
                {reasonMissing && canDecide ? (
                  <p style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)', marginTop: 0, marginBottom: 'var(--s-3)' }}>{t('matching.reason.requiredHint')}</p>
                ) : null}

                <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="tag ok"
                    style={{ cursor: canDecide && !reasonMissing ? 'pointer' : 'not-allowed', border: 'none' }}
                    disabled={!canDecide || decideMutation.isPending || reasonMissing}
                    onClick={() => decide('confirm')}
                    aria-label={t('matching.action.confirm')}
                  >
                    {t('matching.action.confirm')} (C)
                  </button>
                  <button
                    type="button"
                    className="tag ko"
                    style={{ cursor: canDecide && !reasonMissing ? 'pointer' : 'not-allowed', border: 'none' }}
                    disabled={!canDecide || decideMutation.isPending || reasonMissing}
                    onClick={() => decide('reject')}
                    aria-label={t('matching.action.reject')}
                  >
                    {t('matching.action.reject')} (R)
                  </button>
                  <button
                    type="button"
                    className="tag warn"
                    style={{ cursor: canDecide && !reasonMissing ? 'pointer' : 'not-allowed', border: 'none' }}
                    disabled={!canDecide || decideMutation.isPending || reasonMissing}
                    onClick={() => decide('complement')}
                    aria-label={t('matching.action.complement')}
                  >
                    {t('matching.action.complement')}
                  </button>
                </div>

                <DecisionHistory query={decisionsQuery} locale={locale} t={t} />
              </>
            )}
          </div>
        </aside>
      </div>

      <div className="sheet" style={{ marginTop: 'var(--s-5)' }}>
        <div className="sheet-head">
          <span>
            {t('matching.confrontation.title')}
            {selected?.refB ? (
              <>
                {' — '}
                <span className="mono">{selected.refA}</span> / <span className="mono">{selected.refB}</span>
              </>
            ) : null}
          </span>
          {selected?.refB ? (
            <div className="tabs" role="tablist" aria-label={t('matching.confrontation.title')}>
              <button type="button" role="tab" aria-selected={activeParty === 'A'} className="tab" onClick={() => setActiveParty('A')}>
                {t('matching.col.partyA')}
              </button>
              <button type="button" role="tab" aria-selected={activeParty === 'B'} className="tab" onClick={() => setActiveParty('B')}>
                {t('matching.col.partyB')}
              </button>
            </div>
          ) : null}
        </div>
        <div className="sheet-body">
          {!selected || !selected.refB ? (
            <p style={{ color: 'var(--ink-3)' }}>{t('matching.confrontation.empty')}</p>
          ) : (
            <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                  gap: 'var(--s-3)',
                  marginBottom: 'var(--s-5)',
                }}
              >
                <ConfrontationCard
                  label={t('matching.confrontation.field.econstat')}
                  valueA={selected.refA}
                  valueB={selected.refB}
                  concordant={selected.refA === selected.refB}
                  okLabel={t('matching.confrontation.badge.concordant')}
                  koLabel={t('matching.confrontation.badge.discordant')}
                  activeParty={activeParty}
                />
                <ConfrontationCard
                  label={t('matching.confrontation.field.accidentDate')}
                  valueA={formatDate(selected.accidentDateA, locale)}
                  valueB={formatDate(selected.accidentDateB, locale)}
                  concordant={!!selected.accidentDateA && selected.accidentDateA === selected.accidentDateB}
                  okLabel={t('matching.confrontation.badge.concordant')}
                  koLabel={t('matching.confrontation.badge.discordant')}
                  activeParty={activeParty}
                />
                <ConfrontationCard
                  label={t('matching.confrontation.field.wilaya')}
                  valueA={shown(selected.wilayaA, t('matching.confrontation.unknown'), t)}
                  valueB={shown(selected.wilayaB, t('matching.confrontation.unknown'), t)}
                  concordant={!!selected.wilayaA && selected.wilayaA === selected.wilayaB}
                  okLabel={t('matching.confrontation.badge.concordant')}
                  koLabel={t('matching.confrontation.badge.discordant')}
                  activeParty={activeParty}
                />
                {/* Immatriculations/polices croisées : le badge réutilise le booléen RÉEL déjà
                    calculé par l'algorithme (`criteria.*`, matching.scoring.ts back) plutôt qu'une
                    égalité naïve des valeurs affichées — `plateA`/`plateB` et `policeA`/`policeB`
                    sont chacun la valeur "soi-même" de SA déclaration (même convention), pas une
                    paire directement comparable ; le vrai croisement compare les deux ENSEMBLES
                    {plaque/police propre, plaque/police adverse déclarée} des deux côtés. */}
                <ConfrontationCard
                  label={t('matching.confrontation.field.plaques')}
                  valueA={shown(selected.plateA, t('matching.confrontation.unknown'), t)}
                  valueB={shown(selected.plateB, t('matching.confrontation.unknown'), t)}
                  concordant={selected.criteria.plaquesCroisees}
                  okLabel={t('matching.confrontation.badge.concordant')}
                  koLabel={t('matching.confrontation.badge.discordant')}
                  activeParty={activeParty}
                />
                <ConfrontationCard
                  label={t('matching.confrontation.field.police')}
                  valueA={shown(selected.policeA, t('matching.confrontation.unknown'), t)}
                  valueB={shown(selected.policeB, t('matching.confrontation.unknown'), t)}
                  concordant={selected.criteria.policeCroisee}
                  okLabel={t('matching.confrontation.badge.concordant')}
                  koLabel={t('matching.confrontation.badge.discordant')}
                  activeParty={activeParty}
                />
              </div>

              <div style={{ display: 'flex', gap: 'var(--s-3)', flexWrap: 'wrap' }}>
                <VehicleCard
                  title={t('matching.vehicle.titleA')}
                  company={selected.companyA}
                  dossier={selected.refA}
                  identite={selected.assureAIdentite}
                  plate={selected.plateA}
                  canalLabel={canalLabel(selected.canalDeclarationA, t)}
                  t={t}
                  active={activeParty === 'A'}
                />
                <VehicleCard
                  title={t('matching.vehicle.titleB')}
                  company={selected.companyB ?? '—'}
                  dossier={selected.refB}
                  identite={selected.assureBIdentite}
                  plate={selected.plateB}
                  canalLabel={canalLabel(selected.canalDeclarationB, t)}
                  t={t}
                  active={activeParty === 'B'}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {selected ? <Art14Panel key={selected.id} item={selected} /> : null}
    </>
  );
}

/** SEC-28 — historique des décisions d'une ligne (`GET /matching/:id/decisions`), ordre chronologique. */
function DecisionHistory({
  query,
  locale,
  t,
}: {
  query: { data?: MatchDecisionHistoryEntry[]; isLoading: boolean; error: unknown; refetch: () => unknown };
  locale: string;
  t: (key: TranslationKey) => string;
}) {
  const entries = query.data ?? [];
  return (
    <section aria-label={t('matching.history.title')} style={{ marginTop: 'var(--s-4)' }}>
      <strong style={{ display: 'block', marginBottom: 'var(--s-2)', fontSize: 'var(--k-fs-s)' }}>{t('matching.history.title')}</strong>
      {query.isLoading ? (
        <p style={{ fontSize: 'var(--k-fs-xs)' }}>{t('common.loading')}</p>
      ) : query.error ? (
        <div className="note ko" role="alert">
          <span>{t('common.error')}</span>
          <button type="button" onClick={() => query.refetch()}>
            {t('common.retry')}
          </button>
        </div>
      ) : entries.length === 0 ? (
        <p style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)', margin: 0 }}>{t('matching.history.empty')}</p>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {entries.map((d) => (
            <li key={d.id} style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)', borderInlineStart: '2px solid var(--rule-strong)', paddingInlineStart: 8 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <strong style={{ color: 'var(--ink)' }}>{ACTION_LABEL[d.action] ? t(ACTION_LABEL[d.action]) : d.action}</strong>
                <span className="mono">
                  {d.previousStatus} → {d.newStatus}
                </span>
              </div>
              <div>
                {new Date(d.decidedAt).toLocaleString(locale)} · {t('matching.history.by')} {d.decidedBy}
                {d.decidedByCompany ? ` (${d.decidedByCompany})` : ''}
              </div>
              {d.reason ? (
                <div>
                  {t('matching.history.reason')} : {d.reason}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
