import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiGet, apiPath } from './api-client';
import { ApiError, GENERIC_MESSAGES, isDisplayableServerMessage, userMessage } from './api-error';

afterEach(() => vi.unstubAllGlobals());

describe('messages d’erreur présentés à l’utilisateur (SEC-50)', () => {
  it('5xx, 401, 429, 413, réseau : toujours génériques', () => {
    const leak = { code: 'X', message: 'QueryFailedError: relation "claims" does not exist at Pool.query (pg.js:12)' };
    expect(userMessage(500, leak)).toBe(GENERIC_MESSAGES.server);
    expect(userMessage(503, { code: 'SERVICE_UNAVAILABLE', message: 'Service en maintenance' })).toBe(GENERIC_MESSAGES.unavailable);
    expect(userMessage(401, { code: 'X', message: 'jwt expired' })).toBe(GENERIC_MESSAGES.unauthorized);
    expect(userMessage(429, { code: 'TOO_MANY_REQUESTS', message: 'ThrottlerException' })).toBe(GENERIC_MESSAGES.tooManyRequests);
    expect(userMessage(413, { code: 'PAYLOAD_TOO_LARGE', message: 'request entity too large' })).toBe(GENERIC_MESSAGES.tooLarge);
    expect(userMessage(0, undefined)).toBe(GENERIC_MESSAGES.network);
  });

  it('4xx : message métier conservé, détail technique remplacé', () => {
    expect(userMessage(403, { code: 'RECOURS_OUVERT', message: 'Un recours est ouvert sur ce dossier : responsabilité non modifiable.' })).toBe(
      'Un recours est ouvert sur ce dossier : responsabilité non modifiable.',
    );
    expect(userMessage(409, { code: 'FOUR_EYES', message: 'Le valideur doit être différent du saisisseur.' })).toBe('Le valideur doit être différent du saisisseur.');
    expect(userMessage(404, { code: 'NOT_FOUND', message: 'Cannot GET /api/v1/x' })).toBe(GENERIC_MESSAGES.notFound);
    expect(userMessage(403, { code: 'X', message: 'TypeError: cannot read properties of undefined' })).toBe(GENERIC_MESSAGES.forbidden);
    expect(userMessage(409, { code: 'X', message: 'ligne 1\nligne 2' })).toBe(GENERIC_MESSAGES.conflict);
    expect(userMessage(400, { code: 'X', message: 'x'.repeat(301) })).toBe(GENERIC_MESSAGES.rejected);
  });

  it('isDisplayableServerMessage', () => {
    expect(isDisplayableServerMessage('Motif d’opposition interdit.')).toBe(true);
    expect(isDisplayableServerMessage(['a', 'b'])).toBe(false);
    expect(isDisplayableServerMessage('SELECT * FROM users')).toBe(false);
  });

  it('ApiError : message sûr, détails des 5xx non conservés', () => {
    const err = new ApiError(500, { code: 'INTERNAL', message: 'stack trace…', details: { sql: 'x' } });
    expect(err.message).toBe(GENERIC_MESSAGES.server);
    expect(err.details).toBeUndefined();
    expect(err.status).toBe(500);
  });

  it('panne réseau : ApiError 0 générique', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch: getaddrinfo ENOTFOUND api'))),
    );
    await expect(apiGet('/me')).rejects.toMatchObject({ status: 0, message: GENERIC_MESSAGES.network });
  });
});

describe('apiPath — encodage des segments (SEC-50)', () => {
  it('encode chaque valeur interpolée', () => {
    expect(apiPath`/recours/${'R-1'}/transition`).toBe('/recours/R-1/transition');
    expect(apiPath`/recours/${'../admin/users'}/transition`).toBe('/recours/..%2Fadmin%2Fusers/transition');
    expect(apiPath`/metering/${'CAAT?x=1#y'}/${'2026-10'}`).toBe('/metering/CAAT%3Fx%3D1%23y/2026-10');
    expect(apiPath`/settlement/quarter/${2026}`).toBe('/settlement/quarter/2026');
  });

  it('la requête émise garde l’identifiant dans un seul segment', async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL) => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchFn);
    await apiGet(apiPath`/recours/${'x/../../admin'}`);
    expect(new URL(String(fetchFn.mock.calls[0][0])).pathname).toBe('/api/v1/recours/x%2F..%2F..%2Fadmin');
  });
});
