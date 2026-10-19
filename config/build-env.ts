/**
 * Garde de configuration et en-têtes de sécurité — SEC-01, SEC-22, SEC-40.
 *
 * Module SANS dépendance à Next.js ni au DOM : il est importé par
 * `next.config.ts` (au chargement de la configuration), par `src/proxy.ts`
 * (CSP par requête, avec nonce) et par les tests Vitest
 * (`config/build-env.test.ts`).
 *
 * Règle : un build de production (`next build`) ÉCHOUE si la configuration
 * publique permettrait de livrer le mode d'authentification de
 * développement (`x-dev-user`) ou d'appeler l'API en clair.
 */

/** Variables publiques lues au build (inlinées par Next.js dans le bundle). */
export interface PublicEnv {
  NODE_ENV?: string;
  NEXT_PUBLIC_AUTH_MODE?: string;
  NEXT_PUBLIC_API_URL?: string;
  NEXT_PUBLIC_DEV_USER?: string;
  NEXT_PUBLIC_KEYCLOAK_URL?: string;
  NEXT_PUBLIC_KEYCLOAK_REALM?: string;
  NEXT_PUBLIC_KEYCLOAK_CLIENT_ID?: string;
}

function isHttpsUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Liste des violations de la configuration de production (vide = conforme).
 * Toutes les erreurs sont renvoyées d'un coup, pour corriger en une passe.
 */
export function productionEnvErrors(env: PublicEnv): string[] {
  const errors: string[] = [];

  if (env.NEXT_PUBLIC_AUTH_MODE !== 'keycloak') {
    errors.push(`NEXT_PUBLIC_AUTH_MODE doit valoir "keycloak" en production (valeur actuelle : ${JSON.stringify(env.NEXT_PUBLIC_AUTH_MODE ?? null)}).`);
  }
  // Une chaîne vide est tolérée (impossible de « dé-définir » une variable
  // posée par un fichier .env* local depuis la ligne de commande) : le code
  // du mode dev est de toute façon retiré du bundle de production.
  if (env.NEXT_PUBLIC_DEV_USER !== undefined && env.NEXT_PUBLIC_DEV_USER !== '') {
    errors.push('NEXT_PUBLIC_DEV_USER ne doit pas être défini dans un build de production (identité de développement).');
  }
  if (!env.NEXT_PUBLIC_API_URL) {
    errors.push('NEXT_PUBLIC_API_URL est obligatoire en production.');
  } else if (!isHttpsUrl(env.NEXT_PUBLIC_API_URL)) {
    errors.push(`NEXT_PUBLIC_API_URL doit être une URL https:// en production (reçu : ${env.NEXT_PUBLIC_API_URL}).`);
  }
  if (!isHttpsUrl(env.NEXT_PUBLIC_KEYCLOAK_URL)) {
    errors.push('NEXT_PUBLIC_KEYCLOAK_URL doit être une URL https:// en production.');
  }
  if (!env.NEXT_PUBLIC_KEYCLOAK_REALM) errors.push('NEXT_PUBLIC_KEYCLOAK_REALM est obligatoire en production.');
  if (!env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID) errors.push('NEXT_PUBLIC_KEYCLOAK_CLIENT_ID est obligatoire en production.');

  return errors;
}

/** Lève une erreur explicite (et fait donc échouer `next build`) si la configuration de production n'est pas conforme. */
export function assertProductionEnv(env: PublicEnv): void {
  const errors = productionEnvErrors(env);
  if (errors.length > 0) {
    throw new Error(`Configuration de production refusée (IDA Place, SEC-01/SEC-40) :\n - ${errors.join('\n - ')}`);
  }
}

/** Origine d'une URL (`https://api.exemple.dz`), ou `undefined` si l'URL est absente/invalide. */
export function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** Origine WebSocket correspondant à une origine HTTP : `https:` → `wss:`, `http:` → `ws:` (développement local uniquement). */
export function websocketOrigin(httpOrigin: string): string {
  return httpOrigin.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
}

export interface CspOptions {
  nonce: string;
  isDev: boolean;
  apiUrl?: string;
  keycloakUrl?: string;
}

/**
 * Content-Security-Policy stricte (SEC-22).
 *
 * - `script-src` : nonce par requête + `'strict-dynamic'` (les scripts
 *   d'hydratation RSC de Next.js sont en ligne : un nonce est INDISPENSABLE,
 *   posé par `src/proxy.ts`). `'unsafe-eval'` uniquement en développement
 *   (React l'utilise pour reconstruire les piles d'erreur serveur).
 * - `style-src 'unsafe-inline'` : l'interface utilise des attributs `style`
 *   rendus côté serveur (charte graphique appliquée par composant), qu'un
 *   nonce ne couvre pas. Risque résiduel limité (pas d'exécution de script).
 * - `connect-src` : l'API (https + wss) et Keycloak (découverte OIDC,
 *   échange du code, renouvellement du jeton).
 * - `form-action` : `'self'` + Keycloak (formulaire de déconnexion éventuel
 *   de Keycloak) ; la connexion elle-même est une navigation, pas un POST.
 */
export function buildCsp({ nonce, isDev, apiUrl, keycloakUrl }: CspOptions): string {
  const api = originOf(apiUrl);
  const keycloak = originOf(keycloakUrl);
  const connect = ["'self'", ...(api ? [api, websocketOrigin(api)] : []), ...(keycloak ? [keycloak] : [])];
  if (isDev) connect.push('ws:'); // rechargement à chaud de `next dev`

  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(isDev ? ["'unsafe-eval'"] : [])]],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:']],
    ['font-src', ["'self'", 'data:']],
    ['connect-src', connect],
    ['frame-src', ["'none'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'", ...(keycloak ? [keycloak] : [])]],
    ['frame-ancestors', ["'none'"]],
  ];
  const parts = directives.map(([name, values]) => `${name} ${values.join(' ')}`);
  if (!isDev) parts.push('upgrade-insecure-requests');
  return parts.join('; ');
}

export interface HeaderEntry {
  key: string;
  value: string;
}

/**
 * En-têtes de sécurité statiques, posés par `next.config.ts` `headers()` sur
 * toutes les routes (la CSP, elle, dépend du nonce et est posée par le proxy).
 * HSTS uniquement en production : en développement local (http://localhost)
 * il serait ignoré, voire gênant pour d'autres applications du poste.
 */
export function staticSecurityHeaders(isProd: boolean): HeaderEntry[] {
  return [
    ...(isProd ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }] : []),
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()',
    },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ];
}
