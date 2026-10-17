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

export type RecoursState = 'ENVOYE' | 'EN_ATTENTE' | 'OPPOSITION' | 'CONTESTATION' | 'COMMISSION' | 'FORCLOS';
/** Onglets écran 4 (énoncé de mission) — 'ENVOYE' existe côté back mais n'a pas d'onglet dédié : visible seulement sous "Tous". */
export type RecoursFilter = 'TOUS' | 'EN_ATTENTE' | 'OPPOSITION' | 'CONTESTATION' | 'COMMISSION' | 'FORCLOS';

export interface RecoursItem {
  id: string;
  claimId: string;
  from: string;
  to: string;
  state: RecoursState;
  requestSentAt: string;
  amount: number;
  /** Échéance conventionnelle (Art. 10/12/19) — purement informatif, voir `CountdownBar`. */
  conventionalDeadlineAt: string;
}

export interface RecoursTransitionResult {
  id: string;
  state: string;
  transitionedAt: string;
}

/* ===================== Cycle mensuel (écran 5, Module C §6.5) — B.2/B.3 =====================
 * Reflet de `SettlementController.monthly` (mock minimal, valeurs calculées à la volée non persistées).
 */

export type SettlementStatus = 'CLOTURE' | 'EN_COURS';

export interface MonthlyCompanySynthesis {
  code: string;
  claimsCount: number;
  totalAmount: number;
  status: SettlementStatus;
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

export interface QuarterNet {
  code: string;
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
