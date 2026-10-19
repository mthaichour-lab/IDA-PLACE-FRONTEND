import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from 'next/constants';
import { assertProductionEnv, staticSecurityHeaders } from './config/build-env';

/**
 * Configuration Next.js — durcissement SEC-01 / SEC-22 / SEC-40.
 *
 * - `next build` échoue si la configuration publique n'est pas une
 *   configuration de production sûre (Keycloak, API en https, aucune
 *   identité de développement) : voir `config/build-env.ts`.
 * - En-têtes de sécurité statiques sur toutes les routes, sans
 *   `X-Powered-By` ; la CSP (nonce par requête) est posée par `src/proxy.ts`.
 */
export default function nextConfig(phase: string): NextConfig {
  const isProdBuild = phase === PHASE_PRODUCTION_BUILD;
  // `next dev` lancé avec NODE_ENV=production : même exigence qu'un build.
  if (isProdBuild || (phase === PHASE_DEVELOPMENT_SERVER && process.env.NODE_ENV === 'production')) {
    assertProductionEnv(process.env);
  }

  const isProd = phase !== PHASE_DEVELOPMENT_SERVER;

  return {
    reactStrictMode: true,
    poweredByHeader: false,
    async headers() {
      return [{ source: '/:path*', headers: staticSecurityHeaders(isProd) }];
    },
    // Aucune source map dans le build de production (ni navigateur, ni
    // serveur) : le code source ne doit pas être livré avec l'image, et le
    // contrôle « pas de x-dev-user dans .next/ » doit porter sur tout le
    // répertoire.
    productionBrowserSourceMaps: false,
    ...(isProdBuild ? { experimental: { serverSourceMaps: false, turbopackSourceMaps: false } } : {}),
  };
}
