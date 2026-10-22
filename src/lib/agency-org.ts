import { AgencyType, AgencyView } from './types';

/**
 * Organisation d'une compagnie — miroir d'AFFICHAGE des règles du back
 * (`agency-hierarchy.rules.ts`), qui reste seul juge :
 *  - la Direction générale (DG) est la racine, unique par compagnie ;
 *  - une Direction régionale (DR) relève de la DG ;
 *  - une agence (AG) relève d'une DR, ou directement de la DG.
 */
export const ALLOWED_PARENT_TYPES: Record<AgencyType, readonly AgencyType[]> = {
  DG: [],
  DR: ['DG'],
  AG: ['DR', 'DG'],
};

export interface RegionNode {
  dr: AgencyView;
  agencies: AgencyView[];
}

export interface OrgChart {
  dg?: AgencyView;
  regions: RegionNode[];
  /** Agences rattachées directement à la DG. */
  directAgencies: AgencyView[];
  /** Entités sans rattachement valide (aucun parent, parent absent, ou niveau incompatible). */
  unattached: AgencyView[];
}

const byCode = (a: AgencyView, b: AgencyView) => a.code.localeCompare(b.code);

/** Organigramme d'une compagnie à partir de la liste réelle de ses agences. */
export function buildOrgChart(agencies: AgencyView[]): OrgChart {
  const dgs = agencies.filter((a) => a.type === 'DG').sort(byCode);
  const dg = dgs[0];
  const placed = new Set<string>();
  if (dg) placed.add(dg.id);

  const regions: RegionNode[] = agencies
    .filter((a) => a.type === 'DR' && !!dg && a.parentId === dg.id)
    .sort(byCode)
    .map((dr) => {
      placed.add(dr.id);
      const children = agencies.filter((a) => a.type === 'AG' && a.parentId === dr.id).sort(byCode);
      children.forEach((c) => placed.add(c.id));
      return { dr, agencies: children };
    });

  const directAgencies = dg ? agencies.filter((a) => a.type === 'AG' && a.parentId === dg.id).sort(byCode) : [];
  directAgencies.forEach((a) => placed.add(a.id));

  const unattached = agencies.filter((a) => !placed.has(a.id)).sort(byCode);
  return { dg, regions, directAgencies, unattached };
}

/** Rattachements possibles pour une entité de niveau `type` (même compagnie, sans elle-même). */
export function parentCandidates(type: AgencyType, agencies: AgencyView[], selfId?: string): AgencyView[] {
  const allowed = ALLOWED_PARENT_TYPES[type];
  return agencies.filter((a) => a.id !== selfId && allowed.includes(a.type) && a.status !== 'EXCLU').sort((a, b) => allowed.indexOf(a.type) - allowed.indexOf(b.type) || byCode(a, b));
}

/** Chemin hiérarchique d'une entité (de la racine au parent direct), pour l'aperçu « position dans l'organisation ». */
export function ancestry(parentId: string | undefined, agencies: AgencyView[]): AgencyView[] {
  const byId = new Map(agencies.map((a) => [a.id, a]));
  const path: AgencyView[] = [];
  const seen = new Set<string>();
  let cursor = parentId ? byId.get(parentId) : undefined;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    path.unshift(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return path;
}
