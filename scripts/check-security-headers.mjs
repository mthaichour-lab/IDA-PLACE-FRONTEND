#!/usr/bin/env node
/**
 * Contrôle des en-têtes de sécurité d'un serveur Next.js démarré (SEC-22).
 * Usage : node scripts/check-security-headers.mjs http://localhost:3012/cockpit
 * Code de sortie 1 si un contrôle échoue (utilisé par la CI).
 */
const url = process.argv[2] ?? 'http://localhost:3000/cockpit';
const res = await fetch(url, { redirect: 'manual' });
const html = await res.text();
const h = (name) => res.headers.get(name) ?? '';
const csp = h('content-security-policy');
const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];

const checks = [
  ['statut 200', res.status === 200],
  ['CSP avec nonce', !!nonce],
  ["CSP sans 'unsafe-inline' pour les scripts", !/script-src[^;]*'unsafe-inline'/.test(csp)],
  ["frame-ancestors 'none'", csp.includes("frame-ancestors 'none'")],
  ["object-src 'none'", csp.includes("object-src 'none'")],
  ["base-uri 'self'", csp.includes("base-uri 'self'")],
  ["form-action 'self'", csp.includes("form-action 'self'")],
  ['HSTS', h('strict-transport-security').startsWith('max-age=63072000')],
  ['X-Content-Type-Options: nosniff', h('x-content-type-options') === 'nosniff'],
  ['Referrer-Policy', h('referrer-policy') === 'strict-origin-when-cross-origin'],
  ['Permissions-Policy', h('permissions-policy').includes('camera=()')],
  ['pas de X-Powered-By', !res.headers.has('x-powered-by')],
  ['tous les <script> portent le nonce', (html.match(/<script\b/g) ?? []).length === (html.match(new RegExp(`<script\\b[^>]*nonce="${nonce}"`, 'g')) ?? []).length],
];

let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'OK ' : 'KO '} ${label}`);
  if (!ok) failed++;
}
if (failed) {
  console.error(`${failed} contrôle(s) en échec sur ${url}`);
  process.exit(1);
}
