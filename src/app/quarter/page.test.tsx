import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mockFetchRouter, renderWithProviders } from '@/test/render';
import { MeResponse, PriceGrid, SettlementQuarter, SettlementQuarterMatrix, SettlementQuarterSummary } from '@/lib/types';
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

const SUMMARY: SettlementQuarterSummary = {
  quarter: '2026-Q4',
  grossTotal: 400_000,
  bilateralNetTotal: 250_000,
  multilateralNetTotal: 250_000,
  reductionPct: 37.5,
  settledCount: 3,
  opposedCount: 1,
};

const MATRIX: SettlementQuarterMatrix = {
  quarter: '2026-Q4',
  companies: ['CAAT', 'SAA'],
  cells: [
    { from: 'CAAT', to: 'SAA', amount: 300_000 },
    { from: 'SAA', to: 'CAAT', amount: 50_000 },
  ],
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
    if (pathname === '/api/v1/settlement/quarter/2026-Q4/summary') return SUMMARY;
    if (pathname === '/api/v1/settlement/quarter/2026-Q4/matrix') return MATRIX;
    if (pathname === '/api/v1/settlement/quarter/2026-Q4') return QUARTER;
    if (pathname === '/api/v1/pricing/grid') return GRID;
    return undefined;
  });
}

/**
 * Écran Compensation trimestrielle (/quarter, écran 6, Module D §6.6) — KPI
 * de synthèse (brut/net bilatéral/net multilatéral/réduction/recours
 * compensés/en opposition), positions nettes multilatérales par compagnie,
 * matrice des positions BRUTES (créancier × débiteur, avant tout netting),
 * bordereau de référence.
 */
describe('Écran Compensation trimestrielle (/quarter)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('affiche les KPI de synthèse (brut, net bilatéral, net multilatéral, réduction, recours)', async () => {
    mockQuarterApi();
    renderWithProviders(<QuarterPage />);

    await waitFor(() => expect(screen.getAllByText(/400\s?000/).length).toBeGreaterThan(0));
    expect(screen.getByText('37.5%')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('affiche la position nette par compagnie, dans le bon sens (à recevoir / à payer)', async () => {
    mockQuarterApi();
    renderWithProviders(<QuarterPage />);

    await waitFor(() => expect(screen.getAllByText(/250\s?000/).length).toBeGreaterThan(0));
    expect(screen.getAllByText('À recevoir').length).toBeGreaterThan(0);
    expect(screen.getAllByText('À payer').length).toBeGreaterThan(0);
  });

  it('affiche la matrice des positions brutes (créancier × débiteur), distincte des positions nettes', async () => {
    mockQuarterApi();
    renderWithProviders(<QuarterPage />);

    await waitFor(() => expect(screen.getByRole('table', { name: /positions brutes/i })).toBeInTheDocument());
    expect(screen.getAllByText(/300\s?000/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/50\s?000/).length).toBeGreaterThan(0);
  });

  it('affiche la référence du bordereau trimestriel', async () => {
    mockQuarterApi();
    renderWithProviders(<QuarterPage />);

    await waitFor(() => expect(screen.getByText('BORD-2026-Q4')).toBeInTheDocument());
  });
});
