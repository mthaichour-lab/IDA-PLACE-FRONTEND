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
    exclude: ['node_modules', '.next', 'e2e/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
