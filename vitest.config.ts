import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Configuration Vitest + React Testing Library pour les tests de
 * composants du front (aucun framework de test n'était configuré par le
 * socle — voir rapport QA). jsdom pour simuler le DOM, alias `@/*` aligné
 * sur `tsconfig.json`.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    css: false,
    // Les tests d'écran (userEvent + plusieurs requêtes simulées) dépassent
    // ponctuellement les 5 s par défaut sur une machine chargée ou un
    // runner CI partagé : marge explicite plutôt que des échecs aléatoires.
    testTimeout: 15_000,
    // Les tests d'écran tournent en mode d'authentification « dev » (en-tête
    // x-dev-user simulé, /me mocké) ; les tests du mode Keycloak forcent
    // leur propre environnement (`vi.stubEnv`).
    env: { NEXT_PUBLIC_AUTH_MODE: 'dev' },
    exclude: ['node_modules', '.next', 'e2e/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
