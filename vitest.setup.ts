import '@testing-library/jest-dom/vitest';

// `next/navigation` n'est pas disponible hors du runtime Next.js réel ;
// les écrans testés ne l'utilisent pas directement, mais certains
// composants transverses importent `usePathname` (Rail) — stub minimal.
import { vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

// `socket.io-client` tenterait une vraie connexion réseau (localhost:3001)
// dans jsdom — stub générique qui ne se connecte jamais, pour que
// `useRealtime` (src/lib/realtime.ts) se comporte comme en mode dégradé
// (repli polling), exactement le scénario que l'on veut vérifier.
//
// Le stub capture aussi les callbacks `socket.on(event, cb)` enregistrés
// par `useRealtime` dans un registre module-scope, pour que les tests de
// composant puissent simuler la RÉCEPTION d'un événement temps réel (ex.
// `/cockpit`, "Flux temps réel") sans ouvrir de vraie connexion WebSocket —
// voir `triggerRealtimeEvent` ci-dessous. `disconnect()` (appelé au
// démontage, voir le cleanup de `useEffect` dans `useRealtime`) vide le
// registre : le cleanup automatique de Testing Library entre deux tests
// suffit donc à isoler les tests les uns des autres.
type RealtimeTestHandler = (payload: unknown) => void;
const realtimeTestHandlers = new Map<string, RealtimeTestHandler[]>();

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: (event: string, cb: RealtimeTestHandler) => {
      const list = realtimeTestHandlers.get(event) ?? [];
      list.push(cb);
      realtimeTestHandlers.set(event, list);
    },
    disconnect: () => {
      realtimeTestHandlers.clear();
    },
  }),
}));

/** Simule la réception d'un événement temps réel (voir le stub `socket.io-client` ci-dessus). */
export function triggerRealtimeEvent(event: string, payload: unknown): void {
  for (const cb of realtimeTestHandlers.get(event) ?? []) cb(payload);
}

// matchMedia (thème clair/sombre via prefers-color-scheme) — absent de jsdom.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
