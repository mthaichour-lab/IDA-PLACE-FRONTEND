/**
 * Types partagés — reflet manuel des DTO Swagger du back-end
 * (B.11/C.4). TODO(frontend-agent) : générer ces types depuis le schéma
 * OpenAPI (`openapi-typescript http://localhost:3001/api/docs-json`) dès
 * que l'équipe veut une garantie automatique de synchronisation avec le
 * contrat réel plutôt que cette copie à la main (voir HANDOFF.md).
 */

export interface Paginated<T> {
  page: number;
  total: number;
  items: T[];
}

export interface MeResponse {
  user: { id: string; name: string; email: string };
  role: string;
  privileges: string[];
  company?: string;
}

export type CompanyKind = 'INSURER' | 'MUTUAL' | 'SUBSIDIARY';
export type FeedMode = 'ERP' | 'ECONSTAT' | 'IMPORT' | 'API';
export type CompanyStatus = 'ACTIF' | 'SUSPENDU' | 'EN_RETRAIT' | 'EXCLU';

export interface CompanyView {
  id: string;
  code: string;
  name: string;
  nameAr?: string;
  color: string;
  kind: CompanyKind;
  feedMode: FeedMode;
  status: CompanyStatus;
  apiKeyMasked: string;
  delayOverrides?: Record<string, unknown>;
  /** Date d'adhésion (écran 12) — additif, réutilise `Company.createdAt` (back). */
  createdAt: string;
  correspondentName?: string;
  correspondentPhone?: string;
  correspondentEmail?: string;
  /** Répartition réelle des agences par type (DG/DR/AG) — additif, écran 12 ("1 DG · 3 DR · 8 agences"). */
  agencyCounts: { DG: number; DR: number; AG: number };
}

export type AgencyType = 'DG' | 'DR' | 'AG';

export interface AgencyView {
  id: string;
  companyId: string;
  code: string;
  name: string;
  type: AgencyType;
  parentId?: string;
  wilayaCode?: string;
  manager?: string;
  phone?: string;
  email?: string;
  address?: string;
  status: CompanyStatus;
}

export type ExpertStatus = 'ACTIF' | 'SUSPENDU' | 'RADIE';

export interface ExpertView {
  id: string;
  name: string;
  firm?: string;
  agrement?: string;
  wilayas: string[];
  specialties: string[];
  companies: string[];
  status: ExpertStatus;
}

/**
 * Paramètres de la convention / calendrier ouvré / barème des motifs
 * (écran 12, "Référentiel de place") — additif, forme exacte de
 * `ConventionParams`/`PublicHoliday`/`EligibilityMotif` (back
 * `referential-reference-data.ts`), `GET /referential/convention|
 * calendar|motifs`.
 */
export interface ConventionParams {
  version: string;
  silenceDays: number;
  oppositionDays: number;
  forclusionMonths: number;
  maxAmountDA: number;
}

export interface PublicHoliday {
  date: string;
  label: string;
}

export interface PlaceCalendar {
  weekendDays: string[];
  fixedHolidays: PublicHoliday[];
}

export interface EligibilityMotif {
  article: string;
  label: string;
}

/* ===================== Cockpit (écran 1, Module I) — B.11/HANDOFF ===================== */

/**
 * Complément additif (2026-10-18, rapprochement du guide illustré, écran 1,
 * §6.8-6.10) — reflet exact de `CockpitController.computeSummary` (back
 * `cockpit.module.ts`). Les 10 tuiles "Indicateurs de place" ; chaque champ
 * `*Pct`/`delaiMoyenAppariementJours` peut être `null` (pas encore de
 * donnée pour calculer un taux/une moyenne) — jamais une valeur inventée,
 * rendre un repère "non disponible" côté affichage (voir `formatPct`/
 * `formatDays`, même idiome que `/monitoring`).
 */
export interface CockpitIndicateursDePlace {
  declarationsDuMois: number;
  tauxAppariementPct: number | null;
  enAttenteAppariement: number;
  tauxHorsIdaPct: number | null;
  delaiMoyenAppariementJours: number | null;
  recoursForclos: number;
  compensationNetteT3: number;
  penalitesDeRetard: number;
  expertsActifs: number;
  expertsSuspendus: number;
  adherentsActifs: number;
  adherentsSuspendus: number;
}

/**
 * Positions nettes trimestrielles (additif) — remplace `barresNettes`
 * (conservé ci-dessous pour compatibilité) par la VRAIE compensation
 * trimestrielle (`SettlementModule`), plus précise qu'un proxy basé sur les
 * montants de dossiers. `positions` réutilise exactement `SettlementNet`
 * (même forme que `/settlement/quarter`, back `settlement.service.ts`).
 */
export interface CockpitPositionsNettesQuarter {
  quarter: string;
  positions: SettlementNet[];
  grossTotal: number;
  reductionPct: number;
}

export interface CockpitMonthlyDeclaration {
  month: string;
  declarations: number;
}

export interface CockpitTopWilaya {
  code: string;
  name: string;
  declarations: number;
}

/**
 * "Cycle conventionnel en cours" (additif) — SEULEMENT 3 étapes RÉELLES
 * (`saisie`/`synthese_annexe7`/`cloture_trimestre`) : le guide illustré en
 * montre 5, mais "Réunion UAR" (convocation Art.17) et "Règlements sous 8j"
 * (exécution Art.18) ne sont trackées par AUCUNE entité de ce backend (pas
 * de date de convocation, pas de suivi d'exécution des virements) — jamais
 * inventées pour coller au compte de la capture. Voir doc de classe
 * `CockpitController` (back) et HANDOFF.md.
 */
export interface CockpitCycleStep {
  key: string;
  label: string;
  article: string;
  done: boolean;
  detail?: string;
}

export interface CockpitCycleConventionnel {
  period: string;
  quarter: string;
  steps: CockpitCycleStep[];
}

/**
 * Alertes dérivées des VRAIS dépassements (`RecoursItem.timer.expired` et
 * dossiers de commission en dépassement Art.24) — jamais une alerte
 * inventée. `id` est l'identifiant réel préfixé par le back
 * (`recours-{id}`/`commission-{id}`), pas une référence formatée à part.
 */
export interface CockpitAlerteConventionnelle {
  id: string;
  from: string;
  to: string;
  description: string;
  article: string;
  detectedAt: string;
}

export interface CockpitSummary {
  kpis: {
    dossiersDuJour: number;
    aApparier: number;
    enRetard: number;
    compensationAVenir: number;
    recoursEnCours: number;
    delaisDepasses: number;
    appariementAutoPct: number | null;
    volumeBrutT3: number;
    reductionNettingPct: number;
  };
  sparklineDeclarations: number[];
  barresNettes: { company: string; net: number }[];
  indicateursDePlace: CockpitIndicateursDePlace;
  positionsNettesQuarter: CockpitPositionsNettesQuarter;
  monthlyDeclarations: CockpitMonthlyDeclaration[];
  topWilayas: CockpitTopWilaya[];
  cycleConventionnel: CockpitCycleConventionnel;
  alertesConventionnelles: CockpitAlerteConventionnelle[];
  commissionOverdue15dCount: number;
  updatedAt: string;
}

/* ===================== Matching (écran 2, Module A §6.3) — B.5/B.11 ===================== */

export type MatchLevel = 'AUTO' | 'MANUEL' | 'NON';
export type MatchStatus = 'A_CONFIRMER' | 'AUTO_CONFIRME' | 'CONFIRME_MANUEL' | 'REJETE' | 'COMPLEMENT';
export type MatchFilter = 'TOUS' | 'AUTO' | 'A_CONFIRMER' | 'NON_APPARIES';
export type MatchDecisionAction = 'confirm' | 'reject' | 'complement' | 'link';

export interface MatchCriteria {
  econstatPartage: boolean;
  plaquesCroisees: boolean;
  policeCroisee: boolean;
  dateHeure: boolean;
  compagniesCroisees: boolean;
  gps: boolean;
}

export interface MatchQueueItem {
  id: string;
  refA: string;
  companyA: string;
  plateA: string;
  refB?: string;
  companyB?: string;
  plateB?: string;
  score: number;
  level: MatchLevel;
  status: MatchStatus;
  econstatShared: boolean;
  criteria: MatchCriteria;
  confirmedBy?: string;
  confirmedAt?: string;
  rejectReason?: string;
  at: string;
  /**
   * Champs additifs (2026-10-18, écran 2 "Vue de confrontation") — une
   * valeur par déclaration (A/B), forme exacte de `MatchQueueItemDto` (back
   * `matching.dto.ts`) : affichage uniquement, n'entrent dans aucun calcul
   * de score/niveau (toujours renvoyés par l'API, jamais recalculés ici —
   * règle d'or C.1). Volontairement PAS de "Conducteur"/modèle de
   * véhicule/point de choc/schéma d'accident : aucun de ces champs
   * n'existe dans le modèle 47 colonnes (voir HANDOFF.md).
   */
  accidentDateA?: string;
  accidentDateB?: string;
  wilayaA?: string;
  wilayaB?: string;
  assureAIdentite?: string;
  assureBIdentite?: string;
  canalDeclarationA?: FeedMode;
  canalDeclarationB?: FeedMode;
  /** N° police/attestation "soi-même" de chaque déclaration (même convention que `plateA`/`plateB`). */
  policeA?: string;
  policeB?: string;
}

export interface MatchCounters {
  TOUS: number;
  AUTO: number;
  A_CONFIRMER: number;
  NON_APPARIES: number;
}

export interface MatchThresholds {
  autoThreshold: number;
  confirmThreshold: number;
}

export interface MatchDecisionResult {
  id: string;
  status: MatchStatus;
  decidedAt: string;
  decidedBy: string;
}

/* ===================== Import des dossiers (écran 3, Module XII) — B.4/B.11 ===================== */

export type ClaimColumnGroup = 'IDENTIFICATION' | 'ELIGIBILITE';

export interface ClaimColumnDef {
  index: number;
  key: string;
  label: string;
  group: ClaimColumnGroup;
  type: string;
  enumValues?: string[];
}

export type ClaimImportVerdict = 'ELIGIBLE_IDA' | 'HORS_IDA';

export interface ClaimImportRowResult {
  rowNumber: number;
  verdict: ClaimImportVerdict;
  reasons: string[];
  data: Record<string, unknown>;
}

export interface ClaimImportReport {
  fileName: string;
  importedAt: string;
  totalRows: number;
  eligibleCount: number;
  ineligibleCount: number;
  rows: ClaimImportRowResult[];
}

/* ===================== Échanges Annexes 2/3/4 — Recours (écran 4, Module B §6.4) — B.2/B.3 =====================
 * Forme exacte du vrai `RecoursModule` (`src/recours/dto/recours.dto.ts`, back) — corrigée après la revue
 * croisée sprint 3 (front construit avant que ce backend ne soit réel, jamais revérifié depuis) :
 * pas d'état 'ENVOYE' (7 vrais états dont REJETE), timer structuré (pas de date brute en champ plat), et la
 * transition se fait par `action` (RECOURS_ACTIONS), pas par état cible.
 */

export const RECOURS_STATES = ['EN_ATTENTE', 'OPPOSITION', 'CONTESTATION', 'COMMISSION', 'REGLE', 'REJETE', 'FORCLOS'] as const;
export type RecoursState = (typeof RECOURS_STATES)[number];
export type RecoursFilter = 'TOUS' | RecoursState;

export const RECOURS_ACTIONS = [
  'accepter',
  'opposer',
  'lever_opposition',
  'contester',
  'transmettre_commission',
  'cloturer_commission_favorable',
  'cloturer_commission_defavorable',
] as const;
export type RecoursAction = (typeof RECOURS_ACTIONS)[number];

/** Actions manuelles autorisées par état courant (miroir d'affichage de `ALLOWED_ACTIONS_BY_STATE`, back `recours.rules.ts`) — l'API reste seule juge, ceci n'évite qu'un 409 prévisible. */
export const RECOURS_ALLOWED_ACTIONS: Record<RecoursState, RecoursAction[]> = {
  EN_ATTENTE: ['accepter', 'opposer'],
  OPPOSITION: ['lever_opposition', 'contester'],
  CONTESTATION: ['transmettre_commission'],
  COMMISSION: ['cloturer_commission_favorable', 'cloturer_commission_defavorable'],
  REGLE: [],
  REJETE: [],
  FORCLOS: [],
};

export interface RecoursOppositionOrContestation {
  raisedAt: string;
  reason?: string;
  status: string;
  deadlineAt?: string;
  decidedAt?: string;
}

export interface RecoursResolution {
  kind: string;
  at: string;
  note?: string;
}

/** Timer conventionnel courant — purement présentationnel (`CountdownBar`), aucun calcul côté front (C.1). */
export interface RecoursTimer {
  timerType: 'SILENCE_ART10' | 'OPPOSITION_ART12' | 'FORCLUSION_ART19' | 'AUCUN';
  deadlineAt?: string;
  remainingDays: number;
  expired: boolean;
}

export interface RecoursItem {
  id: string;
  claimId: string;
  from: string;
  to: string;
  state: RecoursState;
  requestSentAt: string;
  responseAt?: string;
  opposition?: RecoursOppositionOrContestation;
  contestation?: RecoursOppositionOrContestation;
  commissionAt?: string;
  settledAt?: string;
  amount: number;
  resolution?: RecoursResolution;
  timer: RecoursTimer;
  createdAt: string;
}

export interface RecoursTransitionResult {
  id: string;
  state: RecoursState;
  timer: RecoursTimer;
  transitionedAt: string;
}

/* ===================== Cycle mensuel (écran 5, Module C §6.5) — B.2/B.3 =====================
 * Forme exacte de `CompanyMonthlySynthesisDto`/`MonthlySettlementDto` (back `settlement.dto.ts`).
 */

export type SettlementCompanyStatus = 'CLOTURE' | 'EN_COURS';

export interface SettlementMonthlyCompany {
  code: string;
  claimsCount: number;
  /** Nombre de recours résolus (REGLE/REJETE/FORCLOS) sur la période. */
  resolvedCount: number;
  totalAmount: number;
  status: SettlementCompanyStatus;
  closedAt?: string;
  bordereauRef?: string;
}

export interface SettlementMonthly {
  period: string;
  companies: SettlementMonthlyCompany[];
}

/**
 * Compléments additifs (`GET /settlement/monthly/:period/summary`,
 * `GET /settlement/monthly/:period/annexe7`) — `SettlementMonthly` ci-dessus
 * reste le contrat figé inchangé (back `settlement.service.ts`). Backend
 * préparé en parallèle (autre worktree, pas encore mergé au moment de cette
 * passe front) — forme fixée avec l'agent Backend (`MonthlySummaryDto`/
 * `Annexe7Dto`, `settlement.dto.ts`), à revérifier après merge.
 */
export interface SettlementMonthlySummary {
  period: string;
  /** Recours RÉGLÉS dont le règlement (ou, à défaut, l'envoi) tombe dans le mois. */
  settledCount: number;
  totalAmount: number;
  /** Recours actuellement en opposition — exclus du circuit, toutes périodes confondues (RG-06). */
  excludedOppositionCount: number;
  /** Échéance de saisie, ISO simple (AAAA-MM-05) — jour CALENDAIRE (pas ouvré, aucun calendrier de jours fériés algériens disponible). */
  insertionDeadline: string;
}

export interface SettlementMonthlyAnnexe7Pair {
  from: string;
  to: string;
  /** Nombre de recours réglés pour cette paire orientée créancier→débiteur. */
  count: number;
  totalAmount: number;
}

/** Paires créancier(from)→débiteur(to) EXACTES, non nettées — pas de netting, contrairement à `/settlement/quarter`. */
export interface SettlementMonthlyAnnexe7 {
  period: string;
  pairs: SettlementMonthlyAnnexe7Pair[];
}

/* ===================== Compensation trimestrielle (écran 6, Module D §6.6) — B.2/B.3 =====================
 * Forme exacte de `QuarterlySettlementDto` (back `settlement.dto.ts`).
 */

export interface SettlementPosition {
  from: string;
  to: string;
  amount: number;
}

export interface SettlementNet {
  code: string;
  /** Positif = la compagnie doit recevoir ; négatif = elle doit payer. */
  net: number;
}

export interface SettlementQuarter {
  quarter: string;
  bordereau?: string;
  positions: SettlementPosition[];
  net: SettlementNet[];
  closedAt?: string;
  closedBy?: string;
}

/**
 * Compléments additifs (`GET /settlement/quarter/:q/matrix`,
 * `GET /settlement/quarter/:q/summary`) — `SettlementQuarter` ci-dessus
 * reste le contrat figé inchangé (back `settlement.service.ts`).
 */
export interface SettlementMatrixCell {
  from: string;
  to: string;
  amount: number;
}

export interface SettlementQuarterMatrix {
  quarter: string;
  companies: string[];
  cells: SettlementMatrixCell[];
}

export interface SettlementQuarterSummary {
  quarter: string;
  grossTotal: number;
  bilateralNetTotal: number;
  multilateralNetTotal: number;
  reductionPct: number;
  settledCount: number;
  opposedCount: number;
}

// `PriceGrid`/`PriceGridMetric` (grille tarifaire des règlements, B.8,
// `GET /pricing/grid`) sont définis plus bas avec `InvoiceLine`/
// `MeteringInvoice` (section Métrologie) — réutilisés ici par `/quarter`
// (bordereau trimestriel, même grille que `/metering`), pas redéfinis.

/* ===================== Commission (écran 7, Module E §6.7) — B.2 =====================
 * Forme exacte de `CommissionCaseViewDto`/`SanctionViewDto` (back `commission.dto.ts`). Routes réelles sous
 * `/commission/cases` (pas `/commission/:id`), voir `commission.controller.ts`.
 */

export const COMMISSION_CASE_STATUSES = ['A_INSTRUIRE', 'EN_DELIBERE', 'PRONONCE'] as const;
export type CommissionCaseStatus = (typeof COMMISSION_CASE_STATUSES)[number];

export interface CommissionDecision {
  outcome: string;
  motif?: string;
}

export interface CommissionPv {
  signedBy: string;
  signedAt: string;
  ref: string;
}

export interface CommissionCase {
  id: string;
  recoursId: string;
  claimId: string;
  companyA: string;
  companyB: string;
  amount: number;
  motif: string;
  status: CommissionCaseStatus;
  scheduledAt: string;
  decidedAt?: string;
  decision?: CommissionDecision;
  pv?: CommissionPv;
  createdAt: string;
}

export interface CommissionPenaltyResult {
  id: string;
  commissionCaseId?: string;
  companyCode: string;
  type: string;
  amount?: number;
  reason: string;
  orderedAt: string;
  orderedBy: string;
}

export interface CommissionPvSignResult extends CommissionCase {}

/**
 * KPI de synthèse (`GET /commission/summary`, additif) — codé par le Tech
 * Lead en parallèle sur ce même sprint ; forme vérifiée contre
 * `CommissionSummaryDto` réel (back `commission.dto.ts`, déjà mergé au
 * moment de cette passe front).
 */
export interface CommissionSummary {
  /** Dossiers non encore tranchés (status A_INSTRUIRE ou EN_DELIBERE). */
  pendingCount: number;
  /** Parmi les dossiers pendants, ceux ouverts depuis plus de 15 jours (Art. 24). */
  overdue15dCount: number;
  /** Dossiers PRONONCE avec décision RECOURS_FONDE. */
  recoursFondesCount: number;
  /** Oppositions réputées fondées à défaut de contestation (Art. 12, RecoursModule — indépendant des dossiers de commission). */
  oppositionsFondeesCount: number;
}

export type SanctionType = 'PENALITE_FINANCIERE' | 'AVERTISSEMENT' | 'SUSPENSION';

/**
 * `GET /commission/sanctions` (réel, déjà existant avant cette passe —
 * jusqu'ici jamais affiché côté front, voir HANDOFF.md). Forme exacte de
 * `SanctionViewDto` (back `commission.dto.ts`) — enregistrement séparé lié
 * par `commissionCaseId`, pas embarqué dans `CommissionCase`.
 */
export interface Sanction {
  id: string;
  commissionCaseId?: string;
  companyCode: string;
  type: SanctionType;
  /** Absent pour une sanction non financière (ex. AVERTISSEMENT). */
  amount?: number;
  reason: string;
  orderedAt: string;
  orderedBy: string;
}

/* ===================== Journal scellé (écran 13, Module XI) — B.2/B.3 =====================
 * Reflet de `LedgerModule` — chaînage SHA-256 réel (`hash(n)=f(event,hash(n-1))`,
 * `GET /ledger/verify`), désormais append-only en base (`ledger_entry`), repli
 * mémoire équivalent si PostgreSQL absent (voir ARCHITECTURE.md back).
 */

export interface LedgerEntry {
  id: string;
  type: string;
  ref: string;
  actor: string;
  summary: string;
  at: string;
  hash: string;
  prevHash: string | null;
}

export interface LedgerVerifyResult {
  valid: boolean;
  brokenAt?: string;
}

/* ===================== Monitoring assureurs (écran 8, Module F §6.8) — mock (pondérations réelles) ===================== */

/** Clés de pondération du scoring composite — B.2 écran 8 (affichage uniquement, calcul API). */
export interface MonitoringWeights {
  delais: number;
  silences: number;
  oppositions: number;
  qualiteDonnees: number;
  forclusions: number;
  demandesTardives: number;
  penalites: number;
}

/** Forme exacte d'une composante de `details` (back) — corrigée après la revue croisée sprint 3 : ce n'est pas un simple nombre. */
export interface MonitoringComponentValue {
  value: number | null;
  dataSource: 'REEL' | 'NON_DISPONIBLE';
  sampleSize: number;
}

/**
 * Compléments additifs (écran 8, guide illustré) — `MonitoringCompanyScore`/
 * `MonitoringScores` ci-dessus restent le contrat figé inchangé, complétés
 * sans suppression de champ (back `monitoring.scoring.ts`/`monitoring.service.ts`).
 * `profile` : comptes/taux BRUTS réels (sens d'affichage du guide, ex.
 * "Silences" = taux brut, PAS l'inverse du score de conformité `details.silences`).
 */
export interface MonitoringCompanyProfile {
  onTimeResponsePct: number | null;
  avgResponseDays: number | null;
  oppositionsEmisesCount: number;
  oppositionsSubiesCount: number;
  silencesCount: number;
  contestationsCount: number;
  forclosCount: number;
  silencesRatePct: number | null;
  oppositionsRatePct: number | null;
}

export interface MonitoringCompanyScore {
  code: string;
  /** `null` si toutes les composantes sont `NON_DISPONIBLE` pour cette compagnie. */
  score: number | null;
  /** Note lettrée dérivée de `score` (affichage uniquement) — `null` si `score` est `null`. */
  grade: 'A' | 'B' | 'C' | 'D' | null;
  rank: number;
  details: Record<keyof MonitoringWeights, MonitoringComponentValue>;
  profile: MonitoringCompanyProfile;
}

export interface MonitoringScores {
  weights: MonitoringWeights;
  companies: MonitoringCompanyScore[];
  notes: string[];
  /** Fenêtre Art.10 réellement configurée (jours) — RecoursService.getTimerConfig().silenceDays, PAS les "10 j" du guide illustré (voir HANDOFF.md). */
  silenceDays: number;
  /** Seuil (%) au-delà duquel le bandeau "oppositions fréquentes" (§6.8) s'affiche pour une compagnie. */
  oppositionAlertThresholdPct: number;
}

/** `GET /monitoring/companies/:code/journeys` — une étape RÉELLEMENT persistée du parcours d'un recours (voir `buildRecoursJourneySteps`, back `recours.rules.ts`). Un recours a 1 à 5 étapes réelles, JAMAIS un compte fixe 8/11 (voir HANDOFF.md). */
export interface MonitoringJourneyStep {
  key: 'annexe2' | 'annexe3' | 'annexe4' | 'commission' | 'resolution';
  at: string;
}

/** "Vue par dossier — parcours complet" (écran 8), scopée à une compagnie. */
export interface MonitoringJourney {
  id: string;
  claimId: string;
  direction: 'EMIS' | 'RECU';
  counterparty: string;
  amount: number;
  state: string;
  steps: MonitoringJourneyStep[];
  requestSentAt: string;
}

/* ===================== Anti-fraude (écran 9, Module G §6.9) — mock ===================== */

export type FraudSeverity = 'ELEVEE' | 'MOYENNE' | 'FAIBLE';
/**
 * Forme exacte de `FraudCaseViewDto` (back) — corrigée après la revue croisée
 * sprint 3 : un cas a un seul `type` (pas une liste `signals`). `VELOCITE_
 * ADHERENT` et `plateA` ajoutés (additif, 2026-10-18, `fraud.dto.ts` ↔
 * `fraud.detection.ts` back) : 6ᵉ détection (rafale de déclarations du même
 * adhérent le même jour) + plaque jointe côté back sur le premier dossier
 * lié ayant une plaque renseignée (`undefined` si aucun).
 */
export type FraudCaseType = 'DOUBLON' | 'ECONSTAT_REUTILISE' | 'RECURRENCE_VEHICULE' | 'MONTANT_CALIBRE' | 'INCOHERENCE_AB' | 'VELOCITE_ADHERENT';

export interface FraudCase {
  id: string;
  type: FraudCaseType;
  score: number;
  severity: FraudSeverity;
  claimIds: string[];
  companiesInvolved: string[];
  details: Record<string, unknown>;
  detectedAt: string;
  /** Plaque du premier dossier lié ayant une plaque renseignée — `undefined` possible, rendre `—` côté affichage (jamais fabriquer de valeur). */
  plateA?: string;
}

export type FraudActionType = 'APPARIEMENT_MANUEL' | 'DELIAGE' | 'RELIAGE' | 'TRANSMISSION_TARDIVE';

export interface FraudAction {
  id: string;
  type: FraudActionType;
  actor: string;
  /** Présent pour `TRANSMISSION_TARDIVE` (dossier concerné). */
  claimId?: string;
  /** Présent pour `APPARIEMENT_MANUEL`/`DELIAGE`/`RELIAGE` (décision `MatchingModule` observée). */
  matchId?: string;
  details?: Record<string, unknown>;
  at: string;
}

/**
 * Signaux groupés par catégorie pour un adhérent (écran 9, panneau de détail,
 * additif 2026-10-18) — `GET /fraud/adherents/:company/signals`, forme exacte
 * de `FraudSignalGroupDto` (back `fraud.dto.ts`). N'affecte pas `FraudCase`
 * ci-dessus (simple agrégation en lecture, voir `fraud.service.ts`
 * `signalsByAdherent`).
 */
export type FraudSignalGroup = 'DOUBLONS_ECONSTAT' | 'RESEAU_RECURRENCE' | 'MONTANTS_PLAFOND' | 'INCOHERENCES_AB' | 'VELOCITE';

export interface FraudSignalGroupResult {
  group: FraudSignalGroup;
  count: number;
  maxScore: number;
  cases: FraudCase[];
}

/* ===================== Métrologie & facturation (écran 10, Module G §6.9 / B.8) — grille réelle, mesures mock ===================== */

export interface PriceGridMetric {
  metric: string;
  label: string;
  unit: string;
  includedQuota: number;
  unitPrice: number;
}

export interface PriceGrid {
  version: string;
  effectiveFrom: string;
  subscription: { label: string; monthly: number };
  metrics: PriceGridMetric[];
}

export interface InvoiceLine extends PriceGridMetric {
  measured: number;
  facturable: number;
  amount: number;
}

export type InvoiceStatus = 'EMISE' | 'PAYEE' | 'EN_RETARD';

export interface MeteringInvoice {
  company: string;
  period: string;
  gridVersion: string;
  subscription: { label: string; monthly: number };
  lines: InvoiceLine[];
  totalHT: number;
  totalTVA: number;
  totalTTC: number;
  status: InvoiceStatus;
}

/**
 * Historique mensuel d'une métrique (graphe "Consommation mensuelle",
 * écran 10 guide illustré) — `GET /metering/{company}/{period}/history/
 * {metric}`, additif, MOCK déterministe côté back (voir
 * `metering.service.ts`, `buildMeasuredHistory`), PAS une vraie série
 * temporelle collectée.
 */
export interface MeteringHistoryPoint {
  period: string;
  value: number;
}

export interface MeteringHistory {
  metric: string;
  points: MeteringHistoryPoint[];
}

/**
 * Dashboard des coûts place entière (écran 14 "Coûts & tarification",
 * sous-onglet Paramétrage) — `GET /metering/place-summary/{period}`,
 * additif, forme exacte de `MeteringService.placeSummary()` (back
 * `metering.service.ts`) : somme, pour chaque adhérent RÉEL de la place
 * (`adherentCount`, via `AdherentsService`), de la même facture mensuelle
 * mock que `/metering/{company}/{period}` (contrat `MeteringInvoice`
 * ci-dessus, inchangé). `revenueSharePct` = part de `amountHT` dans
 * `consumptionTotal` (0-100, somme à 100 sur l'ensemble des lignes).
 */
export interface PlaceMeteringSummaryLine {
  metric: string;
  label: string;
  unit: string;
  measured: number;
  facturable: number;
  amountHT: number;
  revenueSharePct: number;
}

export interface PlaceMeteringSummary {
  period: string;
  gridVersion: string;
  adherentCount: number;
  subscriptionTotal: number;
  consumptionTotal: number;
  revenueTotal: number;
  inducerCount: number;
  lines: PlaceMeteringSummaryLine[];
}

/* ===================== Statistiques de la place (écran 11, Module H §6.10) =====================
 * Forme exacte de `WilayaStatDto`/`MonthlyStatDto`/`StatsSummaryDto` (back
 * `stats.service.ts`) — agrégation RÉELLE depuis ClaimsModule +
 * RecoursModule, StatsModule n'étant pas dans la liste des contrats figés
 * (B.11).
 *
 * `pour100k` OMIS (pas de référentiel démographique officiel dans le dossier
 * technique ni le guide illustré) plutôt qu'inventé — pas de mesure
 * "pour 100 000 hab." côté front tant qu'aucune source n'est fournie.
 * `annexes2`/`oppositions`/`indemnises` RÉELS (RecoursModule, depuis sprint
 * 3). "e-constat mobile vs agence" reste approximé par canal réel
 * (`econstat` = canal ECONSTAT, `autresCanaux` = ERP+IMPORT+API) — le modèle
 * de données ne distingue pas mobile/agence au sein du canal ECONSTAT ;
 * ne jamais relabelliser ces deux champs "mobile"/"agence" côté affichage.
 */

export interface WilayaStat {
  code: string;
  name: string;
  nameAr?: string;
  region?: string;
  col: number;
  row: number;
  lat?: number;
  lng?: number;
  declarations: number;
  montants: number;
}

export interface MonthlyActivity {
  month: string;
  declarations: number;
  econstat: number;
  autresCanaux: number;
  annexes2: number;
  oppositions: number;
  indemnises: number;
}

/** KPI de synthèse `/stats` (nouveau, voir stats.service.ts back — KPI volontairement omis documentés là-bas : comparatif IRSAM, pour100k). */
export interface StatsSummary {
  declarations: number;
  oppositionRatePct: number;
  settledAmount: number;
  avgSettlementDays: number | null;
}

/* ===================== Paramétrage (écran 14, Admin §5.1) — matrice réelle, utilisateurs mock ===================== */

export interface PlaceUser {
  id: string;
  name: string;
  email: string;
  role: string;
  companyId?: string;
  active: boolean;
  grant: string[];
  revoke: string[];
}

export type RoleMatrix = Record<string, Record<string, boolean>>;

export interface RolesMatrixResponse {
  roles: string[];
  matrix: RoleMatrix;
}
