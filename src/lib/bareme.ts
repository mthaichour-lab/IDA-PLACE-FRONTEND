import { useQuery } from '@tanstack/react-query';
import { apiGet } from './api-client';
import { BaremeCase, BaremeVersion, VehicleCategory } from './types';

export const BAREME_VERSIONS_KEY = ['referential', 'bareme-versions'] as const;
export const VEHICLE_CATEGORIES_KEY = ['referential', 'vehicle-categories'] as const;

export interface PublishedBaremeCase extends BaremeCase {
  versionId: string;
  versionLabel: string;
}

export function useBaremeVersions() {
  return useQuery({ queryKey: BAREME_VERSIONS_KEY, queryFn: () => apiGet<BaremeVersion[]>('/referential/bareme-versions') });
}

export function useVehicleCategories() {
  return useQuery({ queryKey: VEHICLE_CATEGORIES_KEY, queryFn: () => apiGet<VehicleCategory[]>('/referential/vehicle-categories') });
}

/** Cas des seules versions `VALIDE_UAR` : un brouillon ou une version archivée n'est jamais proposé. */
export function publishedCases(versions: BaremeVersion[] | undefined): PublishedBaremeCase[] {
  return (versions ?? []).filter((v) => v.status === 'VALIDE_UAR').flatMap((v) => v.cases.map((c) => ({ ...c, versionId: v.id, versionLabel: v.label })));
}

export function publishedCategories(categories: VehicleCategory[] | undefined): VehicleCategory[] {
  return (categories ?? []).filter((c) => c.status === 'VALIDE_UAR');
}
