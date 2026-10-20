'use client';

import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useMemo } from 'react';
import { apiGet } from './api-client';
import { useAuth } from './auth-context';
import { Paginated } from './types';

interface DirectoryEntry {
  code: string;
  name?: string;
  color?: string;
}

const CompanyDirectoryContext = createContext<Map<string, DirectoryEntry>>(new Map());

/**
 * Annuaire des compagnies adhérentes (code, nom, couleur de marque) chargé
 * une fois par la coque applicative — projection publique de
 * `GET /referential/companies` (SEC-26), la même que renvoie l'API à tout
 * rôle. Sert uniquement à colorer les vignettes `CoChip` de tous les écrans
 * avec la couleur réelle du référentiel. Hors coque (tests de composant),
 * l'annuaire est vide et les vignettes restent neutres.
 */
export function CompanyDirectoryProvider({ children }: { children: React.ReactNode }) {
  const { me } = useAuth();
  const query = useQuery({
    queryKey: ['referential', 'companies', 'directory'],
    queryFn: () => apiGet<Paginated<DirectoryEntry>>('/referential/companies', { page: 1, pageSize: 100 }),
    enabled: !!me,
    staleTime: 5 * 60_000,
  });
  const map = useMemo(() => new Map((query.data?.items ?? []).map((c) => [c.code.toUpperCase(), c])), [query.data]);
  return <CompanyDirectoryContext.Provider value={map}>{children}</CompanyDirectoryContext.Provider>;
}

/** Entrée d'annuaire d'une compagnie (couleur et nom réels), si connue. */
export function useCompanyEntry(code: string | undefined): DirectoryEntry | undefined {
  const map = useContext(CompanyDirectoryContext);
  return code ? map.get(code.toUpperCase()) : undefined;
}
