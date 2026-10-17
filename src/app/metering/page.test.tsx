import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mockFetchRouter, renderWithProviders } from '@/test/render';
import { CompanyView, MeResponse, MeteringInvoice, Paginated, PriceGrid } from '@/lib/types';
import MeteringPage from './page';

const ME: MeResponse = {
  user: { id: 'dev-op', name: 'Opérateur Place (dev)', email: 'operateur@finlab.dz' },
  role: 'OPERATEUR_PLACE',
  privileges: ['grid'],
};

const COMPANIES: Paginated<CompanyView> = {
  page: 1,
  total: 1,
  items: [{ id: 'co-1', code: 'CAAT', name: 'CAAT', color: '#111', kind: 'INSURER', feedMode: 'API', status: 'ACTIF', apiKeyMasked: '****' }],
};

const GRID: PriceGrid = {
  version: 'v1',
  effectiveFrom: '2026-01-01',
  subscription: { label: 'Standard', monthly: 50_000 },
  metrics: [{ metric: 'claims', label: 'Dossiers', unit: 'dossier', includedQuota: 100, unitPrice: 50 }],
};

function invoice(overrides: Partial<MeteringInvoice> = {}): MeteringInvoice {
  return {
    company: 'CAAT',
    period: '2026-10',
    gridVersion: 'v1',
    subscription: { label: 'Standard', monthly: 50_000 },
    lines: [{ metric: 'claims', label: 'Dossiers', unit: 'dossier', includedQuota: 100, unitPrice: 50, measured: 120, facturable: 20, amount: 1000 }],
    totalHT: 51_000,
    totalTVA: 9_690,
    totalTTC: 60_690,
    status: 'EMISE',
    ...overrides,
  };
}

function mockMeteringApi(inv: MeteringInvoice) {
  mockFetchRouter((pathname) => {
    if (pathname === '/api/v1/me') return ME;
    if (pathname === '/api/v1/referential/companies') return COMPANIES;
    if (pathname.startsWith('/api/v1/metering/')) return inv;
    if (pathname === '/api/v1/pricing/grid') return GRID;
    return undefined;
  });
}

/**
 * Écran Métrologie & facturation (/metering, écran 10, B.8) — facture
 * calculée (quota/dépassement/montant), grille tarifaire éditable selon le
 * privilège `grid`.
 */
describe('Écran Métrologie & facturation (/metering)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('affiche la facture de la période (quota, dépassement, montant TTC)', async () => {
    mockMeteringApi(invoice());
    renderWithProviders(<MeteringPage />);

    await waitFor(() => expect(screen.getAllByText('Dossiers').length).toBeGreaterThan(0));
    expect(screen.getByText(/60\s?690/)).toBeInTheDocument();
  });

  it('affiche la grille tarifaire courante', async () => {
    mockMeteringApi(invoice());
    renderWithProviders(<MeteringPage />);

    await waitFor(() => expect(screen.getAllByText('Dossiers').length).toBeGreaterThan(0));
    expect(screen.getByText(/v1/)).toBeInTheDocument();
  });
});
