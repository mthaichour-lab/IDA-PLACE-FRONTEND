import { ApiError, ApiErrorBody } from './api-error';

/**
 * Client HTTP typé — unique point de contact avec l'API back-end
 * (C.4 : "le front consomme l'API REST versionnée"). Pointe vers
 * `NEXT_PUBLIC_API_URL` + préfixe `/api/v1`.
 *
 * ⚠️ DEV ONLY : l'en-tête `x-dev-user` simule l'authentification tant que
 * l'intégration OIDC Keycloak réelle n'est pas branchée côté front (voir
 * HANDOFF.md). À remplacer par le flux PKCE réel (jeton Bearer) sans
 * changer la forme des appels `apiGet`/`apiPost`/`apiPut` ci-dessous.
 */
const BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const API_PREFIX = '/api/v1';
/** Exporté pour `realtime.ts` : le handshake Socket.IO transmet la même identité dev via `auth`, pas un en-tête (impossible sur un WebSocket navigateur). */
export const DEV_USER = process.env.NEXT_PUBLIC_DEV_USER ?? 'OPERATEUR_PLACE';

function buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
  const url = new URL(`${BASE_URL}${API_PREFIX}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let body: ApiErrorBody = { code: 'UNKNOWN', message: `Erreur HTTP ${res.status}` };
    try {
      body = await res.json();
    } catch {
      // réponse non JSON (ex: erreur réseau du proxy) — on garde le message par défaut.
    }
    throw new ApiError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

function devHeaders(extra?: HeadersInit): HeadersInit {
  return { 'x-dev-user': DEV_USER, ...extra };
}

export async function apiGet<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
  const res = await fetch(buildUrl(path, query), { headers: devHeaders(), cache: 'no-store' });
  return handle<T>(res);
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(buildUrl(path), {
    method: 'POST',
    headers: devHeaders({ 'Content-Type': 'application/json' }),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return handle<T>(res);
}

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(buildUrl(path), {
    method: 'PUT',
    headers: devHeaders({ 'Content-Type': 'application/json' }),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return handle<T>(res);
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(buildUrl(path), { method: 'DELETE', headers: devHeaders() });
  return handle<T>(res);
}

/**
 * POST multipart/form-data (ex: `POST /claims/import`, champ `file`) — pas
 * de `Content-Type` manuel : le navigateur fixe le boundary lui-même.
 */
export async function apiPostForm<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(buildUrl(path), {
    method: 'POST',
    headers: devHeaders(),
    body: form,
  });
  return handle<T>(res);
}
