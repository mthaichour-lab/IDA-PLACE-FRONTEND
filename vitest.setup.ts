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
vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => {},
    disconnect: () => {},
  }),
}));

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
