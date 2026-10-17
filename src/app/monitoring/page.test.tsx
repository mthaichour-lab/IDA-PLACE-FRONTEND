import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mockFetchJson, renderWithProviders } from '@/test/render';
import { MeResponse, MonitoringCompanyScore, MonitoringScores } from '@/lib/types';
import MonitoringPage from './page';

const ME: MeResponse = {
  user: { id: 'dev-op', name: 'Opérateur Place (dev)', email: 'operateur@finlab.dz' },
  role: 'OPERATEUR_PLACE',
  privileges: [],
};

function companyScore(code: string, score: number | null, overrides: Partial<MonitoringCompanyScore> = {}): MonitoringCompanyScore {
  return {
    code,
    score,
    rank: 1,
    details: {
      delais: { value: score, dataSource: score === null ? 'NON_DISPONIBLE' : 'REEL', sampleSize: 12 },
      silences: { value: score, dataSource: score === null ? 'NON_DISPONIBLE' : 'REEL', sampleSize: 12 },
      oppositions: { value: score, dataSource: score === null ? 'NON_DISPONIBLE' : 'REEL', sampleSize: 12 },
      qualiteDonnees: { value: score, dataSource: score === null ? 'NON_DISPONIBLE' : 'REEL', sampleSize: 12 },
      forclusions: { value: score, dataSource: score === null ? 'NON_DISPONIBLE' : 'REEL', sampleSize: 12 },
      demandesTardives: { value: score, dataSource: score === null ? 'NON_DISPONIBLE' : 'REEL', sampleSize: 12 },
      penalites: { value: score, dataSource: score === null ? 'NON_DISPONIBLE' : 'REEL', sampleSize: 12 },
    },
    ...overrides,
  };
}

const WEIGHTS = { delais: 0.3, silences: 0.15, oppositions: 0.15, qualiteDonnees: 0.15, forclusions: 0.1, demandesTardives: 0.1, penalites: 0.05 };

/**
 * Écran Monitoring & scoring (/monitoring, écran 8, B.2/§6.8) — rendu du
 * classement des compagnies, repère "non disponible" (jamais de crash) sur
 * une composante `NON_DISPONIBLE` (`value: null`), panneau de détail au clic.
 */
describe('Écran Monitoring & scoring (/monitoring)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('affiche le classement des compagnies avec leur score', async () => {
    const scores: MonitoringScores = { weights: WEIGHTS, companies: [companyScore('CAAT', 82), companyScore('SAA', 65, { rank: 2 })], notes: [] };
    mockFetchJson({ '/api/v1/me': ME, '/api/v1/monitoring/scores': scores });

    renderWithProviders(<MonitoringPage />);

    await waitFor(() => expect(screen.getAllByText('CAAT').length).toBeGreaterThan(0));
    expect(screen.getAllByText('SAA').length).toBeGreaterThan(0);
  });

  it('affiche un repère "non disponible" plutôt qu\'un crash pour une composante NON_DISPONIBLE', async () => {
    const scores: MonitoringScores = { weights: WEIGHTS, companies: [companyScore('CAAT', null)], notes: [] };
    mockFetchJson({ '/api/v1/me': ME, '/api/v1/monitoring/scores': scores });

    renderWithProviders(<MonitoringPage />);

    await waitFor(() => expect(screen.getAllByText('CAAT').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Aucune donnée.').length).toBeGreaterThan(0);
  });

  it('affiche le détail de la compagnie sélectionnée par défaut (la première du classement)', async () => {
    const scores: MonitoringScores = { weights: WEIGHTS, companies: [companyScore('CAAT', 82)], notes: [] };
    mockFetchJson({ '/api/v1/me': ME, '/api/v1/monitoring/scores': scores });

    renderWithProviders(<MonitoringPage />);

    await waitFor(() => expect(screen.getAllByText('CAAT').length).toBeGreaterThan(0));
    expect(screen.getAllByText('#1').length).toBeGreaterThan(0);
  });
});
