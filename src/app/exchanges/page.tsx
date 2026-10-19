'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { FolioHeader } from '@/components/FolioHeader';
import { AttachmentsPanel } from '@/components/documents/AttachmentsPanel';
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
import { ApiError } from '@/lib/api-error';
import { useAuth } from '@/lib/auth-context';
import { useRealtime } from '@/lib/realtime';
import {
  OppositionMotif,
  Paginated,
  RecoursAction,
  RecoursFilter,
  RecoursItem,
  RecoursState,
  RecoursTransitionResult,
  SettlementQuarterClosure,
  RECOURS_ALLOWED_ACTIONS,
} from '@/lib/types';

const PAGE_SIZE = 6; // pagination fixe 6/p — A.5

// Idiome "récupérer tout côté client pour reclasser/re-paginer localement" déjà
// utilisé par /monitoring (journeys d'une compagnie) et /fraude — même ordre
// de grandeur, pas une convention inventée ici.
const FETCH_ALL_PAGE_SIZE = 100_000;

/**
 * Sous-onglets du filtre REGLE (écran 4 "Échanges Annexes 2/3/4", guide
 * illustré) — "Accepté/silence" vs "Réglé/compensé". Décision Product Owner
 * 2026-10-18 : les DEUX atteignent le même état backend `REGLE`
 * (`RECOURS_STATES`) ; aucune de ces deux étiquettes n'est un état/filtre
 * backend. La distinction est PUREMENT TEMPORELLE et calculée ICI, côté
 * client uniquement : un recours réglé (`settledAt`) appartient au trimestre
 * `quarterOf(settledAt)` ; si CE trimestre a déjà été clôturé (présent dans
 * `GET /settlement/quarter/closures`), le recours est "Réglé/compensé",
 * sinon "Accepté/silence" (réglé, en attente de la prochaine compensation
 * trimestrielle). Ne JAMAIS envoyer cette distinction comme valeur de
 * `filter` à l'API — `RecoursFilter` (back) ne connaît et ne doit connaître
 * que les 7 vrais états + 'TOUS'.
 */
type RegleSubTab = 'SILENCE' | 'COMPENSATED';

/**
 * Trimestre AAAA-Qn d'une date ISO — DOIT rester IDENTIQUE à
 * `isIsoDateInQuarter` (back `settlement.rules.ts`) : UTC, pas de fuseau
 * local, sinon le croisement avec `/settlement/quarter/closures` serait
 * incohérent avec ce que le back considère réellement comme clôturé.
 */
function quarterOf(iso: string): string {
  const d = new Date(iso);
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${d.getUTCFullYear()}-Q${q}`;
}

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
  { key: 'REGLE', label: 'exchanges.tab.regle' },
  { key: 'REJETE', label: 'exchanges.tab.rejete' },
  { key: 'FORCLOS', label: 'exchanges.tab.forclos' },
];

/** Libellé d'affichage d'un `resolution.kind` (B.3 RecoursModule) — valeurs exactes, voir recours.rules.ts back. */
const RESOLUTION_LABELS: Record<string, TranslationKey> = {
  ACCEPTATION_EXPRESSE: 'exchanges.detail.timeline.resolution.ACCEPTATION_EXPRESSE',
  ACCEPTATION_TACITE_ART10: 'exchanges.detail.timeline.resolution.ACCEPTATION_TACITE_ART10',
  OPPOSITION_LEVEE: 'exchanges.detail.timeline.resolution.OPPOSITION_LEVEE',
  OPPOSITION_FONDEE_ART12: 'exchanges.detail.timeline.resolution.OPPOSITION_FONDEE_ART12',
  DECISION_COMMISSION_FAVORABLE: 'exchanges.detail.timeline.resolution.DECISION_COMMISSION_FAVORABLE',
  DECISION_COMMISSION_DEFAVORABLE: 'exchanges.detail.timeline.resolution.DECISION_COMMISSION_DEFAVORABLE',
  FORCLUSION_ART19: 'exchanges.detail.timeline.resolution.FORCLUSION_ART19',
};

interface TimelineEntry {
  key: string;
  label: TranslationKey;
  at: string;
  reason?: string;
}

/**
 * Fil d'échanges reconstruit à partir des champs RÉELLEMENT persistés
 * (`requestSentAt`/`opposition`/`contestation`/`commissionAt`/`resolution`)
 * — pas un historique de transitions à part entière (`RecoursController`
 * n'expose aucun endpoint dédié, voir HANDOFF.md), mais chaque étape vraiment
 * survenue est reconstituée honnêtement, triée chronologiquement.
 */
function buildTimeline(r: RecoursItem, motifLabels: Map<string, string>): TimelineEntry[] {
  const entries: TimelineEntry[] = [{ key: 'annexe2', label: 'exchanges.detail.timeline.annexe2', at: r.requestSentAt }];
  if (r.opposition) {
    const code = r.opposition.reasonCode;
    const reason = [code ? motifLabels.get(code) ?? code : undefined, r.opposition.reason].filter(Boolean).join(' — ');
    entries.push({ key: 'annexe3', label: 'exchanges.detail.timeline.annexe3', at: r.opposition.raisedAt, reason: reason || undefined });
  }
  if (r.contestation) entries.push({ key: 'annexe4', label: 'exchanges.detail.timeline.annexe4', at: r.contestation.raisedAt, reason: r.contestation.reason });
  if (r.commissionAt) entries.push({ key: 'commission', label: 'exchanges.detail.timeline.commission', at: r.commissionAt });
  if (r.resolution) {
    const label = RESOLUTION_LABELS[r.resolution.kind];
    if (label) entries.push({ key: 'resolution', label, at: r.resolution.at, reason: r.resolution.note });
  }
  return entries.sort((a, b) => a.at.localeCompare(b.at));
}

function stateTone(state: RecoursState): TagTone {
  if (state === 'FORCLOS' || state === 'REJETE') return 'ko';
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

function recoursQuery(filter: RecoursFilter, page: number, q: string) {
  return { filter, page, pageSize: PAGE_SIZE, q: q || undefined };
}

export default function ExchangesPage() {
  const { t, locale } = useI18n();
  const { hasPrivilege } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<RecoursFilter>('TOUS');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<RecoursItem | null>(null);

  // Sous-onglets REGLE (voir commentaire `RegleSubTab` plus haut) — état
  // purement local à cet écran, jamais transmis à l'API.
  const [regleSubTab, setRegleSubTab] = useState<RegleSubTab>('SILENCE');
  const [reglePage, setReglePage] = useState(1);
  const isRegleFilter = filter === 'REGLE';

  const canTransition = hasPrivilege('exchange');

  const countersQuery = useQuery({
    queryKey: ['recours', 'counters'],
    queryFn: () => apiGet<Record<string, number>>('/recours/counters'),
    refetchInterval: POLL_INTERVAL_MS,
  });

  // Pagination serveur normale (A.5) — pour tous les onglets SAUF REGLE,
  // dont le comportement change ci-dessous (voir `regleAllQuery`).
  const listQuery = useQuery({
    queryKey: ['recours', 'list', filter, page, search],
    queryFn: () => apiGet<Paginated<RecoursItem>>('/recours', recoursQuery(filter, page, search)),
    refetchInterval: POLL_INTERVAL_MS,
    enabled: !isRegleFilter,
  });

  /**
   * Onglet REGLE : il faut voir la population COMPLÈTE avant de pouvoir la
   * reclasser "Accepté/silence" / "Réglé/compensé" puis la re-paginer côté
   * client (A.5 — 6 lignes/page — s'applique à CHACUN des deux sous-onglets,
   * pas à l'ensemble REGLE non trié). D'où un fetch "tout" dédié (même idiome
   * que /monitoring et /fraude), au lieu de la page serveur de 6 lignes de
   * `listQuery` ci-dessus. `q` (recherche libre) continue d'être envoyé au
   * back — seule la pagination change.
   */
  const regleAllQuery = useQuery({
    queryKey: ['recours', 'list', 'REGLE', 'all', search],
    queryFn: () => apiGet<Paginated<RecoursItem>>('/recours', { filter: 'REGLE', page: 1, pageSize: FETCH_ALL_PAGE_SIZE, q: search || undefined }),
    refetchInterval: POLL_INTERVAL_MS,
    enabled: isRegleFilter,
  });

  /**
   * Toutes les clôtures trimestrielles jamais enregistrées (place entière,
   * sans filtre — voir `SettlementQuarterClosure`).
   *
   * Revue Testeur (2026-10-18) : `staleTime` seul ne suffit PAS ici — il ne
   * fait que dire qu'une valeur en cache peut être réutilisée sans
   * reconfirmation, il ne déclenche aucun re-fetch en arrière-plan tant que
   * le composant reste monté sans remount/refocus. Un opérateur resté sur
   * `/exchanges` pendant qu'un trimestre est clôturé ailleurs (autre onglet,
   * autre session) voyait donc un classement "Accepté/silence" figé
   * indéfiniment sans rechargement manuel — confirmé en vérification réelle
   * (`read_network_requests` sur 30s : `recours?filter=REGLE` re-interrogé,
   * `settlement/quarter/closures` jamais). Même `refetchInterval` que les
   * autres requêtes de cet écran (`listQuery`/`regleAllQuery`/
   * `countersQuery`) — référentiel à faible churn, mais pas figé pour
   * autant : une clôture peut survenir à tout moment pendant qu'on regarde
   * cet écran.
   */
  const closuresQuery = useQuery({
    queryKey: ['settlement', 'quarter', 'closures'],
    queryFn: () => apiGet<SettlementQuarterClosure[]>('/settlement/quarter/closures'),
    refetchInterval: POLL_INTERVAL_MS,
  });

  const closedQuarters = useMemo(() => new Set((closuresQuery.data ?? []).map((c) => c.period)), [closuresQuery.data]);

  /**
   * Classification CLIENT-SIDE (voir commentaire `RegleSubTab`) : un recours
   * REGLE sans `settledAt` (ne devrait pas arriver en pratique, mais rien ne
   * le garantit côté contrat) atterrit dans "Accepté/silence" plutôt que de
   * planter ou de fabriquer une date — on ne peut pas affirmer qu'il est
   * compensé sans savoir de quel trimestre il relève.
   */
  const { silenceItems, compensatedItems } = useMemo(() => {
    const silence: RecoursItem[] = [];
    const compensated: RecoursItem[] = [];
    for (const item of regleAllQuery.data?.items ?? []) {
      if (item.settledAt && closedQuarters.has(quarterOf(item.settledAt))) {
        compensated.push(item);
      } else {
        silence.push(item);
      }
    }
    return { silenceItems: silence, compensatedItems: compensated };
  }, [regleAllQuery.data, closedQuarters]);

  const regleActiveItems = regleSubTab === 'SILENCE' ? silenceItems : compensatedItems;
  const reglePageItems = useMemo(() => regleActiveItems.slice((reglePage - 1) * PAGE_SIZE, reglePage * PAGE_SIZE), [regleActiveItems, reglePage]);

  const onRealtimeEvent = useCallback(() => {
    void listQuery.refetch();
    void regleAllQuery.refetch();
    void countersQuery.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useRealtime(['recours.timer'], onRealtimeEvent);

  const items = isRegleFilter ? reglePageItems : listQuery.data?.items ?? [];

  const [reason, setReason] = useState('');

  /**
   * Action « opposer » (décision PO §1) : tant qu'aucun motif admis
   * (`forbidden=false`) n'existe au catalogue, motif libre + attestation
   * obligatoire « pas une non-déclaration » ; sinon liste déroulante
   * obligatoire, le motif interdit restant visible mais grisé. `reasonCode`
   * n'est envoyé que si un motif est choisi.
   */
  const [opposing, setOpposing] = useState(false);
  const [reasonCode, setReasonCode] = useState('');
  const [attested, setAttested] = useState(false);

  const motifsQuery = useQuery({
    queryKey: ['referential', 'opposition-motifs'],
    queryFn: () => apiGet<OppositionMotif[]>('/referential/opposition-motifs'),
    enabled: !!selected,
  });
  // Catalogue indisponible (erreur) : même repli que le catalogue vide — motif libre + attestation.
  const motifs = motifsQuery.data ?? [];
  const hasAdmittedMotifs = motifs.some((m) => !m.forbidden);
  const motifLabels = useMemo(() => new Map(motifs.map((m) => [m.code, m.label])), [motifs]);

  function resetOpposition() {
    setOpposing(false);
    setReasonCode('');
    setAttested(false);
  }

  function openRecours(r: RecoursItem | null) {
    setSelected(r);
    setReason('');
    resetOpposition();
  }

  const transitionMutation = useMutation({
    mutationFn: ({ id, action, reason: r, reasonCode: code }: { id: string; action: RecoursAction; reason?: string; reasonCode?: string }) =>
      apiPost<RecoursTransitionResult>(`/recours/${id}/transition`, { action, reason: r || undefined, reasonCode: code || undefined }),
    onSuccess: async (result, variables) => {
      // Rafraîchit la fiche complète (opposition/contestation/resolution) plutôt que de
      // ne retenir que {state, timer} — nécessaire pour que le fil d'échanges reconstruit
      // (`buildTimeline`) reflète immédiatement la nouvelle étape.
      const fresh = await apiGet<RecoursItem>(`/recours/${variables.id}`);
      setSelected((prev) => (prev && prev.id === variables.id ? fresh : prev));
      setReason('');
      resetOpposition();
      toast(t('exchanges.detail.transition.toast.ok'), 'ok');
      void queryClient.invalidateQueries({ queryKey: ['recours'] });
    },
    onError: (err: unknown) => {
      // Message du backend s'il existe (ex. 400 « motif interdit — Art. 10 »).
      toast(err instanceof ApiError && err.message ? err.message : t('exchanges.detail.transition.toast.error'), 'ko');
    },
  });

  function changeFilter(next: string) {
    setFilter(next as RecoursFilter);
    setPage(1);
    // Repart toujours sur "Accepté/silence" page 1 en entrant/quittant REGLE —
    // même logique de remise à zéro que `page` ci-dessus.
    setRegleSubTab('SILENCE');
    setReglePage(1);
  }

  function changeRegleSubTab(next: string) {
    setRegleSubTab(next as RegleSubTab);
    setReglePage(1);
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
        render: (r) =>
          r.timer.deadlineAt ? (
            <CountdownBar
              startAt={r.requestSentAt}
              deadlineAt={r.timer.deadlineAt}
              renderLabel={({ remainingDays, overdue }) => `${remainingDays} ${overdue ? t('exchanges.countdown.overdue') : t('exchanges.countdown.remaining')}`}
            />
          ) : (
            <span style={{ color: 'var(--ink-3)', fontSize: 'var(--k-fs-xs)' }}>{t('exchanges.countdown.none')}</span>
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

          {isRegleFilter ? (
            <Tabs
              items={[
                { key: 'SILENCE', label: t('exchanges.subtab.silence'), count: silenceItems.length },
                { key: 'COMPENSATED', label: t('exchanges.subtab.compensated'), count: compensatedItems.length },
              ]}
              activeKey={regleSubTab}
              onChange={changeRegleSubTab}
            />
          ) : null}

          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
              setReglePage(1);
            }}
            aria-label={t('exchanges.search.label')}
            placeholder={t('exchanges.search.label')}
            style={{
              width: '100%',
              margin: 'var(--s-3) 0',
              padding: '8px 12px',
              border: '1px solid var(--rule-strong)',
              borderRadius: 'var(--k-r-s)',
              font: 'inherit',
              background: 'var(--paper)',
              color: 'var(--ink)',
            }}
          />

          {(isRegleFilter ? regleAllQuery.isLoading || closuresQuery.isLoading : listQuery.isLoading) ? (
            <p>{t('common.loading')}</p>
          ) : (isRegleFilter ? regleAllQuery.error || closuresQuery.error : listQuery.error) ? (
            <div className="note ko" role="alert">
              <span>{t('common.error')}</span>
              <button
                type="button"
                onClick={() => {
                  if (isRegleFilter) {
                    void regleAllQuery.refetch();
                    void closuresQuery.refetch();
                  } else {
                    void listQuery.refetch();
                  }
                }}
              >
                {t('common.retry')}
              </button>
            </div>
          ) : (
            <Table
              columns={columns}
              rows={items}
              page={isRegleFilter ? reglePage : listQuery.data?.page ?? 1}
              total={isRegleFilter ? regleActiveItems.length : listQuery.data?.total ?? 0}
              pageSize={PAGE_SIZE}
              onPageChange={isRegleFilter ? setReglePage : setPage}
              onRowClick={openRecours}
              getRowKey={(r) => r.id}
            />
          )}
        </div>
      </div>

      <Modal open={!!selected} title={selected ? `${t('exchanges.detail.titlePrefix')} ${selected.id}` : ''} onClose={() => openRecours(null)}>
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

            {selected.timer.deadlineAt ? (
              <div style={{ marginBottom: 'var(--s-4)' }}>
                <strong style={{ display: 'block', marginBottom: 'var(--s-2)', fontSize: 'var(--k-fs-s)' }}>{t('exchanges.detail.deadline')}</strong>
                <CountdownBar
                  startAt={selected.requestSentAt}
                  deadlineAt={selected.timer.deadlineAt}
                  renderLabel={({ remainingDays, overdue }) => `${remainingDays} ${overdue ? t('exchanges.countdown.overdue') : t('exchanges.countdown.remaining')}`}
                />
              </div>
            ) : null}

            {!canTransition ? <p className="note warn">{t('common.forbidden')}</p> : null}

            <div style={{ marginBottom: 'var(--s-4)' }}>
              <strong style={{ display: 'block', marginBottom: 'var(--s-2)', fontSize: 'var(--k-fs-s)' }}>{t('exchanges.detail.transition.title')}</strong>
              <label htmlFor="transition-reason" style={{ display: 'block', fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)', marginBottom: 4 }}>
                {t('exchanges.action.reason.label')}
              </label>
              <input
                id="transition-reason"
                type="text"
                value={reason}
                disabled={!canTransition}
                onChange={(e) => setReason(e.target.value)}
                style={{ width: '100%', marginBottom: 'var(--s-3)', padding: '6px 10px', border: '1px solid var(--rule-strong)', borderRadius: 'var(--k-r-s)', font: 'inherit', background: 'var(--paper)', color: 'var(--ink)' }}
              />
              <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap' }}>
                {RECOURS_ALLOWED_ACTIONS[selected.state].map((action) => (
                  <button
                    key={action}
                    type="button"
                    className="tag a"
                    style={{ cursor: canTransition ? 'pointer' : 'not-allowed', border: 'none' }}
                    disabled={!canTransition || transitionMutation.isPending}
                    aria-expanded={action === 'opposer' ? opposing : undefined}
                    onClick={() => (action === 'opposer' ? setOpposing(true) : transitionMutation.mutate({ id: selected.id, action, reason }))}
                  >
                    {t(`exchanges.action.${action}` as TranslationKey)}
                  </button>
                ))}
                {RECOURS_ALLOWED_ACTIONS[selected.state].length === 0 ? (
                  <span style={{ color: 'var(--ink-3)', fontSize: 'var(--k-fs-s)' }}>{t('exchanges.action.none')}</span>
                ) : null}
              </div>

              {opposing && canTransition && RECOURS_ALLOWED_ACTIONS[selected.state].includes('opposer') ? (
                <div
                  role="group"
                  aria-label={t('exchanges.action.opposer')}
                  style={{ marginTop: 'var(--s-3)', padding: 'var(--s-3)', border: '1px solid var(--rule)', borderRadius: 'var(--k-r-s)', display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}
                >
                  {motifsQuery.isLoading ? (
                    <p style={{ margin: 0 }}>{t('common.loading')}</p>
                  ) : hasAdmittedMotifs ? (
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)' }}>
                      {t('exchanges.opposition.motif.label')}
                      <select
                        required
                        value={reasonCode}
                        onChange={(e) => setReasonCode(e.target.value)}
                        style={{ font: 'inherit', border: '1px solid var(--rule-strong)', borderRadius: 'var(--k-r-s)', padding: '6px 10px', background: 'var(--paper)', color: 'var(--ink)' }}
                      >
                        <option value="" disabled>
                          {t('exchanges.opposition.motif.placeholder')}
                        </option>
                        {motifs.map((m) => (
                          <option key={m.code} value={m.code} disabled={m.forbidden}>
                            {m.forbidden ? `${m.label} — ${t('referential.oppositionMotifs.forbidden')}` : m.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <>
                      <p style={{ margin: 0, fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)' }}>{t('exchanges.opposition.noCatalog')}</p>
                      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 'var(--k-fs-s)', color: 'var(--ink)' }}>
                        <input type="checkbox" required checked={attested} onChange={(e) => setAttested(e.target.checked)} />
                        <span>{t('exchanges.opposition.attest')}</span>
                      </label>
                    </>
                  )}
                  <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="tag a"
                      style={{ border: 'none', cursor: 'pointer' }}
                      disabled={transitionMutation.isPending || motifsQuery.isLoading || (hasAdmittedMotifs ? !reasonCode : !attested)}
                      onClick={() => transitionMutation.mutate({ id: selected.id, action: 'opposer', reason, reasonCode: hasAdmittedMotifs ? reasonCode : undefined })}
                    >
                      {t('exchanges.opposition.confirm')}
                    </button>
                    <button type="button" className="tag a" style={{ border: 'none', cursor: 'pointer' }} onClick={resetOpposition}>
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div>
              <strong style={{ display: 'block', marginBottom: 'var(--s-2)', fontSize: 'var(--k-fs-s)' }}>{t('exchanges.detail.timeline')}</strong>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {buildTimeline(selected, motifLabels).map((entry) => (
                  <li key={entry.key} style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                      <strong style={{ color: 'var(--ink)' }}>{t(entry.label)}</strong>
                      <span className="mono">{new Date(entry.at).toLocaleString(locale)}</span>
                    </div>
                    {entry.reason ? <p style={{ margin: '2px 0 0', fontSize: 'var(--k-fs-s)' }}>{entry.reason}</p> : null}
                  </li>
                ))}
              </ul>
            </div>

            {/*
              QUESTIONS_UAR.md §9, décision Product Owner 2026-10-18 : pièces
              manuelles (Annexe 2/3/4) attachées à CE recours — jamais à un
              CommissionCase depuis cet écran (voir `AttachmentsPanel`).
            */}
            <div style={{ marginTop: 'var(--s-4)', paddingTop: 'var(--s-4)', borderTop: '1px solid var(--rule)' }}>
              <strong style={{ display: 'block', marginBottom: 'var(--s-2)', fontSize: 'var(--k-fs-s)' }}>{t('exchanges.detail.attachments')}</strong>
              <AttachmentsPanel recoursId={selected.id} />
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
