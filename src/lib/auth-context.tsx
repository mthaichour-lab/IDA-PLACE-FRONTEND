'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import type { User } from 'oidc-client-ts';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { apiGet } from './api-client';
import { CALLBACK_PATH, getUserManager, LOGGED_OUT_PATH, signinRedirectCallbackOnce } from './auth/keycloak';
import { setAccessTokenGetter, setUnauthorizedHandler } from './auth/session';
import { MeResponse } from './types';

/**
 * Session et identité de l'utilisateur — C.4/C.2.6, SEC-01.
 *
 * Deux modes, choisis AU BUILD :
 * - `keycloak` (production, et développement si configuré) : flux
 *   Authorization Code + PKCE (`auth/keycloak.ts`). Tant que la session
 *   n'est pas établie, aucun écran ni appel API n'est rendu ; le jeton reste
 *   en mémoire et est renouvelé automatiquement ; un 401 relance la
 *   connexion ; « Se déconnecter » ferme la session Keycloak.
 * - `dev` (développement local uniquement, `NEXT_PUBLIC_AUTH_MODE=dev`) :
 *   identité simulée par l'en-tête `x-dev-user` (voir `api-client.ts`).
 *
 * Rôle, compagnie et privilèges affichés proviennent de `GET /me`, que le
 * backend construit à partir des claims du jeton vérifié (`ida_place_role`
 * ou `realm_access.roles`, `company_id`) — jamais d'une valeur par défaut
 * du front. **Aucune règle d'autorisation n'est recodée côté front** : on ne
 * fait que lire ce que l'API renvoie (règle d'or C.1).
 */
export type AuthStatus = 'loading' | 'authenticated' | 'redirecting' | 'loggedOut' | 'error';

interface AuthContextValue {
  me: MeResponse | undefined;
  isLoading: boolean;
  error: unknown;
  hasPrivilege: (privilege: string) => boolean;
  /** Mode d'authentification effectif du build. */
  mode: 'dev' | 'keycloak';
  status: AuthStatus;
  /** Ferme la session Keycloak (sans effet en mode dev). */
  logout: () => void;
  /** Relance une connexion Keycloak (sans effet en mode dev). */
  login: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_AUTH_MODE === 'dev') {
    return <DevAuthProvider>{children}</DevAuthProvider>;
  }
  return <KeycloakAuthProvider>{children}</KeycloakAuthProvider>;
}

function useMeQuery(enabled: boolean) {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => apiGet<MeResponse>('/me'),
    enabled,
  });
}

function DevAuthProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading, error } = useMeQuery(true);
  const value = useMemo<AuthContextValue>(
    () => ({
      me: data,
      isLoading,
      error,
      hasPrivilege: (privilege: string) => data?.privileges.includes(privilege) ?? false,
      mode: 'dev',
      status: 'authenticated',
      logout: () => {},
      login: () => {},
    }),
    [data, isLoading, error],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function currentLocation(): string {
  return `${window.location.pathname}${window.location.search}`;
}

/** Destination après connexion : chemin interne uniquement (jamais d'URL absolue, ni de retour vers les pages d'authentification). */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/cockpit';
  if (value.startsWith(CALLBACK_PATH) || value.startsWith(LOGGED_OUT_PATH)) return '/cockpit';
  return value;
}

function KeycloakAuthProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const redirectingRef = useRef(false);

  const login = useCallback((returnTo?: string) => {
    if (redirectingRef.current) return;
    redirectingRef.current = true;
    setStatus('redirecting');
    getUserManager()
      .signinRedirect({ state: { returnTo: safeReturnTo(returnTo ?? currentLocation()) } })
      .catch(() => {
        redirectingRef.current = false;
        setStatus('error');
      });
  }, []);

  const logout = useCallback(() => {
    const manager = getUserManager();
    setAccessTokenGetter(null);
    queryClient.clear();
    void manager.signoutRedirect().catch(() => {
      // Keycloak injoignable : la session locale (mémoire) est tout de même effacée.
      void manager.removeUser();
      setUser(null);
      setStatus('loggedOut');
    });
  }, [queryClient]);

  // Établissement de la session au chargement (une seule fois par chargement de page).
  useEffect(() => {
    let cancelled = false;
    const manager = getUserManager();
    const path = window.location.pathname;

    async function init() {
      if (path === CALLBACK_PATH) {
        // StrictMode (développement) monte/démonte/remonte ce composant à
        // vide : les deux exécutions de cet effet attendent chacune le
        // MÊME échange de code (mémoïsé, module `keycloak.ts` — le code
        // d'autorisation est à usage unique), puis chacune applique le
        // résultat selon SON PROPRE `cancelled` ci-dessous, exactement
        // comme le reste de cette fonction — la 1ʳᵉ exécution (annulée
        // presque aussitôt) l'ignore, la 2ᵉ (qui survit) l'applique.
        const signedIn = await signinRedirectCallbackOnce(manager);
        if (cancelled) return;
        setUser(signedIn);
        setStatus('authenticated');
        router.replace(safeReturnTo((signedIn.state as { returnTo?: unknown } | undefined)?.returnTo));
        return;
      }
      if (path === LOGGED_OUT_PATH) {
        setStatus('loggedOut');
        return;
      }
      const existing = await manager.getUser();
      if (cancelled) return;
      if (existing && !existing.expired) {
        setUser(existing);
        setStatus('authenticated');
      } else {
        login();
      }
    }

    init().catch(() => {
      if (!cancelled) setStatus('error');
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Renouvellement du jeton (refresh token) et expiration de la session.
  useEffect(() => {
    const manager = getUserManager();
    const offLoaded = manager.events.addUserLoaded((renewed) => setUser(renewed));
    const offRenewError = manager.events.addSilentRenewError(() => login());
    const offExpired = manager.events.addAccessTokenExpired(() => login());
    const offSignedOut = manager.events.addUserSignedOut(() => login());
    return () => {
      offLoaded();
      offRenewError();
      offExpired();
      offSignedOut();
    };
  }, [login]);

  // Pont vers le client HTTP et le socket temps réel (jeton en mémoire uniquement).
  useEffect(() => {
    const manager = getUserManager();
    setAccessTokenGetter(async () => {
      const current = await manager.getUser();
      return current && !current.expired ? current.access_token : null;
    });
    setUnauthorizedHandler(() => login());
    return () => {
      setAccessTokenGetter(null);
      setUnauthorizedHandler(null);
    };
  }, [login]);

  const authenticated = status === 'authenticated' && !!user;
  const { data, isLoading, error } = useMeQuery(authenticated);

  const value = useMemo<AuthContextValue>(
    () => ({
      me: data,
      isLoading: !authenticated || isLoading,
      error,
      hasPrivilege: (privilege: string) => data?.privileges.includes(privilege) ?? false,
      mode: 'keycloak',
      status,
      logout,
      login: () => login('/cockpit'),
    }),
    [data, isLoading, error, authenticated, status, logout, login],
  );

  return (
    <AuthContext.Provider value={value}>
      {authenticated && pathname !== CALLBACK_PATH ? children : <AuthScreen status={status} onLogin={() => login('/cockpit')} />}
    </AuthContext.Provider>
  );
}

/** Écran affiché tant qu'aucune session n'est établie (aucune donnée métier, aucun appel API). */
function AuthScreen({ status, onLogin }: { status: AuthStatus; onLogin: () => void }) {
  const { t } = useI18n();
  const message = status === 'loggedOut' ? t('auth.loggedOut') : status === 'error' ? t('auth.error') : t('auth.connecting');
  const showButton = status === 'loggedOut' || status === 'error';
  return (
    <main className="content" style={{ maxWidth: 480, margin: '15vh auto', textAlign: 'center' }}>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {showButton ? (
        <button
          type="button"
          onClick={onLogin}
          style={{ padding: '8px 16px', borderRadius: 'var(--k-r-s)', border: '1px solid var(--k-pri)', background: 'var(--k-pri)', color: 'var(--k-head-ink)', font: 'inherit', cursor: 'pointer' }}
        >
          {t('auth.login')}
        </button>
      ) : null}
    </main>
  );
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
