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
