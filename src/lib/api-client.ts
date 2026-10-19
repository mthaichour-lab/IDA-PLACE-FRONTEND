import { ApiError, ApiErrorBody } from './api-error';
import { DEV_USER_HEADER, devUser } from './auth/dev-identity';
import { getAccessToken, notifyUnauthorized } from './auth/session';

/**
 * Client HTTP typé — unique point de contact avec l'API back-end
 * (C.4 : "le front consomme l'API REST versionnée"). Pointe vers
 * `NEXT_PUBLIC_API_URL` + préfixe `/api/v1`.
 *
 * Authentification (SEC-01) :
 * - mode `keycloak` (seul mode possible dans un build de production) :
 *   `Authorization: Bearer <jeton d'accès Keycloak>`, jeton lu en mémoire
 *   via `auth/session.ts` ; un 401 déclenche la reconnexion ;
 * - mode `dev` (développement local uniquement) : en-tête `x-dev-user`
 *   lu par le DevAuthProvider du backend. Ce code est retiré du bundle de
 *   production (condition remplacée par `false` au build).
 */
export const API_BASE_URL = resolveApiBaseUrl();
const API_PREFIX = '/api/v1';

/**
 * SEC-40 : aucun repli `http://` en production — le build de production
 * échoue déjà sans `NEXT_PUBLIC_API_URL` en https (voir `config/build-env.ts`) ;
 * le repli local n'existe qu'en développement.
 */
function resolveApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/$/, '');
  if (process.env.NODE_ENV !== 'production') return 'http://localhost:3001';
  return '';
}

export type QueryParams = Record<string, string | number | undefined>;

/**
 * Chemin d'API dont chaque segment interpolé est encodé (SEC-50) :
 * apiPath`/recours/${id}/transition` — un identifiant renvoyé par l'API
 * contenant `/`, `?`, `#` ou `..` ne peut pas détourner la requête vers une
 * autre route.
 */
export function apiPath(strings: TemplateStringsArray, ...values: (string | number)[]): string {
  return strings.reduce((acc, part, i) => acc + part + (i < values.length ? encodeURIComponent(String(values[i])) : ''), '');
}

function buildUrl(path: string, query?: QueryParams): string {
  if (!API_BASE_URL) throw new Error('NEXT_PUBLIC_API_URL manquant : configuration de production invalide.');
  const url = new URL(`${API_BASE_URL}${API_PREFIX}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

/** En-têtes d'authentification de la requête (voir doc du module). */
export async function authHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...extra };
  if (process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_AUTH_MODE === 'dev') {
    headers[DEV_USER_HEADER] = devUser();
    return headers;
  }
  const token = await getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let body: ApiErrorBody = { code: 'UNKNOWN', message: `Erreur HTTP ${res.status}` };
    try {
      body = await res.json();
    } catch {
      // réponse non JSON (ex: erreur réseau du proxy) — on garde le message par défaut.
    }
    // Session expirée ou jeton refusé : reconnexion Keycloak (sans effet en mode dev).
    if (res.status === 401) notifyUnauthorized();
    throw new ApiError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

interface RequestOptions {
  query?: QueryParams;
  json?: unknown;
  form?: FormData;
}

async function request<T>(method: string, path: string, { query, json, form }: RequestOptions = {}): Promise<T> {
  // multipart : pas de `Content-Type` manuel, le navigateur fixe le boundary lui-même.
  const headers = await authHeaders(json !== undefined ? { 'Content-Type': 'application/json' } : undefined);
  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: form ?? (json !== undefined ? JSON.stringify(json) : undefined),
      cache: 'no-store',
    });
  } catch {
    // Panne réseau, CORS, DNS… : message générique, jamais le détail technique (SEC-50).
    throw new ApiError(0, { code: 'NETWORK', message: '' });
  }
  return handle<T>(res);
}

export function apiGet<T>(path: string, query?: QueryParams): Promise<T> {
  return request<T>('GET', path, { query });
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('POST', path, { json: body });
}

export function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('PUT', path, { json: body });
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('PATCH', path, { json: body });
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>('DELETE', path);
}

/** POST multipart/form-data (ex: `POST /claims/import`, champ `file`). */
export function apiPostForm<T>(path: string, form: FormData): Promise<T> {
  return request<T>('POST', path, { form });
}
