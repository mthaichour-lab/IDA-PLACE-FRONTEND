'use client';

import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Check, Download, MessageSquareText, Minus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolioHeader } from '@/components/FolioHeader';
import { Art14Panel } from '@/components/matching/Art14Panel';
import { apiErrorMessage } from '@/components/referential/fields';
import { CoChip } from '@/components/ui/CoChip';
import { isMaskedValue, MaskedValue } from '@/components/ui/Masked';
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
 * plein ou zéro, jamais une valeur partielle). Les tolérances (± 60 min,
 * 2 km…) sont paramétrables côté back et ne sont pas exposées par l'API :
 * elles ne figurent donc pas dans les libellés.
 */
const CRITERIA_WEIGHTS: {
  key: keyof MatchCriteria;
  label: TranslationKey;
  weight: number;
  sub: { ok: TranslationKey; ko: TranslationKey };
}[] = [
  {
    key: 'econstatPartage',
    label: 'matching.criteria.econstatPartage',
    weight: 0,
    sub: { ok: 'matching.criteria.econstatPartage.ok', ko: 'matching.criteria.econstatPartage.ko' },
  },
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
    key: 'compagniesCroisees',
    label: 'matching.criteria.compagniesCroisees',
    weight: 10,
    sub: { ok: 'matching.criteria.compagniesCroisees.ok', ko: 'matching.criteria.compagniesCroisees.ko' },
  },
  {
    key: 'dateHeure',
    label: 'matching.criteria.dateHeure',
    weight: 15,
    sub: { ok: 'matching.criteria.dateHeure.ok', ko: 'matching.criteria.dateHeure.ko' },
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

const STATUS_LABEL: Record<MatchStatus, TranslationKey> = {
  A_CONFIRMER: 'matching.status.A_CONFIRMER',
  AUTO_CONFIRME: 'matching.status.AUTO_CONFIRME',
  CONFIRME_MANUEL: 'matching.status.CONFIRME_MANUEL',
  REJETE: 'matching.status.REJETE',
  COMPLEMENT: 'matching.status.COMPLEMENT',
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

/**
 * Pilule d'état d'une ligne : statut API traduit. Une ligne encore
 * `A_CONFIRMER` sans déclaration B (`refB` absent) est affichée « Non
 * apparié » — même règle que l'onglet `NON_APPARIES` côté back
 * (`matching.service.ts`, `refB: null`), aucune donnée inventée.
 */
function StatusPill({ row, t }: { row: MatchQueueItem; t: (key: TranslationKey) => string }) {
  if (row.status === 'A_CONFIRMER' && !row.refB) return <Tag tone="ko">{t('matching.status.NON_APPARIE')}</Tag>;
  const key = STATUS_LABEL[row.status];
  return <Tag tone={statusTone(row.status)}>{key ? t(key) : row.status}</Tag>;
}

/** Formatage d'affichage d'une date ISO simple (AAAA-MM-JJ) — `—` si absente/invalide, jamais une valeur fabriquée. */
function formatDate(value: string | undefined, locale: string): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Horodatage de réception d'une ligne de la file (`at`, API) : « 13 oct. 2026 10:56 ». */
function formatStamp(value: string, locale: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${d.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })} ${d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * Score d'appariement (valeur API, jamais recalculée) : nombre coloré
 * + « / 100 » + barre, avec deux repères aux seuils RÉELS
 * (`GET /matching/thresholds`). Couleur : ≥ seuil auto = primaire,
 * ≥ seuil à confirmer = orange, sinon rouge (neutre tant que les seuils
 * ne sont pas chargés).
 */
function ScoreMeter({ score, thresholds, t, wide = false }: { score: number; thresholds?: MatchThresholds; t: (key: TranslationKey) => string; wide?: boolean }) {
  const tone = !thresholds ? 'none' : score >= thresholds.autoThreshold ? 'ok' : score >= thresholds.confirmThreshold ? 'warn' : 'ko';
  const pct = Math.max(0, Math.min(100, score));
  return (
    <div className={`mt-score mt-score--${tone}${wide ? ' mt-score--wide' : ''}`}>
      <div className="mt-score-top">
        <span className="mt-score-val">{score}</span>
        <span className="mt-score-max">{t('matching.score.outOf')}</span>
      </div>
      <div className="mt-score-track" aria-hidden="true">
        <span className="mt-score-fill" style={{ width: `${pct}%` }} />
        {thresholds ? (
          <>
            <span className="mt-score-tick" style={{ insetInlineStart: `${thresholds.confirmThreshold}%` }} />
            <span className="mt-score-tick" style={{ insetInlineStart: `${thresholds.autoThreshold}%` }} />
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Valeur d'une partie (pastille A bleue / B jaune + lettre + valeur mono). */
function PartyValue({ party, value, strong }: { party: 'A' | 'B'; value: string; strong?: boolean }) {
  return (
    <span className={`mt-pv${strong ? ' is-active' : ''}`}>
      <span className={`mt-dot mt-dot--${party === 'A' ? 'a' : 'b'}`} aria-hidden="true" />
      <span className="mt-pv-tag">{party}</span>
      <span className="mono">{value}</span>
    </span>
  );
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
    <div className={`mt-cf ${concordant ? 'is-ok' : 'is-ko'}`}>
      <div className="mt-cf-head">
        <strong>{label}</strong>
        <span className={`mt-cf-badge ${concordant ? 'ok' : 'ko'}`}>
          {concordant ? <Check size={12} strokeWidth={2.4} aria-hidden="true" /> : <X size={12} strokeWidth={2.4} aria-hidden="true" />}
          {concordant ? okLabel : koLabel}
        </span>
      </div>
      <div className="mt-cf-values">
        <PartyValue party="A" value={valueA} strong={activeParty === 'A'} />
        <PartyValue party="B" value={valueB} strong={activeParty === 'B'} />
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
  party,
  company,
  dossier,
  identite,
  plate,
  canalLabel,
  t,
  active,
}: {
  title: string;
  party: 'A' | 'B';
  company?: string;
  dossier: string;
  identite?: string;
  plate?: string;
  canalLabel: string;
  t: (key: TranslationKey) => string;
  /** Bascule "Partie A / Partie B" (section additive) — purement visuel (cadre renforcé). */
  active?: boolean;
}) {
  return (
    <div className={`mt-veh${active ? ' is-active' : ''}`}>
      <div className="mt-veh-head">
        <span className={`mt-dot mt-dot--${party === 'A' ? 'a' : 'b'}`} aria-hidden="true" />
        <strong>{title}</strong>
        {company ? <CoChip code={company} /> : <span className="mt-muted">—</span>}
      </div>
      <dl className="mt-veh-dl">
        <dt>{t('matching.vehicle.dossier')}</dt>
        <dd className="mono">{dossier}</dd>
        <dt>{t('matching.vehicle.identity')}</dt>
        <dd>
          <MaskedValue value={identite} />
        </dd>
        <dt>{t('matching.vehicle.plate')}</dt>
        <dd>
          <MaskedValue value={plate} mono />
        </dd>
        <dt>{t('matching.vehicle.canal')}</dt>
        <dd>{canalLabel}</dd>
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
  const thresholds = thresholdsQuery.data;

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
  // documentée que `/quarter` et `ledger.export.*` — voir HANDOFF.md). Le format est expliqué
  // dans l'infobulle du bouton (`matching.export.note`).
  const exportMutation = useMutation({
    mutationFn: async () => {
      const res = await apiGet<Paginated<MatchQueueItem>>('/matching/queue', { filter, page: 1, pageSize: 100 });
      if (res.items.length === 0) throw new Error('EMPTY');
      const csv = buildCsv(
        [
          t('matching.col.ref'),
          t('matching.confrontation.field.econstat'),
          t('matching.col.partyA'),
          t('matching.col.partyB'),
          t('matching.col.score'),
          t('matching.col.status'),
        ],
        res.items.map((r) => [r.reference, r.refA, `${r.companyA} ${r.plateA}`, r.companyB ? `${r.companyB} ${r.plateB ?? ''}` : t('matching.noPartyB'), r.score, r.status]),
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
      {
        key: 'refA',
        header: t('matching.col.ref'),
        render: (r) => (
          <span className="mt-ref">
            <span className="mono mt-ref-id" title={r.id}>
              {r.reference}
            </span>
            <span className="mono mt-ref-at">{formatStamp(r.at, locale)}</span>
          </span>
        ),
      },
      {
        key: 'partyA',
        header: t('matching.col.partyA'),
        render: (r) => (
          <span className="mt-party">
            <span className="mt-party-co">
              <span className="mt-dot mt-dot--a" aria-hidden="true" />
              <CoChip code={r.companyA} />
            </span>
            <span className="mt-party-plate">
              <MaskedValue value={r.plateA} mono />
            </span>
          </span>
        ),
      },
      {
        key: 'partyB',
        header: t('matching.col.partyB'),
        render: (r) =>
          r.companyB ? (
            <span className="mt-party">
              <span className="mt-party-co">
                <span className="mt-dot mt-dot--b" aria-hidden="true" />
                <CoChip code={r.companyB} />
              </span>
              <span className="mt-party-plate">
                <MaskedValue value={r.plateB} mono />
              </span>
            </span>
          ) : (
            <span className="mt-party-pending">{t('matching.partyB.pending')}</span>
          ),
      },
      { key: 'score', header: t('matching.col.score'), render: (r) => <ScoreMeter score={r.score} thresholds={thresholds} t={t} /> },
      { key: 'status', header: t('matching.col.status'), render: (r) => <StatusPill row={r} t={t} /> },
    ],
    [t, locale, thresholds],
  );

  const decisionDisabled = !canDecide || decideMutation.isPending || reasonMissing;

  const subtitle = thresholds
    ? `${t('matching.subtitle')} ${t('matching.subtitle.thresholds')} ${t('matching.subtitle.auto')} ≥ ${thresholds.autoThreshold} · ${t('matching.subtitle.confirm')} ≥ ${thresholds.confirmThreshold}.`
    : t('matching.subtitle');

  return (
    <div className="mt-screen">
      <FolioHeader badge="Module A · §6.3" title={t('matching.title')} subtitle={subtitle} />

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

      <div className="grid mt-grid">
        <div className="sheet mt-queue">
          <div className="sheet-head">
            <span>{t('matching.queue.title')}</span>
            <button
              type="button"
              className="mt-ghost"
              onClick={() => exportMutation.mutate()}
              disabled={exportMutation.isPending}
              aria-label={t('matching.export.aria')}
              title={t('matching.export.note')}
            >
              <Download size={14} strokeWidth={2} aria-hidden="true" />
              {t('matching.export.button')}
            </button>
          </div>
          <div className="sheet-body flush">
            {queueQuery.isLoading ? (
              <p className="pad">{t('common.loading')}</p>
            ) : queueQuery.error ? (
              <div className="pad">
                <div className="note ko" role="alert">
                  <span>{t('common.error')}</span>
                  <button type="button" onClick={() => queueQuery.refetch()}>
                    {t('common.retry')}
                  </button>
                </div>
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
                selectedKey={selectedId ?? undefined}
              />
            )}
          </div>
        </div>

        <aside className="sheet mt-panel" aria-label={t('matching.panel.title')}>
          <div className="sheet-head">
            <span>
              {t('matching.panel.titleFor')}
              {selected ? (
                <>
                  {' '}
                  <span className="mono mt-panel-id" title={selected.id}>
                    {selected.reference}
                  </span>
                </>
              ) : null}
            </span>
          </div>
          <div className="sheet-body">
            {!selected ? (
              <p className="mt-muted">{t('matching.panel.empty')}</p>
            ) : (
              <>
                <div className="mt-panel-score">
                  <ScoreMeter score={selected.score} thresholds={thresholds} t={t} wide />
                  <StatusPill row={selected} t={t} />
                </div>

                {selected.masked ? (
                  <p className="note mt-note" role="note">
                    {t('matching.masked.note')}
                  </p>
                ) : null}

                <ul className="mt-crit" aria-label={t('matching.panel.criteria')}>
                  {CRITERIA_WEIGHTS.map((c) => {
                    const ok = selected.criteria[c.key];
                    // Sans déclaration B, aucun critère n'a pu être comparé : icône « − » neutre
                    // (pas de verdict ✗ trompeur), valeur réelle 0/poids conservée.
                    const pending = !selected.refB;
                    const state = pending ? 'pending' : ok ? 'ok' : 'ko';
                    return (
                      <li key={c.key} className={`mt-crit-item is-${state}`}>
                        <span className="mt-crit-icon" aria-hidden="true">
                          {state === 'ok' ? <Check size={15} strokeWidth={2.2} /> : state === 'ko' ? <X size={15} strokeWidth={2.2} /> : <Minus size={15} strokeWidth={2.2} />}
                        </span>
                        <span className="mt-crit-body">
                          <span className="mt-crit-label">{t(c.label)}</span>
                          <span className="mt-crit-sub">{pending ? t('matching.criteria.pending') : t(ok ? c.sub.ok : c.sub.ko)}</span>
                        </span>
                        {/* Critère pondéré (B.5) — fraction réelle poids/poids (ou 0/poids) : l'algorithme
                            réel n'accorde jamais de crédit partiel (voir `MATCH_WEIGHTS`, matching.scoring.ts back).
                            e-constat partagé : poids 0, c'est la clé exacte (score 100 d'office). */}
                        <span className="mt-crit-val">{c.weight === 0 ? t('matching.criteria.exactKey') : `${ok ? c.weight : 0}/${c.weight}`}</span>
                      </li>
                    );
                  })}
                </ul>

                {selected.status === 'REJETE' && selected.rejectReason ? (
                  <p className="note ko mt-note">
                    {t('matching.rejectReason')}: {selected.rejectReason}
                  </p>
                ) : null}

                {selected.confirmedBy ? (
                  <p className="mt-decided">
                    <span>
                      {t('matching.decidedBy')}: {selected.confirmedBy}
                    </span>
                    {selected.confirmedByCompany && selected.confirmedByCompany !== 'PLACE' ? <CoChip code={selected.confirmedByCompany} /> : null}
                    {selected.confirmedAt ? <span>({new Date(selected.confirmedAt).toLocaleString(locale)})</span> : null}
                  </p>
                ) : null}

                {!canDecide ? <p className="note warn mt-note">{t('common.forbidden')}</p> : null}

                <label htmlFor="reject-reason" className="mt-reason-label">
                  {reasonRequired ? t('matching.action.reasonRequired') : t('matching.action.reason')}
                </label>
                <input
                  id="reject-reason"
                  className="mt-reason"
                  type="text"
                  value={rejectReason}
                  maxLength={500}
                  required={reasonRequired}
                  aria-required={reasonRequired}
                  onChange={(e) => setRejectReason(e.target.value)}
                  disabled={!canDecide}
                />
                {reasonMissing && canDecide ? <p className="mt-reason-hint">{t('matching.reason.requiredHint')}</p> : null}

                <div className="mt-actions">
                  <button type="button" className="btn-primary mt-btn" disabled={decisionDisabled} onClick={() => decide('confirm')}>
                    <Check size={16} strokeWidth={2.2} aria-hidden="true" />
                    {t('matching.action.confirmMatch')}
                  </button>
                  <button type="button" className="mt-btn mt-btn-danger" disabled={decisionDisabled} onClick={() => decide('reject')}>
                    <X size={16} strokeWidth={2.2} aria-hidden="true" />
                    {t('matching.action.reject')}
                  </button>
                  <button type="button" className="mt-btn mt-btn-soft" disabled={decisionDisabled} onClick={() => decide('complement')}>
                    <MessageSquareText size={16} strokeWidth={2} aria-hidden="true" />
                    {t('matching.action.requestComplement')}
                  </button>
                </div>

                <DecisionHistory query={decisionsQuery} locale={locale} t={t} />
              </>
            )}
          </div>
        </aside>
      </div>

      <section className="sheet mt-conf" aria-label={t('matching.confrontation.title')}>
        <div className="sheet-head">
          <span>
            {t('matching.confrontation.title')}
            {selected?.refB ? (
              <>
                {' — '}
                <span className="mono mt-conf-id">{selected.refA}</span> / <span className="mono mt-conf-id">{selected.refB}</span>
              </>
            ) : null}
          </span>
          {selected?.refB ? (
            <div className="mt-party-toggle" role="tablist" aria-label={t('matching.confrontation.title')}>
              <button type="button" role="tab" aria-selected={activeParty === 'A'} onClick={() => setActiveParty('A')}>
                {t('matching.col.partyA')}
              </button>
              <button type="button" role="tab" aria-selected={activeParty === 'B'} onClick={() => setActiveParty('B')}>
                {t('matching.col.partyB')}
              </button>
            </div>
          ) : null}
        </div>
        <div className="sheet-body">
          {!selected || !selected.refB ? (
            <p className="mt-muted">{t('matching.confrontation.empty')}</p>
          ) : (
            <>
              <div className="mt-conf-key">
                <h3>{t('matching.confrontation.key')}</h3>
                <div className="mt-conf-score">
                  <ScoreMeter score={selected.score} thresholds={thresholds} t={t} wide />
                  <StatusPill row={selected} t={t} />
                </div>
              </div>
              <div className="mt-cf-grid">
                <ConfrontationCard
                  label={t('matching.confrontation.field.econstat')}
                  valueA={selected.refA}
                  valueB={selected.refB}
                  concordant={selected.refA === selected.refB}
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

              <div className="mt-actions mt-conf-actions">
                <button type="button" className="btn-primary mt-btn" disabled={decisionDisabled} onClick={() => decide('confirm')}>
                  <Check size={16} strokeWidth={2.2} aria-hidden="true" />
                  {t('matching.action.confirmMatch')}
                </button>
                <button type="button" className="mt-btn mt-btn-danger" disabled={decisionDisabled} onClick={() => decide('reject')}>
                  <X size={16} strokeWidth={2.2} aria-hidden="true" />
                  {t('matching.action.reject')}
                </button>
              </div>
            </>
          )}
          <p className="mt-shortcuts">{t('matching.shortcuts.hint')}</p>

          {selected?.refB ? (
            <div className="mt-veh-grid">
              <VehicleCard
                title={t('matching.vehicle.titleA')}
                party="A"
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
                party="B"
                company={selected.companyB}
                dossier={selected.refB}
                identite={selected.assureBIdentite}
                plate={selected.plateB}
                canalLabel={canalLabel(selected.canalDeclarationB, t)}
                t={t}
                active={activeParty === 'B'}
              />
            </div>
          ) : null}
        </div>
      </section>

      {selected ? <Art14Panel key={selected.id} item={selected} /> : null}
    </div>
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
    <section aria-label={t('matching.history.title')} className="mt-history">
      <strong className="mt-history-title">{t('matching.history.title')}</strong>
      {query.isLoading ? (
        <p className="mt-history-empty">{t('common.loading')}</p>
      ) : query.error ? (
        <div className="note ko" role="alert">
          <span>{t('common.error')}</span>
          <button type="button" onClick={() => query.refetch()}>
            {t('common.retry')}
          </button>
        </div>
      ) : entries.length === 0 ? (
        <p className="mt-history-empty">{t('matching.history.empty')}</p>
      ) : (
        <ol className="mt-history-list">
          {entries.map((d) => (
            <li key={d.id}>
              <div className="mt-history-row">
                <strong>{ACTION_LABEL[d.action] ? t(ACTION_LABEL[d.action]) : d.action}</strong>
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
