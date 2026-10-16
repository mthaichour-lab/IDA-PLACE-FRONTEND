'use client';

import { useQuery } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import { apiGet } from './api-client';
import { MeResponse } from './types';

/**
 * Auth scaffold — C.4/C.2.6 : consomme `GET /api/v1/me` et expose
 * `privileges[]` pour piloter l'affichage conditionnel. **Aucune règle
 * d'autorisation n'est recodée côté front** : on ne fait que lire ce que
 * l'API renvoie (règle d'or C.1).
 *
 * TODO(frontend-agent) : brancher le flux OIDC Keycloak réel (login,
 * refresh token) à la place de l'en-tête `x-dev-user` géré par
 * `api-client.ts` — voir HANDOFF.md.
 */
interface AuthContextValue {
  me: MeResponse | undefined;
  isLoading: boolean;
  error: unknown;
  hasPrivilege: (privilege: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['me'],
    queryFn: () => apiGet<MeResponse>('/me'),
  });

  const hasPrivilege = (privilege: string) => data?.privileges.includes(privilege) ?? false;

  return <AuthContext.Provider value={{ me: data, isLoading, error, hasPrivilege }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé sous AuthProvider');
  return ctx;
}

/** Affiche `children` uniquement si l'utilisateur courant détient le privilège donné. */
export function RequirePrivilege({ privilege, children }: { privilege: string; children: React.ReactNode }) {
  const { hasPrivilege } = useAuth();
  if (!hasPrivilege(privilege)) return null;
  return <>{children}</>;
}
