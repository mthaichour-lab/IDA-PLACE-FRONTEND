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

/* ===================== Cockpit (écran 1, Module I) — B.11/HANDOFF ===================== */

export interface CockpitSummary {
  kpis: {
    dossiersDuJour: number;
    aApparier: number;
    enRetard: number;
    compensationAVenir: number;
  };
  sparklineDeclarations: number[];
  barresNettes: { company: string; net: number }[];
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

/* ===================== Échanges Annexes 2/3/4 (écran 4, Module B §6.4) — B.2/B.3 =====================
 * Reflet de `RecoursModule` (mock minimal côté back, voir ARCHITECTURE.md) : registre des recours
 * inter-compagnies + transition d'état. Pas d'endpoint de détail dédié — la fiche écran 4 réutilise
 * les champs déjà présents dans l'item de liste (voir HANDOFF à rédiger : forme à surveiller, le
 * back-end n'a pas encore persisté les timers conventionnels réels).
 */

/** Forme exacte de `RECOURS_STATES` (back, `recours.rules.ts`) — corrigée après la revue croisée sprint 3 (le back n'a pas d'état 'ENVOYE', et a 'ACCEPTE_TACITE'/'REGLE' que ce type omettait). */
export type RecoursState = 'EN_ATTENTE' | 'ACCEPTE_TACITE' | 'OPPOSITION' | 'CONTESTATION' | 'COMMISSION' | 'REGLE' | 'FORCLOS';
/** Onglets écran 4 (énoncé de mission). */
export type RecoursFilter = 'TOUS' | 'EN_ATTENTE' | 'OPPOSITION' | 'CONTESTATION' | 'COMMISSION' | 'FORCLOS';

export interface RecoursOpposition {
  motif: string;
  at: string;
  by?: string;
}

export interface RecoursItem {
  id: string;
  claimId: string;
  from: string;
  to: string;
  state: RecoursState;
  requestSentAt: string;
  responseAt?: string;
  opposition?: RecoursOpposition;
  contestation?: RecoursOpposition;
  commissionAt?: string;
  settledAt?: string;
  amount: number;
  /** Échéance conventionnelle courante (Art. 10 ou 12 selon l'état) — purement informatif, voir `CountdownBar`. Nom de champ réel côté API (corrigé : ce n'était pas `conventionalDeadlineAt`). */
  currentDeadlineAt?: string;
}

export interface RecoursTransitionResult {
  id: string;
  claimId: string;
  from: string;
  to: string;
  state: RecoursState;
  requestSentAt: string;
  responseAt?: string;
  opposition?: RecoursOpposition;
  contestation?: RecoursOpposition;
  commissionAt?: string;
  settledAt?: string;
  amount: number;
  currentDeadlineAt?: string;
}

/* ===================== Cycle mensuel (écran 5, Module C §6.5) — B.2/B.3 =====================
 * Reflet de `SettlementController.monthly` (mock minimal, valeurs calculées à la volée non persistées).
 */

export type SettlementStatus = 'CLOTURE' | 'EN_COURS';

/** Forme exacte de `SettlementCompanyLineDto` (back) — corrigée après la revue croisée sprint 3. */
export interface MonthlyCompanySynthesis {
  company: string;
  claimsSettledCount: number;
  claimsPendingCount: number;
  totalSettledAmount: number;
  totalPendingAmount: number;
  fraisTraitement: number;
  status: SettlementStatus;
  bordereauRef: string;
  generatedAt: string;
  closedAt?: string;
}

export interface MonthlySettlement {
  period: string;
  companies: MonthlyCompanySynthesis[];
}

/* ===================== Compensation trimestrielle (écran 6, Module D §6.6) — B.2/B.3 =====================
 * Reflet de `SettlementController.quarter`.
 */

export interface QuarterPosition {
  from: string;
  to: string;
  amount: number;
}

/** Nom de champ réel côté API : `company`, pas `code` (corrigé après la revue croisée sprint 3). */
export interface QuarterNet {
  company: string;
  net: number;
}

export interface QuarterSettlement {
  quarter: string;
  bordereau: string;
  positions: QuarterPosition[];
  net: QuarterNet[];
}

/** Reflet partiel de `GET /pricing/grid` (MeteringModule, B.8) — seule `version` est utilisée ici (référence TARIF-2026.01, écran 6). */
export interface PriceGridSummary {
  version: string;
  effectiveFrom: string;
}

/* ===================== Commission (écran 7, Module E §6.7) — B.2 =====================
 * Reflet de `CommissionController` (mock minimal, pas de persistance côté back).
 */

export type CommissionCaseStatus = 'A_INSTRUIRE' | 'EN_DELIBERE' | 'PRONONCE';

export interface CommissionCase {
  id: string;
  recoursId: string;
  status: CommissionCaseStatus;
  scheduledAt: string;
}

export interface CommissionPenaltyResult {
  id: string;
  amount: number;
  reason: string;
  orderedAt: string;
}

export interface CommissionPvSignResult {
  id: string;
  signedAt: string;
}

/* ===================== Journal scellé (écran 13, Module XI) — B.2/B.3 =====================
 * Reflet de `LedgerModule` — seul module "mock" à implémenter réellement la logique de chaînage
 * SHA-256 (voir ARCHITECTURE.md), stockage en mémoire (non append-only en base, TODO back).
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

export interface MonitoringCompanyScore {
  code: string;
  /** `null` si toutes les composantes sont `NON_DISPONIBLE` pour cette compagnie. */
  score: number | null;
  rank: number;
  details: Record<keyof MonitoringWeights, MonitoringComponentValue>;
}

export interface MonitoringScores {
  weights: MonitoringWeights;
  companies: MonitoringCompanyScore[];
  notes: string[];
}

/* ===================== Anti-fraude (écran 9, Module G §6.9) — mock ===================== */

export type FraudSeverity = 'ELEVEE' | 'MOYENNE' | 'FAIBLE';
/** Forme exacte de `FraudCaseViewDto` (back) — corrigée après la revue croisée sprint 3 : un cas a un seul `type` (pas une liste `signals`). */
export type FraudCaseType = 'DOUBLON' | 'ECONSTAT_REUTILISE' | 'RECURRENCE_VEHICULE' | 'MONTANT_CALIBRE' | 'INCOHERENCE_AB';

export interface FraudCase {
  id: string;
  type: FraudCaseType;
  score: number;
  severity: FraudSeverity;
  claimIds: string[];
  companiesInvolved: string[];
  details: Record<string, unknown>;
  detectedAt: string;
}

export type FraudActionType = 'APPARIEMENT_MANUEL' | 'DELIAGE' | 'RELIAGE' | 'TRANSMISSION_TARDIVE';

export interface FraudAction {
  id: string;
  type: FraudActionType;
  actor: string;
  at: string;
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

/* ===================== Statistiques de la place (écran 11, Module H §6.10) — mock (référentiel wilayas réel) ===================== */

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
  pour100k: number;
}

export interface MonthlyActivity {
  month: string;
  declarations: number;
  annexes2: number;
  oppositions: number;
  indemnises: number;
  econstatMobile: number;
  econstatAgence: number;
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
