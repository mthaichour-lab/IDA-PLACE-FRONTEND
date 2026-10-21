import { InMemoryWebStorage, UserManager, UserManagerSettings, WebStorageStateStore } from 'oidc-client-ts';

/**
 * Flux OIDC Authorization Code + PKCE avec Keycloak — SEC-01.
 *
 * Client PUBLIC `ida-place-web` (aucun secret côté navigateur). Choix :
 * - jetons (accès, rafraîchissement, identité) conservés EN MÉMOIRE
 *   (`InMemoryWebStorage`) : un rechargement de page relance une connexion,
 *   transparente tant que la session SSO Keycloak est active ;
 * - seul l'état transitoire de la redirection (`state`, `code_verifier`
 *   PKCE) passe par `sessionStorage`, le temps de l'aller-retour vers
 *   Keycloak — `oidc-client-ts` le supprime au retour ;
 * - renouvellement automatique avant expiration par le jeton de
 *   rafraîchissement (`automaticSilentRenew`), sans iframe ;
 * - déconnexion par `end_session_endpoint` (`signoutRedirect`).
 */
export const CALLBACK_PATH = '/auth/callback';
export const LOGGED_OUT_PATH = '/auth/logged-out';

export interface KeycloakPublicConfig {
  url?: string;
  realm?: string;
  clientId?: string;
}

export function keycloakPublicConfig(): KeycloakPublicConfig {
  return {
    url: process.env.NEXT_PUBLIC_KEYCLOAK_URL,
    realm: process.env.NEXT_PUBLIC_KEYCLOAK_REALM,
    clientId: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID,
  };
}

/** Paramètres `oidc-client-ts` ; lève une erreur explicite si la configuration publique est incomplète. */
export function keycloakSettings(config: KeycloakPublicConfig, origin: string, stateStorage: Storage): UserManagerSettings {
  if (!config.url || !config.realm || !config.clientId) {
    throw new Error('Configuration Keycloak incomplète (NEXT_PUBLIC_KEYCLOAK_URL, NEXT_PUBLIC_KEYCLOAK_REALM, NEXT_PUBLIC_KEYCLOAK_CLIENT_ID).');
  }
  return {
    authority: `${config.url.replace(/\/$/, '')}/realms/${encodeURIComponent(config.realm)}`,
    client_id: config.clientId,
    redirect_uri: `${origin}${CALLBACK_PATH}`,
    post_logout_redirect_uri: `${origin}${LOGGED_OUT_PATH}`,
    response_type: 'code', // Authorization Code ; PKCE (S256) activé par défaut
    scope: 'openid profile email',
    userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
    stateStore: new WebStorageStateStore({ store: stateStorage }),
    automaticSilentRenew: true,
    monitorSession: false,
    loadUserInfo: false,
    filterProtocolClaims: true,
  };
}

let manager: UserManager | null = null;

/** Instance unique (navigateur uniquement). */
export function getUserManager(): UserManager {
  if (!manager) {
    manager = new UserManager(keycloakSettings(keycloakPublicConfig(), window.location.origin, window.sessionStorage));
  }
  return manager;
}

/** Réinitialise l'instance (tests). */
export function resetUserManagerForTests(): void {
  manager = null;
  callbackPromise = null;
}

let callbackPromise: ReturnType<UserManager['signinRedirectCallback']> | null = null;

/**
 * Échange le code d'autorisation (`/auth/callback`) — AU PLUS UNE FOIS par
 * chargement de page, quel que soit le nombre d'appels.
 *
 * StrictMode (développement) monte/démonte/remonte le composant appelant à
 * vide : ses DEUX exécutions doivent chacune pouvoir attendre puis traiter
 * le résultat normalement (c'est leur propre `cancelled` local, pas cet
 * appel, qui décide laquelle applique l'état) — seul l'appel réseau
 * lui-même, à usage unique (le code d'autorisation), ne doit partir
 * qu'une fois. D'où un cache de la PROMESSE (module, survit au montage à
 * vide de StrictMode) plutôt qu'un verrou qui empêcherait la 2ᵉ exécution
 * d'attendre le résultat.
 */
export function signinRedirectCallbackOnce(mgr: UserManager): ReturnType<UserManager['signinRedirectCallback']> {
  if (!callbackPromise) {
    callbackPromise = mgr.signinRedirectCallback();
  }
  return callbackPromise;
}
