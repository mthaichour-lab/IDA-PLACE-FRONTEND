import { describe, expect, it } from 'vitest';
import { assertProductionEnv, buildCsp, originOf, productionEnvErrors, PublicEnv, staticSecurityHeaders, websocketOrigin } from './build-env';

const VALID: PublicEnv = {
  NODE_ENV: 'production',
  NEXT_PUBLIC_AUTH_MODE: 'keycloak',
  NEXT_PUBLIC_API_URL: 'https://api.ida-place.example',
  NEXT_PUBLIC_KEYCLOAK_URL: 'https://auth.ida-place.example',
  NEXT_PUBLIC_KEYCLOAK_REALM: 'ida-place',
  NEXT_PUBLIC_KEYCLOAK_CLIENT_ID: 'ida-place-web',
};

describe('garde de configuration du build de production (SEC-01 / SEC-40)', () => {
  it('accepte une configuration Keycloak complète avec une API en https', () => {
    expect(productionEnvErrors(VALID)).toEqual([]);
    expect(() => assertProductionEnv(VALID)).not.toThrow();
  });

  it.each([
    ['mode dev', { NEXT_PUBLIC_AUTH_MODE: 'dev' }, /NEXT_PUBLIC_AUTH_MODE/],
    ['mode absent', { NEXT_PUBLIC_AUTH_MODE: undefined }, /NEXT_PUBLIC_AUTH_MODE/],
    ['identité de développement', { NEXT_PUBLIC_DEV_USER: 'ADMIN_UAR' }, /NEXT_PUBLIC_DEV_USER/],
    ['API absente', { NEXT_PUBLIC_API_URL: undefined }, /NEXT_PUBLIC_API_URL est obligatoire/],
    ['API en http', { NEXT_PUBLIC_API_URL: 'http://api.ida-place.example' }, /https:\/\//],
    ['API invalide', { NEXT_PUBLIC_API_URL: 'pas une url' }, /https:\/\//],
    ['Keycloak en http', { NEXT_PUBLIC_KEYCLOAK_URL: 'http://auth.ida-place.example' }, /NEXT_PUBLIC_KEYCLOAK_URL/],
    ['realm absent', { NEXT_PUBLIC_KEYCLOAK_REALM: '' }, /NEXT_PUBLIC_KEYCLOAK_REALM/],
    ['client absent', { NEXT_PUBLIC_KEYCLOAK_CLIENT_ID: undefined }, /NEXT_PUBLIC_KEYCLOAK_CLIENT_ID/],
  ])('refuse : %s', (_label, override, pattern) => {
    const env = { ...VALID, ...override };
    expect(() => assertProductionEnv(env)).toThrow(pattern);
  });

  it('tolère NEXT_PUBLIC_DEV_USER vide (variable neutralisée en ligne de commande)', () => {
    expect(productionEnvErrors({ ...VALID, NEXT_PUBLIC_DEV_USER: '' })).toEqual([]);
  });

  it('liste toutes les erreurs en une fois', () => {
    expect(productionEnvErrors({ NODE_ENV: 'production' }).length).toBeGreaterThanOrEqual(5);
  });
});

describe('origines et CSP (SEC-22 / SEC-40)', () => {
  it('dérive l’origine WebSocket : https → wss, http → ws', () => {
    expect(websocketOrigin('https://api.ida-place.example')).toBe('wss://api.ida-place.example');
    expect(websocketOrigin('http://localhost:3001')).toBe('ws://localhost:3001');
    expect(originOf('https://api.ida-place.example/base/')).toBe('https://api.ida-place.example');
    expect(originOf('n’importe quoi')).toBeUndefined();
  });

  it('produit une CSP stricte en production', () => {
    const csp = buildCsp({ nonce: 'abc123', isDev: false, apiUrl: VALID.NEXT_PUBLIC_API_URL, keycloakUrl: VALID.NEXT_PUBLIC_KEYCLOAK_URL });
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("connect-src 'self' https://api.ida-place.example wss://api.ida-place.example https://auth.ida-place.example");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self' https://auth.ida-place.example");
    expect(csp).toContain('upgrade-insecure-requests');
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it('n’autorise unsafe-eval et ws: qu’en développement', () => {
    const csp = buildCsp({ nonce: 'n', isDev: true, apiUrl: 'http://localhost:3001' });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain('ws://localhost:3001');
    expect(csp).not.toContain('upgrade-insecure-requests');
  });

  it('pose HSTS en production uniquement, et les en-têtes de base partout', () => {
    const prod = Object.fromEntries(staticSecurityHeaders(true).map((h) => [h.key, h.value]));
    expect(prod['Strict-Transport-Security']).toBe('max-age=63072000; includeSubDomains');
    expect(prod['X-Content-Type-Options']).toBe('nosniff');
    expect(prod['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(prod['Permissions-Policy']).toContain('camera=()');
    const dev = staticSecurityHeaders(false).map((h) => h.key);
    expect(dev).not.toContain('Strict-Transport-Security');
    expect(dev).toContain('X-Content-Type-Options');
  });
});
