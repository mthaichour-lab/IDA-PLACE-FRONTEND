import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mockFetchJson, renderWithProviders } from '@/test/render';
import { MeResponse, MonthlyActivity, WilayaStat } from '@/lib/types';
import StatsPage from './page';

const ME: MeResponse = {
  user: { id: 'dev-op', name: 'Opérateur Place (dev)', email: 'operateur@finlab.dz' },
  role: 'OPERATEUR_PLACE',
  privileges: [],
};

const WILAYAS: WilayaStat[] = [
  { code: '16', name: 'Alger', col: 1, row: 1, declarations: 120, montants: 5_000_000, pour100k: 42 },
  { code: '31', name: 'Oran', col: 2, row: 1, declarations: 80, montants: 3_000_000, pour100k: 30 },
];

const MONTHLY: MonthlyActivity[] = [
  { month: '2026-09', declarations: 90, annexes2: 10, oppositions: 5, indemnises: 60, econstatMobile: 70, econstatAgence: 30 },
  { month: '2026-10', declarations: 110, annexes2: 12, oppositions: 6, indemnises: 70, econstatMobile: 75, econstatAgence: 25 },
];

/**
 * Écran Statistiques de la place (/stats, écran 11, Module H §6.10) —
 * carte des wilayas (référentiel réel), bascule déclarations/montants/pour
 * 100k habitants, répartition e-constat mobile vs agence.
 */
describe('Écran Statistiques de la place (/stats)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('affiche la carte des wilayas (une tuile par code, valeur = mesure "déclarations" par défaut)', async () => {
    mockFetchJson({ '/api/v1/me': ME, '/api/v1/stats/wilayas': WILAYAS, '/api/v1/stats/monthly': MONTHLY });

    renderWithProviders(<StatsPage />);

    await waitFor(() => expect(screen.getByTitle(/16 — Alger : 120/)).toBeInTheDocument());
    expect(screen.getByTitle(/31 — Oran : 80/)).toBeInTheDocument();
  });

  it('bascule sur la mesure "montants" via les onglets (valeur de la tuile mise à jour)', async () => {
    mockFetchJson({ '/api/v1/me': ME, '/api/v1/stats/wilayas': WILAYAS, '/api/v1/stats/monthly': MONTHLY });

    renderWithProviders(<StatsPage />);

    await waitFor(() => expect(screen.getByTitle(/16 — Alger : 120/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: /montants/i }));

    expect(screen.getByRole('tab', { name: /montants/i })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(screen.getByTitle(/16 — Alger : 5000000/)).toBeInTheDocument());
  });

  it("affiche un état vide explicite (pas de crash) si l'API renvoie une liste de wilayas vide", async () => {
    mockFetchJson({ '/api/v1/me': ME, '/api/v1/stats/wilayas': [], '/api/v1/stats/monthly': MONTHLY });

    renderWithProviders(<StatsPage />);

    await waitFor(() => expect(screen.getAllByText(/non encore disponible/i).length).toBeGreaterThan(0));
  });
});
