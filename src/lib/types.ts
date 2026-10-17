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

/* ===================== Échanges Annexes 2/3/4 — Recours (écran 4, Module B §6.4) — B.2/B.3 =====================
 * RecoursModule reste un mock "squelette libre" côté back (voir HANDOFF backend) : la forme ci-dessous reflète
 * le contrôleur actuel (`src/recours/recours.module.ts`), pas un schéma Swagger figé par un Tech Lead distinct.
 */

/** États observés côté mock. "ENVOYE" n'a pas d'onglet dédié dans l'inventaire d'écran A.4 (tous/en attente/
 * opposition/contestation/commission/forclos) — il reste visible seulement sous l'onglet "Tous" (voir HANDOFF). */
export type RecoursState = 'ENVOYE' | 'EN_ATTENTE' | 'OPPOSITION' | 'CONTESTATION' | 'COMMISSION' | 'FORCLOS';
export type RecoursFilter = 'TOUS' | 'EN_ATTENTE' | 'OPPOSITION' | 'CONTESTATION' | 'COMMISSION' | 'FORCLOS';

export interface RecoursItem {
  id: string;
  claimId: string;
  from: string;
  to: string;
  state: RecoursState;
  requestSentAt: string;
  amount: number;
  /** Échéance conventionnelle (Art. 10/12/19) — date brute renvoyée par l'API ; voir `CountdownBar`
   * (composant transverse) pour la nuance sur l'affichage de progression, purement présentationnel. */
  conventionalDeadlineAt: string;
}

export interface RecoursTransitionResult {
  id: string;
  state: string;
  transitionedAt: string;
}

/* ===================== Cycle mensuel (écran 5, Module C §6.5) — B.2 =====================
 * SettlementModule reste un mock côté back (voir HANDOFF backend). */

export type SettlementCompanyStatus = 'CLOTURE' | 'EN_COURS';

export interface SettlementMonthlyCompany {
  code: string;
  claimsCount: number;
  totalAmount: number;
  status: SettlementCompanyStatus;
}

export interface SettlementMonthly {
  period: string;
  companies: SettlementMonthlyCompany[];
}

/** Résultat attendu d'une génération de bordereau mensuel — endpoint ASSUMÉ (voir HANDOFF, pas encore
 * exposé par `SettlementController`, qui n'a aujourd'hui que des `GET`). */
export interface SettlementBordereauResult {
  bordereau: string;
  generatedAt: string;
}

/* ===================== Compensation trimestrielle (écran 6, Module D §6.6) — B.2/B.3 ===================== */

export interface SettlementPosition {
  from: string;
  to: string;
  amount: number;
}

export interface SettlementNet {
  code: string;
  net: number;
}

export interface SettlementQuarter {
  quarter: string;
  bordereau: string;
  positions: SettlementPosition[];
  net: SettlementNet[];
}

/** Grille tarifaire des règlements (B.8, `TARIF-2026.01`) — `GET /pricing/grid` (MeteringModule, déjà réel). */
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

/* ===================== Commission (écran 7, Module E §6.7) — B.2 =====================
 * CommissionModule reste un mock côté back (voir HANDOFF backend). */

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
