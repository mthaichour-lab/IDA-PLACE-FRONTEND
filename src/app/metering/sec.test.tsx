import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { suggestNextVersion, todayIso } from '@/components/metering/PriceGridEditor';
import { MeResponse, MeteringInvoice, PriceGrid } from '@/lib/types';
import { FetchRequest, mockFetchRequests, renderWithProviders } from '@/test/render';
import MeteringPage from './page';

/**
 * SEC-37 — écran 10 : facture `SIMULEE` affichée comme telle ; nouvelle
 * version de grille (`version` + `effectiveFrom` obligatoires, 409 si la
 * version existe déjà).
 */

const ME: MeResponse = { user: { id: 'u-op', name: 'Op.', email: 'op@uar.dz' }, role: 'OPERATEUR_PLACE', privileges: ['grid'] };

const GRID: PriceGrid = {
  version: 'TARIF-2026.01',
  effectiveFrom: '2026-01-01',
  subscription: { label: 'Standard', monthly: 50_000 },
  metrics: [{ metric: 'claimsIngested', label: 'Dossiers ingérés', unit: 'dossier', includedQuota: 600, unitPrice: 120 }],
};

const INVOICE: MeteringInvoice = {
  company: 'CAAT',
  period: '2026-10',
  gridVersion: 'TARIF-2026.01',
  subscription: { label: 'Standard', monthly: 50_000 },
  lines: [],
  totalHT: 50_000,
  totalTVA: 9_500,
  totalTTC: 59_500,
  status: 'SIMULEE',
  simulated: true,
};

const COMPANIES = { page: 1, total: 1, items: [{ id: 'co-1', code: 'CAAT', name: 'CAAT', color: '#111111', kind: 'INSURER', status: 'ACTIF' }] };

function mockApi(onPut: (req: FetchRequest) => { status?: number; body: unknown } = (req) => ({ body: req.body })) {
  const requests: FetchRequest[] = [];
  mockFetchRequests((req) => {
    requests.push(req);
    if (req.pathname === '/api/v1/me') return { body: ME };
    if (req.pathname === '/api/v1/referential/companies') return { body: COMPANIES };
    if (req.pathname === '/api/v1/pricing/grid') return req.method === 'PUT' ? onPut(req) : { body: GRID };
    if (/\/history\//.test(req.pathname)) return { body: { metric: 'claimsIngested', points: [] } };
    if (req.pathname.startsWith('/api/v1/metering/')) return { body: INVOICE };
    return undefined;
  });
  return requests;
}

describe('Écran 10 — facture simulée et grille versionnée (SEC-37)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('statut SIMULEE : libellé « Simulée » et avertissement explicite', async () => {
    mockApi();
    renderWithProviders(<MeteringPage />);

    expect(await screen.findByText(/Facture SIMULÉE : la consommation est simulée/)).toBeInTheDocument();
    expect(screen.getAllByText('Simulée').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('SIMULEE')).not.toBeInTheDocument();
  });

  it('modification : nouvelle version et date d’effet proposées, envoyées avec la grille', async () => {
    const requests = mockApi();
    renderWithProviders(<MeteringPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Modifier' }));
    const version = screen.getByLabelText('Nouvelle version (TARIF-AAAA.NN)') as HTMLInputElement;
    const effective = screen.getByLabelText("Date d'effet") as HTMLInputElement;
    expect(version.value).toBe(suggestNextVersion('TARIF-2026.01'));
    expect(effective.value).toBe(todayIso());

    // Même version que la grille en vigueur : enregistrement impossible.
    await user.clear(version);
    await user.type(version, 'TARIF-2026.01');
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();

    await user.clear(version);
    await user.type(version, 'TARIF-2099.07');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => expect(requests.some((r) => r.method === 'PUT')).toBe(true));
    const body = requests.find((r) => r.method === 'PUT')!.body as PriceGrid;
    expect(body.version).toBe('TARIF-2099.07');
    expect(body.effectiveFrom).toBe(todayIso());
    expect(body.metrics).toHaveLength(1);
  });

  it('409 VERSION_EXISTANTE : message traduit, l’éditeur reste ouvert', async () => {
    mockApi(() => ({ status: 409, body: { code: 'VERSION_EXISTANTE', message: 'La version existe déjà.' } }));
    renderWithProviders(<MeteringPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Modifier' }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText(/Cette version de grille existe déjà/)).toBeInTheDocument();
    expect(screen.getByLabelText('Nouvelle version (TARIF-AAAA.NN)')).toBeInTheDocument();
  });

  it('suggestNextVersion : incrément dans l’année, sinon première version de l’année', () => {
    const now = new Date('2026-10-19T10:00:00Z');
    expect(suggestNextVersion('TARIF-2026.01', now)).toBe('TARIF-2026.02');
    expect(suggestNextVersion('TARIF-2025.07', now)).toBe('TARIF-2026.01');
    expect(suggestNextVersion('v1', now)).toBe('TARIF-2026.01');
    expect(suggestNextVersion('TARIF-2027.03', now)).toBe('TARIF-2027.04');
  });
});
