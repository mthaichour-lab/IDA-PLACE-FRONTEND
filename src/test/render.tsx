import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';
import { I18nProvider } from '@/i18n/provider';
import { ToastProvider } from '@/components/ui/Toast';
import { AuthProvider } from '@/lib/auth-context';

/**
 * Rendu d'un écran sous les providers applicatifs réels (TanStack Query,
 * i18n, Toast, Auth) — SANS la coque `AppShell` (rail/topbar), qui n'est pas
 * le sujet de ces tests de composant. `AuthProvider` appelle réellement
 * `GET /me` via `fetch` : le test fournit cette réponse via `mockFetchJson`
 * (voir ci-dessous), exactement comme le ferait l'API réelle.
 */
export function renderWithProviders(ui: ReactElement): RenderResult {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <ToastProvider>
          <AuthProvider>{ui}</AuthProvider>
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

export type FetchHandler = (pathname: string, url: URL) => unknown | undefined;

/**
 * Variante de `mockFetchJson` pour les cas où la réponse dépend des
 * paramètres de requête (ex: pagination `?page=2&pageSize=6`) : `router`
 * reçoit l'URL complète et renvoie soit le corps JSON, soit `undefined`
 * (→ 404 normalisé, appel API non prévu par le test).
 */
export function mockFetchRouter(router: FetchHandler): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      const body = router(url.pathname, url);
      if (body === undefined) {
        return new Response(JSON.stringify({ code: 'NOT_FOUND', message: `Non mocké: ${url.pathname}${url.search}` }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
}

export interface FetchRequest {
  method: string;
  pathname: string;
  url: URL;
  body: unknown;
}

/**
 * Variante de `mockFetchRouter` qui expose la méthode HTTP et le corps JSON
 * envoyé, et laisse le test choisir le code de statut (ex: 409) —
 * `undefined` → 404 normalisé, comme les autres helpers.
 */
export function mockFetchRequests(router: (req: FetchRequest) => { status?: number; body: unknown } | undefined) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const res = router({ method: init?.method ?? 'GET', pathname: url.pathname, url, body });
    if (res === undefined) {
      return new Response(JSON.stringify({ code: 'NOT_FOUND', message: `Non mocké: ${url.pathname}${url.search}` }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(res.body), { status: res.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/**
 * Stub de `global.fetch` qui route sur le `pathname` de l'URL appelée
 * (le client HTTP du front, `src/lib/api-client.ts`, préfixe toujours
 * `/api/v1`). `handlers` associe un chemin exact (ex: `/api/v1/me`) à la
 * donnée JSON à renvoyer ; un chemin absent répond 404 normalisé, pour
 * détecter un appel API non prévu par le test plutôt que de le masquer.
 */
export function mockFetchJson(handlers: Record<string, unknown>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      const body = handlers[url.pathname];
      if (body === undefined) {
        return new Response(JSON.stringify({ code: 'NOT_FOUND', message: `Non mocké: ${url.pathname}` }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
}
