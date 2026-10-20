'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Table2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { TruncationNote } from '@/components/ui/TruncationNote';
import { FolioHeader } from '@/components/FolioHeader';
import { AttachmentsPanel } from '@/components/documents/AttachmentsPanel';
import { CoChip } from '@/components/ui/CoChip';
import { Table, Column } from '@/components/ui/Table';
import { Tabs } from '@/components/ui/Tabs';
import { TagTone } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { TranslationKey } from '@/i18n/translations';
import { fetchAllPages } from '@/lib/paginate';
import { apiGet, apiPath, apiPost } from '@/lib/api-client';
import { ApiError } from '@/lib/api-error';
import { useAuth } from '@/lib/auth-context';
import { useApiErrorMessage } from '@/lib/error-message';
import { useRealtime } from '@/lib/realtime';
import { isCompanyActor, visibleRecoursActions } from '@/lib/recours-actions';
import { buildRecoursExchangeEvents } from '@/lib/recours-timeline';
import { DeadlineMeter } from './DeadlineMeter';
import { RecoursThread } from './RecoursThread';
import {
  CompanyListItem,
  OppositionMotif,
  Paginated,
  RecoursAction,
  RecoursFilter,
  RecoursHistoryEntry,
  RecoursItem,
  RecoursState,
  RecoursTransitionResult,
  SettlementQuarterClosure,
} from '@/lib/types';

const PAGE_SIZE = 6; // pagination fixe 6/p — A.5

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

function stateTone(state: RecoursState): TagTone {
  if (state === 'FORCLOS' || state === 'REJETE') return 'ko';
  if (state === 'OPPOSITION' || state === 'CONTESTATION') return 'warn';
  if (state === 'COMMISSION') return 'a';
  return 'ok';
}

/** SEC-06 : montants à deux décimales au plus — centimes affichés seulement s'il y en a. */
function centimes(amount: number): { minimumFractionDigits: number; maximumFractionDigits: number } {
  const digits = Number.isInteger(amount) ? 0 : 2;
  return { minimumFractionDigits: digits, maximumFractionDigits: digits };
}

/** Montant + unité « DA » (maquette) — le nombre reste formaté par `Intl` (séparateurs de la langue). */
function formatDzd(amount: number, locale: string): string {
  try {
    return `${new Intl.NumberFormat(locale, centimes(amount)).format(amount)} DA`;
  } catch {
    return `${amount.toLocaleString()} DA`;
  }
}

/** Date courte « 7 sept. 2026 » (maquette). */
function shortDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Sous-ensemble NON nominatif de `GET /claims/:id` affiché dans le détail
 * (n° e-constat, date et commune de l'accident) — le masquage des champs
 * nominatifs reste fait par l'API (SEC-26) ; rien d'autre n'est lu.
 */
interface RecoursClaimSummary {
  numEconstat?: string;
  accidentDate?: string;
  commune?: string;
}

function recoursQuery(filter: RecoursFilter, page: number, q: string) {
  return { filter, page, pageSize: PAGE_SIZE, q: q || undefined };
}

export default function ExchangesPage() {
  const { t, locale } = useI18n();
  const { me, hasPrivilege } = useAuth();
  const { toast } = useToast();
  const errorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  // SEC-17 : l'historique d'audit des transitions est réservé aux rôles place.
  const placeUser = !!me && !isCompanyActor(me);
  const meCompany = isCompanyActor(me) ? me?.company : undefined;

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

  /**
   * Noms/couleurs réels des compagnies (`GET /referential/companies`,
   * projection publique — SEC-26) : alimente les cartes Créancier/Débiteur
   * du panneau de détail et la couleur réelle (`CompanyView.color`, SEC-50)
   * des bulles du fil d'échanges. `CoChip` continue d'appliquer son propre
   * repli si la couleur est absente/invalide.
   */
  const companiesQuery = useQuery({
    queryKey: ['referential', 'companies', 'all'],
    queryFn: () => apiGet<Paginated<CompanyListItem>>('/referential/companies', { page: 1, pageSize: 100 }),
  });
  const companyByCode = useMemo(() => new Map((companiesQuery.data?.items ?? []).map((c) => [c.code, c])), [companiesQuery.data]);

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
    // SEC-13 : pages successives de 100 (plafond `FETCH_ALL_MAX_ITEMS`), plus de pageSize géant.
    queryFn: () => fetchAllPages<RecoursItem>('/recours', { filter: 'REGLE', q: search || undefined }),
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

  // SEC-07 : l'événement invalide les requêtes `['recours', …]` (liste,
  // REGLE, compteurs) — rechargées par l'API, jamais lues dans le payload.
  useRealtime(['recours.timer']);

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

  /**
   * Fiche ouverte relue par l'API (et rafraîchie par l'invalidation
   * `['recours']`) : le payload temps réel se réduit à `{id, state}` et n'est
   * jamais lu ; la ligne de liste ne sert que de valeur initiale.
   */
  const detailQuery = useQuery({
    queryKey: ['recours', 'detail', selected?.id],
    queryFn: () => apiGet<RecoursItem>(apiPath`/recours/${selected!.id}`),
    enabled: !!selected,
    initialData: selected ?? undefined,
  });
  const current = selected ? detailQuery.data ?? selected : null;

  const historyQuery = useQuery({
    queryKey: ['recours', 'history', selected?.id],
    queryFn: () => apiGet<RecoursHistoryEntry[]>(apiPath`/recours/${selected!.id}/history`),
    enabled: !!selected && placeUser,
  });

  // Dossier lié (lecture seule, facultatif) : en cas d'erreur/refus, les lignes correspondantes sont simplement omises.
  const claimQuery = useQuery({
    queryKey: ['claims', 'detail', current?.claimId],
    queryFn: () => apiGet<RecoursClaimSummary>(apiPath`/claims/${current!.claimId}`),
    enabled: !!current?.claimId,
    retry: false,
  });
  const claim = claimQuery.data;

  const motifsQuery = useQuery({
    queryKey: ['referential', 'opposition-motifs'],
    queryFn: () => apiGet<OppositionMotif[]>('/referential/opposition-motifs'),
    enabled: !!selected,
  });
  // Catalogue indisponible (erreur) : même repli que le catalogue vide — motif libre + attestation.
  const motifs = motifsQuery.data ?? [];
  // Décision PO (2026-10-19) : seul un motif validé UAR peut fonder une opposition.
  const isAdmitted = (m: OppositionMotif) => !m.forbidden && m.status === 'VALIDE_UAR';
  const hasAdmittedMotifs = motifs.some(isAdmitted);
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

  // Sélection par défaut de la première ligne visible (fidélité à la
  // capture : un recours est toujours présenté en détail) — seulement
  // quand rien n'est encore sélectionné ; ne vole jamais la sélection d'un
  // utilisateur qui a déjà cliqué une autre ligne.
  useEffect(() => {
    if (!selected && items.length > 0) openRecours(items[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, selected]);

  const transitionMutation = useMutation({
    mutationFn: ({ id, action, reason: r, reasonCode: code }: { id: string; action: RecoursAction; reason?: string; reasonCode?: string }) =>
      apiPost<RecoursTransitionResult>(apiPath`/recours/${id}/transition`, { action, reason: r || undefined, reasonCode: code || undefined }),
    onSuccess: () => {
      // Fiche complète (opposition/contestation/resolution), liste, compteurs et
      // historique relus par l'API : le fil d'échanges reflète la nouvelle étape.
      setReason('');
      resetOpposition();
      toast(t('exchanges.detail.transition.toast.ok'), 'ok');
      void queryClient.invalidateQueries({ queryKey: ['recours'] });
    },
    onError: (err: unknown) => {
      // Code métier traduit (CONFLIT_CONCURRENT, DECISION_COMMISSION_REQUISE…), sinon message du backend.
      toast(errorMessage(err, t('exchanges.detail.transition.toast.error')), 'ko');
      // 409 « modifié entre-temps » : la fiche est relue pour repartir de l'état réel.
      if (err instanceof ApiError && err.status === 409) void queryClient.invalidateQueries({ queryKey: ['recours'] });
    },
  });

  function changeFilter(next: string) {
    setFilter(next as RecoursFilter);
    setPage(1);
    // Repart toujours sur "Accepté/silence" page 1 en entrant/quittant REGLE —
    // même logique de remise à zéro que `page` ci-dessus.
    setRegleSubTab('SILENCE');
    setReglePage(1);
    // Le recours sélectionné peut ne plus apparaître dans le nouvel onglet :
    // on repart sans sélection, l'effet d'auto-sélection choisit la première
    // ligne du nouvel onglet dès qu'elle est connue.
    openRecours(null);
  }

  function changeRegleSubTab(next: string) {
    setRegleSubTab(next as RegleSubTab);
    setReglePage(1);
    openRecours(null);
  }

  const remainingLabel = ({ remainingDays, overdue }: { remainingDays: number; overdue: boolean }) =>
    `${remainingDays} ${overdue ? t('exchanges.countdown.overdue') : t('exchanges.countdown.remaining')}`;
  const timerLabel = (r: RecoursItem) => (r.timer.timerType === 'AUCUN' ? '' : t(`exchanges.timer.${r.timer.timerType}` as TranslationKey));

  const columns: Column<RecoursItem>[] = useMemo(
    () => [
      {
        key: 'recours',
        header: t('exchanges.col.recours'),
        // Identifiants complets dans le DOM (recherche, lecteurs d'écran) ; tronqués visuellement en CSS.
        render: (r) => (
          <span className="ex-ref">
            <span className="mono ex-ref-id" title={r.id}>
              {r.id}
            </span>
            <span className="mono ex-ref-sub" title={r.claimId}>
              {r.claimId}
            </span>
          </span>
        ),
      },
      {
        key: 'parties',
        header: t('exchanges.col.parties'),
        render: (r) => (
          <span className="ex-pair">
            <CoChip code={r.from} color={companyByCode.get(r.from)?.color} />
            <span aria-hidden="true" className="ex-arrow">
              →
            </span>
            <CoChip code={r.to} color={companyByCode.get(r.to)?.color} />
          </span>
        ),
      },
      { key: 'amount', header: t('exchanges.col.amount'), render: (r) => <span className="mono ex-amount-cell">{formatDzd(r.amount, locale)}</span> },
      { key: 'state', header: t('exchanges.col.state'), render: (r) => <StatePill state={r.state} label={t(`exchanges.state.${r.state}` as TranslationKey)} /> },
      {
        key: 'deadline',
        header: t('exchanges.col.deadline'),
        render: (r) =>
          r.timer.deadlineAt ? (
            <DeadlineMeter
              compact
              label={timerLabel(r)}
              startAt={r.requestSentAt}
              deadlineAt={r.timer.deadlineAt}
              locale={locale}
              remainingLabel={remainingLabel}
              dueOnLabel={t('exchanges.deadline.dueOn')}
            />
          ) : (
            <span className="ex-none">{t('exchanges.countdown.none')}</span>
          ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, locale, companyByCode],
  );

  const threadEvents = useMemo(
    () => (current ? buildRecoursExchangeEvents(current, { t, motifLabels, meCompany, amountLabel: formatDzd(current.amount, locale) }) : []),
    [current, t, motifLabels, meCompany, locale],
  );

  const registryTotal = isRegleFilter ? regleActiveItems.length : listQuery.data?.total;
  const actions = current ? visibleRecoursActions(current, me) : [];

  return (
    <>
      <FolioHeader
        badge="Module B · §6.4"
        title={t('exchanges.title')}
        subtitle={t('exchanges.subtitle')}
        actions={
          <span className="btn-outline ex-register" title={t('exchanges.registerBadge.title')}>
            <Table2 size={16} strokeWidth={2} aria-hidden="true" />
            {t('exchanges.registerBadge.label')}
          </span>
        }
      />

      <Tabs items={TABS.map((tab) => ({ key: tab.key, label: t(tab.label), count: countersQuery.data?.[tab.key] }))} activeKey={filter} onChange={changeFilter} />

      {isRegleFilter ? (
        <div className="ex-subtabs">
          <Tabs
            items={[
              { key: 'SILENCE', label: t('exchanges.subtab.silence'), count: silenceItems.length },
              { key: 'COMPENSATED', label: t('exchanges.subtab.compensated'), count: compensatedItems.length },
            ]}
            activeKey={regleSubTab}
            onChange={changeRegleSubTab}
          />
        </div>
      ) : null}

      <div className="ex-search">
        <Search size={16} strokeWidth={2} aria-hidden="true" />
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
        />
      </div>

      <div className="ex-grid">
        <div className="sheet">
          <div className="sheet-head">
            <span>
              {t('exchanges.registry.title')}
              {registryTotal !== undefined ? ` (${registryTotal})` : ''}
            </span>
          </div>
          <div className="sheet-body flush">
            {(isRegleFilter ? regleAllQuery.isLoading || closuresQuery.isLoading : listQuery.isLoading) ? (
              <p className="pad muted">{t('common.loading')}</p>
            ) : (isRegleFilter ? regleAllQuery.error || closuresQuery.error : listQuery.error) ? (
              <div className="pad">
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
              </div>
            ) : (
              <>
                {isRegleFilter ? (
                  <div className="pad">
                    <TruncationNote truncated={regleAllQuery.data?.truncated} shown={regleAllQuery.data?.items.length ?? 0} total={regleAllQuery.data?.total ?? 0} />
                  </div>
                ) : null}
                <div className="ex-table">
                  <Table
                    columns={columns}
                    rows={items}
                    page={isRegleFilter ? reglePage : listQuery.data?.page ?? 1}
                    total={isRegleFilter ? regleActiveItems.length : listQuery.data?.total ?? 0}
                    pageSize={PAGE_SIZE}
                    onPageChange={isRegleFilter ? setReglePage : setPage}
                    onRowClick={openRecours}
                    getRowKey={(r) => r.id}
                    selectedKey={current?.id}
                  />
                </div>
              </>
            )}
          </div>
        </div>

        <div className="sheet ex-detail">
          <div className="sheet-head">
            <span className="ex-detail-title">
              {t('exchanges.detail.titlePrefix')}
              {current ? (
                <>
                  {' '}
                  <span className="mono">{current.id}</span>
                </>
              ) : null}
            </span>
          </div>
          <div className="sheet-body">
            {!current ? (
              <p className="muted">{t('exchanges.panel.empty')}</p>
            ) : (
              <>
                <div className="ex-detail-top">
                  <StatePill state={current.state} label={t(`exchanges.state.${current.state}` as TranslationKey)} />
                  <span className="ex-detail-amount">{formatDzd(current.amount, locale)}</span>
                </div>

                <dl className="ex-dl">
                  <div>
                    <dt>{t('exchanges.detail.from')}</dt>
                    <dd>
                      <CoChip code={current.from} color={companyByCode.get(current.from)?.color} withName name={companyByCode.get(current.from)?.name ?? current.from} />
                    </dd>
                  </div>
                  <div>
                    <dt>{t('exchanges.detail.to')}</dt>
                    <dd>
                      <CoChip code={current.to} color={companyByCode.get(current.to)?.color} withName name={companyByCode.get(current.to)?.name ?? current.to} />
                    </dd>
                  </div>
                  <div>
                    <dt>{t('exchanges.detail.claim')}</dt>
                    <dd className="mono ex-break">{current.claimId}</dd>
                  </div>
                  {claim?.numEconstat ? (
                    <div>
                      <dt>{t('exchanges.detail.constat')}</dt>
                      <dd className="mono">{claim.numEconstat}</dd>
                    </div>
                  ) : null}
                  {claim?.accidentDate ? (
                    <div>
                      <dt>{t('exchanges.detail.accident')}</dt>
                      <dd>{[shortDate(claim.accidentDate, locale), claim.commune].filter(Boolean).join(' · ')}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>{t('exchanges.detail.sentAt')}</dt>
                    <dd>{shortDate(current.requestSentAt, locale)}</dd>
                  </div>
                  {current.opposition ? (
                    <div>
                      <dt>{t('exchanges.detail.opposition')}</dt>
                      <dd>
                        {current.opposition.reasonCode ? <strong className="ex-dd-strong">{motifLabels.get(current.opposition.reasonCode) ?? current.opposition.reasonCode}</strong> : null}
                        {current.opposition.reason ? <span className="ex-dd-note">{current.opposition.reason}</span> : null}
                      </dd>
                    </div>
                  ) : null}
                  {current.contestation?.reason ? (
                    <div>
                      <dt>{t('exchanges.detail.contestation')}</dt>
                      <dd>
                        <span className="ex-dd-note">{current.contestation.reason}</span>
                      </dd>
                    </div>
                  ) : null}
                </dl>

                {current.timer.deadlineAt ? (
                  <DeadlineMeter
                    label={timerLabel(current) || t('exchanges.detail.deadline')}
                    startAt={current.requestSentAt}
                    deadlineAt={current.timer.deadlineAt}
                    locale={locale}
                    remainingLabel={remainingLabel}
                    dueOnLabel={t('exchanges.deadline.dueOn')}
                  />
                ) : null}

                {!canTransition ? <p className="note warn ex-gap">{t('common.forbidden')}</p> : null}

                <div className="ex-block">
                  <strong className="ex-block-title">{t('exchanges.detail.transition.title')}</strong>
                  <label htmlFor="transition-reason" className="ex-label">
                    {t('exchanges.action.reason.label')}
                  </label>
                  <input id="transition-reason" className="ex-input" type="text" value={reason} disabled={!canTransition} onChange={(e) => setReason(e.target.value)} />
                  <div className="ex-actions">
                    {actions.map((action) => (
                      <button
                        key={action}
                        type="button"
                        className="btn-outline ex-action"
                        disabled={!canTransition || transitionMutation.isPending}
                        aria-expanded={action === 'opposer' ? opposing : undefined}
                        onClick={() => (action === 'opposer' ? setOpposing(true) : transitionMutation.mutate({ id: current.id, action, reason }))}
                      >
                        {t(`exchanges.action.${action}` as TranslationKey)}
                      </button>
                    ))}
                    {actions.length === 0 ? <span className="ex-none">{t('exchanges.action.none')}</span> : null}
                  </div>

                  {opposing && canTransition && actions.includes('opposer') ? (
                    <div role="group" aria-label={t('exchanges.action.opposer')} className="ex-oppose">
                      {motifsQuery.isLoading ? (
                        <p className="muted">{t('common.loading')}</p>
                      ) : hasAdmittedMotifs ? (
                        <label className="ex-label ex-label-col">
                          {t('exchanges.opposition.motif.label')}
                          <select className="ex-input" required value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
                            <option value="" disabled>
                              {t('exchanges.opposition.motif.placeholder')}
                            </option>
                            {motifs.map((m) => (
                              <option key={m.code} value={m.code} disabled={!isAdmitted(m)}>
                                {m.forbidden
                                  ? `${m.label} — ${t('referential.oppositionMotifs.forbidden')}`
                                  : isAdmitted(m)
                                    ? m.label
                                    : `${m.label} — ${t('exchanges.opposition.motif.pending')}`}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <>
                          <p className="ex-label">{t('exchanges.opposition.noCatalog')}</p>
                          <label className="ex-attest">
                            <input type="checkbox" required checked={attested} onChange={(e) => setAttested(e.target.checked)} />
                            <span>{t('exchanges.opposition.attest')}</span>
                          </label>
                        </>
                      )}
                      <div className="ex-actions">
                        <button
                          type="button"
                          className="btn-primary ex-action"
                          disabled={transitionMutation.isPending || motifsQuery.isLoading || (hasAdmittedMotifs ? !reasonCode : !attested)}
                          onClick={() => transitionMutation.mutate({ id: current.id, action: 'opposer', reason, reasonCode: hasAdmittedMotifs ? reasonCode : undefined })}
                        >
                          {t('exchanges.opposition.confirm')}
                        </button>
                        <button type="button" className="btn-soft" onClick={resetOpposition}>
                          {t('common.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>

                <section className="ex-block" aria-label={t('exchanges.detail.timeline')}>
                  <h2 className="ex-section-title">{t('exchanges.detail.timeline')}</h2>
                  <p className="ex-section-sub">{t('exchanges.detail.timeline.sub')}</p>
                  <RecoursThread events={threadEvents} locale={locale} emptyLabel={t('exchanges.thread.empty')} companyName={(code) => companyByCode.get(code)?.name} />
                </section>

                {placeUser ? <RecoursAuditHistory query={historyQuery} locale={locale} t={t} /> : null}

                {/*
                  QUESTIONS_UAR.md §9, décision Product Owner 2026-10-18 : pièces
                  manuelles (Annexe 2/3/4) attachées à CE recours — jamais à un
                  CommissionCase depuis cet écran (voir `AttachmentsPanel`).
                */}
                <div className="ex-block ex-attachments">
                  <strong className="ex-block-title">{t('exchanges.detail.attachments')}</strong>
                  <AttachmentsPanel recoursId={current.id} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/** Pastille d'état « • EN COMMISSION » (maquette) — teintes `.tag` existantes (ok/warn/ko/a). */
function StatePill({ state, label }: { state: RecoursState; label: string }) {
  return <span className={`tag ${stateTone(state)} ex-state`}>{label}</span>;
}

/** Libellés des actions de l'historique : actions manuelles, création et transitions automatiques (timers Art. 10/12/19). */
const HISTORY_ACTION_LABEL: Record<string, TranslationKey> = {
  creation: 'exchanges.history.action.creation',
  automatique: 'exchanges.history.action.automatique',
  accepter: 'exchanges.action.accepter',
  opposer: 'exchanges.action.opposer',
  lever_opposition: 'exchanges.action.lever_opposition',
  contester: 'exchanges.action.contester',
  transmettre_commission: 'exchanges.action.transmettre_commission',
  cloturer_commission_favorable: 'exchanges.action.cloturer_commission_favorable',
  cloturer_commission_defavorable: 'exchanges.action.cloturer_commission_defavorable',
};

/** SEC-17 — historique d'audit des transitions (`GET /recours/:id/history`), rôles place uniquement. */
function RecoursAuditHistory({
  query,
  locale,
  t,
}: {
  query: { data?: RecoursHistoryEntry[]; isLoading: boolean; error: unknown; refetch: () => unknown };
  locale: string;
  t: (key: TranslationKey) => string;
}) {
  const entries = query.data ?? [];
  return (
    <section aria-label={t('exchanges.history.title')} className="ex-block">
      <strong className="ex-block-title">{t('exchanges.history.title')}</strong>
      {query.isLoading ? (
        <p className="muted">{t('common.loading')}</p>
      ) : query.error ? (
        <div className="note ko" role="alert">
          <span>{t('common.error')}</span>
          <button type="button" onClick={() => query.refetch()}>
            {t('common.retry')}
          </button>
        </div>
      ) : entries.length === 0 ? (
        <p className="ex-none">{t('exchanges.history.empty')}</p>
      ) : (
        <ol className="ex-history">
          {entries.map((h, i) => (
            <li key={`${h.at}-${i}`}>
              <div className="ex-history-head">
                <strong>{HISTORY_ACTION_LABEL[h.action] ? t(HISTORY_ACTION_LABEL[h.action]) : h.action}</strong>
                <span className="mono">{new Date(h.at).toLocaleString(locale)}</span>
              </div>
              <div className="mono">
                {h.fromState ?? '—'} → {h.toState}
              </div>
              <div>
                {t('exchanges.history.actor')} {h.actorRole}
                {h.onBehalfOf ? ` · ${t('exchanges.history.onBehalfOf')} ${h.onBehalfOf}` : ''}
                {h.pvRef ? ` · ${h.pvRef}` : ''}
              </div>
              {h.reason ? <div>{h.reason}</div> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
