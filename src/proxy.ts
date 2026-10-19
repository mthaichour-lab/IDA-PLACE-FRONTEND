import { NextRequest, NextResponse } from 'next/server';
import { buildCsp } from '../config/build-env';

/**
 * Content-Security-Policy par requête avec nonce — SEC-22.
 *
 * L'App Router injecte des scripts en ligne (charge utile RSC,
 * hydratation) : sans nonce, une CSP stricte (`script-src` sans
 * `'unsafe-inline'`) les bloquerait. Next.js lit le nonce dans l'en-tête
 * `Content-Security-Policy` de la REQUÊTE et l'applique à ses propres
 * scripts ; les pages doivent donc être rendues dynamiquement (voir
 * `src/app/layout.tsx`, `await connection()`).
 *
 * Les autres en-têtes de sécurité (HSTS, nosniff, Referrer-Policy,
 * Permissions-Policy…) sont posés par `next.config.ts` `headers()`.
 */
export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const isDev = process.env.NODE_ENV === 'development';
  const csp = buildCsp({
    nonce,
    isDev,
    apiUrl: process.env.NEXT_PUBLIC_API_URL ?? (isDev ? 'http://localhost:3001' : undefined),
    keycloakUrl: process.env.NEXT_PUBLIC_KEYCLOAK_URL,
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Toutes les pages, hors ressources statiques et préchargements de `next/link`.
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
