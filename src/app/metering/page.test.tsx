import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mockFetchRouter, renderWithProviders } from '@/test/render';
import { CompanyView, MeResponse, MeteringHistory, MeteringInvoice, Paginated, PriceGrid } from '@/lib/types';
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
  metrics: [
    { metric: 'claims', label: 'Dossiers', unit: 'dossier', includedQuota: 100, unitPrice: 50 },
    { metric: 'claimsIngested', label: 'Dossiers ingérés', unit: 'dossier', includedQuota: 600, unitPrice: 120 },
    { metric: 'apiCalls', label: 'Appels API', unit: '1 000 appels', includedQuota: 150_000, unitPrice: 45 },
  ],
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

function historyFor(metric: string, points: number[]): MeteringHistory {
  return {
    metric,
    points: points.map((value, i) => ({ period: `2026-${String(i + 1).padStart(2, '0')}`, value })),
  };
}

const HISTORY_BY_METRIC: Record<string, MeteringHistory> = {
  claimsIngested: historyFor('claimsIngested', [350, 410, 460, 540, 520, 600, 680, 740, 720, 310]),
  apiCalls: historyFor('apiCalls', [120_000, 130_000, 140_000, 150_000, 148_000, 160_000, 170_000, 180_000, 178_000, 80_000]),
};

/**
 * Route par défaut partagée par les tests ci-dessous : `/me`, les
 * compagnies, la facture de la période, la grille tarifaire, et
 * l'historique mensuel (nouveau, `GET /metering/{company}/{period}/
 * history/{metric}` — additif, voir `types.ts`/HANDOFF.md). La route de
 * l'historique est testée AVANT celle de la facture : les deux chemins
 * commencent par `/api/v1/metering/...`, seul l'ordre des `if` évite de
 * faire matcher la facture à la place de l'historique.
 */
function mockMeteringApi(inv: MeteringInvoice) {
  mockFetchRouter((pathname) => {
    if (pathname === '/api/v1/me') return ME;
    if (pathname === '/api/v1/referential/companies') return COMPANIES;
    const historyMatch = pathname.match(/\/history\/([^/]+)$/);
    if (historyMatch) return HISTORY_BY_METRIC[historyMatch[1]] ?? historyFor(historyMatch[1], []);
    if (pathname.startsWith('/api/v1/metering/')) return inv;
    if (pathname === '/api/v1/pricing/grid') return GRID;
    return undefined;
  });
}

/**
 * Écran Métrologie & facturation (/metering, écran 10, B.8) — facture
 * calculée (quota/dépassement/montant), grille tarifaire éditable selon le
 * privilège `grid`, et graphe "Consommation mensuelle" (historique 10 mois
 * d'une métrique sélectionnable — rapprochement de la capture de référence,
 * 2026-10-18). Le panneau "Showback — coût d'infrastructure attribué" de la
 * capture reste délibérément absent (voir HANDOFF.md back,
 * `ARCHITECTURE.md` : aucune donnée de coût d'infrastructure réelle).
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

  it('affiche le sélecteur de métrique de l\'historique, par défaut sur « Dossiers ingérés »', async () => {
    mockMeteringApi(invoice());
    renderWithProviders(<MeteringPage />);

    const select = (await screen.findByLabelText('Métrique')) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('claimsIngested'));
  });

  it('change de métrique déclenche un nouvel appel à /history et affiche la nouvelle ligne de quota', async () => {
    mockMeteringApi(invoice());
    renderWithProviders(<MeteringPage />);

    const select = (await screen.findByLabelText('Métrique')) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('claimsIngested'));
    // quota inclus de `claimsIngested` dans GRID (600) — ligne de référence affichée à côté du graphe.
    await waitFor(() => expect(screen.getByText(/quota inclus/).textContent).toMatch(/600/));

    fireEvent.change(select, { target: { value: 'apiCalls' } });

    await waitFor(() => expect(select.value).toBe('apiCalls'));
    // quota inclus de `apiCalls` dans GRID (150 000) — la ligne de référence doit se mettre à jour.
    await waitFor(() => expect(screen.getByText(/quota inclus/).textContent).toMatch(/150.?000/));

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const historyCalls = fetchMock.mock.calls.map((c) => String(c[0])).filter((url) => url.includes('/history/'));
    expect(historyCalls.some((url) => url.includes('/history/claimsIngested'))).toBe(true);
    expect(historyCalls.some((url) => url.includes('/history/apiCalls'))).toBe(true);
  });

  it("n'affiche pas de section Showback (hors périmètre, voir HANDOFF.md)", async () => {
    mockMeteringApi(invoice());
    renderWithProviders(<MeteringPage />);

    await waitFor(() => expect(screen.getAllByText('Dossiers').length).toBeGreaterThan(0));
    expect(screen.queryByText(/Showback/i)).not.toBeInTheDocument();
  });
});
