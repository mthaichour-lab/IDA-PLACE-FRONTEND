// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxy } from './proxy';

afterEach(() => vi.unstubAllEnvs());

describe('proxy — CSP avec nonce (SEC-22)', () => {
  it('pose une CSP stricte avec un nonce frais, transmis aussi à la requête', () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.ida-place.example');
    vi.stubEnv('NEXT_PUBLIC_KEYCLOAK_URL', 'https://auth.ida-place.example');

    const first = proxy(new NextRequest('https://app.ida-place.example/cockpit'));
    const second = proxy(new NextRequest('https://app.ida-place.example/cockpit'));
    const csp = first.headers.get('Content-Security-Policy') ?? '';

    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(second.headers.get('Content-Security-Policy')).not.toContain(nonce!);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain('https://api.ida-place.example wss://api.ida-place.example');
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    // Next.js lit le nonce dans les en-têtes de la requête réécrite.
    expect(first.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
  });
});
