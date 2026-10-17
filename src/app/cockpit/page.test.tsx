import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mockFetchRouter, renderWithProviders } from '@/test/render';
import { CockpitSummary, MeResponse } from '@/lib/types';
import CockpitPage from './page';

const ME: MeResponse = {
  user: { id: 'dev-op', name: 'Opérateur Place (dev)', email: 'operateur@finlab.dz' },
  role: 'OPERATEUR_PLACE',
  privileges: ['admin'],
};

const SUMMARY: CockpitSummary = {
  kpis: { dossiersDuJour: 4, aApparier: 2, enRetard: 0, compensationAVenir: 390000 },
  sparklineDeclarations: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4],
  barresNettes: [
    { company: 'SAA', net: -650000 },
    { company: 'CAAT', net: 650000 },
  ],
  updatedAt: new Date('2026-10-16T23:58:17.097Z').toISOString(),
};

/**
 * Écran Cockpit de place (/cockpit, écran 1) — les KPIs affichés reflètent
 * exactement ce que l'API renvoie (zéro règle métier côté front, C.1), et
 * le badge "Mode polling" confirme le repli de secours quand le flux
 * Socket.IO n'est pas utilisable (ici : `socket.io-client` mocké en no-op,
 * voir `vitest.setup.ts`) — jamais le WS comme seul mécanisme de
 * rafraîchissement (HANDOFF frontend).
 */
describe('Écran Cockpit de place (/cockpit)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('affiche les 4 KPIs renvoyés par GET /cockpit/summary, sans recalcul côté front', async () => {
    mockFetchRouter((pathname) => {
      if (pathname === '/api/v1/me') return ME;
      if (pathname === '/api/v1/cockpit/summary') return SUMMARY;
      return undefined;
    });

    renderWithProviders(<CockpitPage />);

    await waitFor(() => expect(screen.getByText('4')).toBeInTheDocument());
    expect(screen.getByText('Dossiers du jour')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('À apparier')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('En retard')).toBeInTheDocument();
    // Montant formaté DZD — le chiffre brut vient tel quel de l'API (390000).
    expect(screen.getByText(/390\s?000/)).toBeInTheDocument();
  });

  it('affiche le badge "Mode polling" quand le flux temps réel ne confirme aucun événement', async () => {
    mockFetchRouter((pathname) => {
      if (pathname === '/api/v1/me') return ME;
      if (pathname === '/api/v1/cockpit/summary') return SUMMARY;
      return undefined;
    });

    renderWithProviders(<CockpitPage />);
    await waitFor(() => expect(screen.getByText('Mode polling (temps réel indisponible)')).toBeInTheDocument());
    expect(screen.queryByText('Temps réel actif')).not.toBeInTheDocument();
  });

  it('affiche les raccourcis vers /matching et /import', async () => {
    mockFetchRouter((pathname) => {
      if (pathname === '/api/v1/me') return ME;
      if (pathname === '/api/v1/cockpit/summary') return SUMMARY;
      return undefined;
    });

    renderWithProviders(<CockpitPage />);
    await waitFor(() => expect(screen.getByRole('link', { name: /confrontation/i })).toHaveAttribute('href', '/matching'));
    expect(screen.getByRole('link', { name: /importer des dossiers/i })).toHaveAttribute('href', '/import');
  });

  it("affiche un état d'erreur avec action de nouvelle tentative si l'API échoue", async () => {
    mockFetchRouter((pathname) => {
      if (pathname === '/api/v1/me') return ME;
      return undefined; // /cockpit/summary non mocké => 404
    });

    renderWithProviders(<CockpitPage />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /réessayer|retry/i })).toBeInTheDocument();
  });
});
