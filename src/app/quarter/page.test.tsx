import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mockFetchRouter, renderWithProviders } from '@/test/render';
import { MeResponse, PriceGrid, SettlementQuarter } from '@/lib/types';
import QuarterPage from './page';

const ME: MeResponse = {
  user: { id: 'dev-op', name: 'Opérateur Place (dev)', email: 'operateur@finlab.dz' },
  role: 'OPERATEUR_PLACE',
  privileges: [],
};

const QUARTER: SettlementQuarter = {
  quarter: '2026-Q4',
  bordereau: 'BORD-2026-Q4',
  positions: [{ from: 'CAAT', to: 'SAA', amount: 250_000 }],
  net: [
    { code: 'CAAT', net: -250_000 },
    { code: 'SAA', net: 250_000 },
  ],
  closedAt: undefined,
};

const GRID: PriceGrid = {
  version: 'TARIF-2026.01',
  effectiveFrom: '2026-01-01',
  subscription: { label: 'Standard', monthly: 50_000 },
  metrics: [{ metric: 'claims', label: 'Dossiers', unit: 'dossier', includedQuota: 100, unitPrice: 50 }],
};

function mockQuarterApi() {
  mockFetchRouter((pathname) => {
    if (pathname === '/api/v1/me') return ME;
    if (pathname.startsWith('/api/v1/settlement/quarter/')) return QUARTER;
    if (pathname === '/api/v1/pricing/grid') return GRID;
    return undefined;
  });
}

/**
 * Écran Compensation trimestrielle (/quarter, écran 6, Module D §6.6) —
 * matrice de compensation from→to, position nette par compagnie
 * (positif = à recevoir, négatif = à payer), bordereau de référence.
 */
describe('Écran Compensation trimestrielle (/quarter)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('affiche la matrice de compensation et le montant from→to', async () => {
    mockQuarterApi();
    renderWithProviders(<QuarterPage />);

    await waitFor(() => expect(screen.getAllByText(/250\s?000/).length).toBeGreaterThan(0));
    expect(screen.getByRole('table', { name: /positions bilatérales/i })).toBeInTheDocument();
  });

  it('affiche la position nette par compagnie avec le bon sens (à recevoir / à payer)', async () => {
    mockQuarterApi();
    renderWithProviders(<QuarterPage />);

    await waitFor(() => expect(screen.getAllByText(/250\s?000/).length).toBeGreaterThan(0));
    expect(screen.getByText('À recevoir')).toBeInTheDocument();
    expect(screen.getByText('À payer')).toBeInTheDocument();
  });

  it('affiche la référence du bordereau trimestriel', async () => {
    mockQuarterApi();
    renderWithProviders(<QuarterPage />);

    await waitFor(() => expect(screen.getByText('BORD-2026-Q4')).toBeInTheDocument());
  });
});
