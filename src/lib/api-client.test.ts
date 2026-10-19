import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiGet, apiPost } from './api-client';
import { ApiError } from './api-error';
import { setAccessTokenGetter, setUnauthorizedHandler } from './auth/session';

function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

function headersOf(fn: ReturnType<typeof stubFetch>): Record<string, string> {
  return (fn.mock.calls[0][1]?.headers ?? {}) as Record<string, string>;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  setAccessTokenGetter(null);
  setUnauthorizedHandler(null);
});

describe('client API — authentification (SEC-01)', () => {
  it('mode keycloak : envoie le jeton en mémoire en Bearer, jamais x-dev-user', async () => {
    vi.stubEnv('NEXT_PUBLIC_AUTH_MODE', 'keycloak');
    setAccessTokenGetter(() => 'jeton-acces');
    const fetchFn = stubFetch(200, { ok: true });

    await apiGet('/me');

    const headers = headersOf(fetchFn);
    expect(headers.Authorization).toBe('Bearer jeton-acces');
    expect(headers['x-dev-user']).toBeUndefined();
  });

  it('mode keycloak sans session : aucun en-tête d’authentification', async () => {
    vi.stubEnv('NEXT_PUBLIC_AUTH_MODE', 'keycloak');
    const fetchFn = stubFetch(200, {});
    await apiGet('/me');
    expect(headersOf(fetchFn)).toEqual({});
  });

  it('mode dev (développement uniquement) : en-tête x-dev-user, pas de Bearer', async () => {
    vi.stubEnv('NEXT_PUBLIC_AUTH_MODE', 'dev');
    vi.stubEnv('NEXT_PUBLIC_DEV_USER', 'TRESORIER');
    setAccessTokenGetter(() => 'ne-doit-pas-servir');
    const fetchFn = stubFetch(200, {});
    await apiGet('/me');
    expect(headersOf(fetchFn)).toEqual({ 'x-dev-user': 'TRESORIER' });
  });

  it('le mode dev est ignoré si NODE_ENV=production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_AUTH_MODE', 'dev');
    setAccessTokenGetter(() => 'jeton');
    const fetchFn = stubFetch(200, {});
    await apiGet('/me');
    expect(headersOf(fetchFn)).toEqual({ Authorization: 'Bearer jeton' });
  });

  it('401 : déclenche la reconnexion et lève une ApiError 401', async () => {
    vi.stubEnv('NEXT_PUBLIC_AUTH_MODE', 'keycloak');
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    stubFetch(401, { code: 'UNAUTHORIZED', message: 'Jeton invalide' });

    await expect(apiGet('/me')).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('429 : lève une ApiError 429 sans relancer la connexion', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    stubFetch(429, { code: 'TOO_MANY_REQUESTS', message: 'ThrottlerException: Too Many Requests' });

    const err = await apiPost('/claims/import', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(429);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('JSON : Content-Type posé seulement quand un corps est envoyé', async () => {
    const fetchFn = stubFetch(200, {});
    await apiPost('/x', { a: 1 });
    expect(headersOf(fetchFn)['Content-Type']).toBe('application/json');
    expect(fetchFn.mock.calls[0][1]?.body).toBe('{"a":1}');
  });
});
