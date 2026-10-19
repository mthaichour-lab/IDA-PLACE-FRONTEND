/**
 * Pont entre la session d'authentification (React, `auth-context.tsx`) et
 * les couches sans React (client HTTP, socket temps réel) — SEC-01.
 *
 * Le jeton d'accès ne quitte JAMAIS la mémoire du processus JavaScript :
 * pas de localStorage/sessionStorage, pas de cookie lisible. Ce module ne
 * stocke qu'une fonction d'accès, fournie par la session active.
 */

type AccessTokenGetter = () => Promise<string | null> | string | null;

let accessTokenGetter: AccessTokenGetter | null = null;
let unauthorizedHandler: (() => void) | null = null;

/** Branché par `AuthProvider` (mode keycloak) ; `null` au démontage. */
export function setAccessTokenGetter(getter: AccessTokenGetter | null): void {
  accessTokenGetter = getter;
}

/** Jeton d'accès courant (déjà renouvelé si nécessaire), ou `null` hors session. */
export async function getAccessToken(): Promise<string | null> {
  if (!accessTokenGetter) return null;
  try {
    return (await accessTokenGetter()) ?? null;
  } catch {
    return null;
  }
}

/** Action à mener sur un 401 de l'API (session expirée) : reconnexion. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export function notifyUnauthorized(): void {
  unauthorizedHandler?.();
}
