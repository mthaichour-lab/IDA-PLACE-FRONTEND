import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BaremeVersion, MeResponse, StatsSummary } from '@/lib/types';
import { mockFetchRouter, renderWithProviders } from '@/test/render';
import StatsPage from './page';

/** Écran 11 — répartition par code de barème et par catégorie, dossiers sans valeur comptés à part (décision PO §5). */

const ME: MeResponse = { user: { id: 'u', name: 'Opérateur', email: 'op@uar.dz' }, role: 'OPERATEUR_PLACE', privileges: [] };

const BASE: StatsSummary = {
  declarations: 10,
  oppositionRatePct: 0,
  settledAmount: 0,
  avgSettlementDays: null,
  irsam: null,
  irsamStatus: 'NON_RENSEIGNE',
  baremeCodes: { items: [], sansValeur: 10 },
  vehicleCategories: { items: [], sansValeur: 10 },
};

const PUBLISHED: BaremeVersion = {
  id: 'v',
  label: 'Barème UAR 2026',
  status: 'VALIDE_UAR',
  createdBy: 'u-op',
  createdAt: '2026-10-19T08:00:00.000Z',
  cases: [{ code: 'X1', label: 'Choc arrière', partA: 0, partB: 100, createdBy: 'u-op', createdAt: '2026-10-19T08:00:00.000Z' }],
};

function mockStats(summary: StatsSummary, versions: BaremeVersion[] = []) {
  mockFetchRouter((pathname) => {
    if (pathname === '/api/v1/me') return ME;
    if (pathname === '/api/v1/stats/summary') return summary;
    if (pathname === '/api/v1/stats/monthly' || pathname === '/api/v1/stats/wilayas' || pathname === '/api/v1/referential/wilaya-populations') return [];
    if (pathname === '/api/v1/referential/bareme-versions') return versions;
    if (pathname === '/api/v1/referential/vehicle-categories') return [];
    return undefined;
  });
}

describe('Écran 11 — répartition barème Art. 14 (décision PO §5)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('répartit par code et par catégorie, avec la ligne « Sans valeur » à part', async () => {
    mockStats({ ...BASE, baremeCodes: { items: [{ code: 'X1', count: 4 }, { code: 'X2', count: 3 }], sansValeur: 3 }, vehicleCategories: { items: [{ code: 'VL', count: 6 }], sansValeur: 4 } }, [PUBLISHED]);
    renderWithProviders(<StatsPage />);

    const byCode = await screen.findByRole('region', { name: 'Par code de barème' });
    expect(within(byCode).getByText('X1').parentElement).toHaveTextContent('X14');
    expect(within(byCode).getByText('X2').parentElement).toHaveTextContent('X23');
    expect(byCode).toHaveTextContent('Sans valeur : 3');
    expect(within(byCode).queryByText('Barème non publié')).not.toBeInTheDocument();

    const byCategory = screen.getByRole('region', { name: 'Par catégorie de véhicule (véhicule assuré)' });
    expect(within(byCategory).getByText('VL').parentElement).toHaveTextContent('VL6');
    expect(byCategory).toHaveTextContent('Sans valeur : 4');
  });

  it('sans aucun code : « Barème non publié », et « Sans valeur » reste visible', async () => {
    mockStats(BASE);
    renderWithProviders(<StatsPage />);

    const byCode = await screen.findByRole('region', { name: 'Par code de barème' });
    expect(within(byCode).getByText('Barème non publié')).toBeInTheDocument();
    expect(byCode).toHaveTextContent('Sans valeur : 10');
    const byCategory = screen.getByRole('region', { name: 'Par catégorie de véhicule (véhicule assuré)' });
    expect(byCategory).toHaveTextContent('Sans valeur : 10');
    expect(within(byCategory).getByText('Catégories de véhicule non publiées')).toBeInTheDocument();
    expect(within(byCategory).queryByText('Barème non publié')).not.toBeInTheDocument();
  });

  it('barème publié mais aucun dossier codé : pas de « Barème non publié »', async () => {
    mockStats(BASE, [PUBLISHED]);
    renderWithProviders(<StatsPage />);

    const byCode = await screen.findByRole('region', { name: 'Par code de barème' });
    await waitFor(() => expect(within(byCode).queryByText('Barème non publié')).not.toBeInTheDocument());
    expect(byCode).toHaveTextContent('Sans valeur : 10');
  });
});
