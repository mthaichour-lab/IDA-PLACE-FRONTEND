import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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
  items: [
    {
      id: 'co-1',
      code: 'CAAT',
      name: 'CAAT',
      color: '#111',
      kind: 'INSURER',
      feedMode: 'API',
      status: 'ACTIF',
      apiKeyMasked: '****',
      createdAt: '2025-12-15T00:00:00.000Z',
      agencyCounts: { DG: 1, DR: 3, AG: 8 },
    },
  ],
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
function mockMeteringApi(inv: MeteringInvoice, me: MeResponse = ME, companies: Paginated<CompanyView> = COMPANIES) {
  mockFetchRouter((pathname) => {
    if (pathname === '/api/v1/me') return me;
    if (pathname === '/api/v1/referential/companies') return companies;
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
 * 2026-10-18). L'emplacement « Showback — coût d'infrastructure attribué » de la
 * capture (r19) présente uniquement les montants réellement facturés,
 * regroupés par ressource : l'API n'expose aucun coût d'infrastructure
 * (voir HANDOFF.md back, `ARCHITECTURE.md`).
 */
describe('Écran Métrologie & facturation (/metering)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('affiche la facture de la période (quota, dépassement, montant TTC)', async () => {
    mockMeteringApi(invoice());
    renderWithProviders(<MeteringPage />);

    await waitFor(() => expect(screen.getAllByText('Dossiers').length).toBeGreaterThan(0));
    // La facture n'est demandée qu'une fois la compagnie connue (/me puis référentiel, SEC-38).
    expect(await screen.findByText(/60\s?690/)).toBeInTheDocument();
  });

  it('affiche la grille tarifaire courante', async () => {
    mockMeteringApi(invoice());
    renderWithProviders(<MeteringPage />);

    await waitFor(() => expect(screen.getAllByText('Dossiers').length).toBeGreaterThan(0));
    // Version de la grille affichée dans la carte « Grille tarifaire paramétrable » (et rappelée sur la facture).
    const gridCard = (await screen.findByText('Grille tarifaire paramétrable')).closest('.sheet') as HTMLElement;
    expect(within(gridCard).getByText('v1')).toBeInTheDocument();
    expect(within(gridCard).getByLabelText('Appels API — Quota inclus')).toHaveValue(150_000);
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

  it("ventilation infrastructure : montants réellement facturés regroupés par ressource, pas de coût d'infrastructure inventé", async () => {
    const infraLine = (metric: string, label: string, amount: number) => ({ metric, label, unit: 'Go', includedQuota: 10, unitPrice: 1, measured: 10 + amount, facturable: amount, amount });
    mockMeteringApi(
      invoice({
        lines: [
          infraLine('cpuHours', 'Temps CPU', 420),
          infraLine('storageGB', 'Stockage documentaire', 1020),
          infraLine('backupsGB', 'Sauvegardes', 160),
          infraLine('sms', 'Notifications SMS', 2700),
          infraLine('emails', 'Notifications e-mail', 600),
        ],
      }),
    );
    renderWithProviders(<MeteringPage />);

    const card = (await screen.findByText('Ventilation infrastructure — montants facturés')).closest('.sheet') as HTMLElement;
    const rowOf = (label: string) => within(card).getByText(label).closest('tr') as HTMLElement;
    expect(rowOf('CPU').textContent).toMatch(/420\s?DA/);
    // Stockage + sauvegardes = 1 020 + 160 ; Messagerie = SMS + e-mails.
    expect(rowOf('Stockage + sauvegardes').textContent).toMatch(/1\s?180\s?DA/);
    expect(rowOf('Messagerie').textContent).toMatch(/3\s?300\s?DA/);
    // Ressources absentes de la facture : pas de ligne (aucune donnée inventée).
    expect(within(card).queryByText('Mémoire')).not.toBeInTheDocument();
    expect(rowOf('Total refacturé (chargeback)').textContent).toMatch(/4\s?900\s?DA/);
    expect(within(card).getByText(/pas encore collecté par l'API/)).toBeInTheDocument();
    // Pas de « showback / coût d'infrastructure attribué » : l'API n'expose aucun coût d'infrastructure (voir HANDOFF.md).
    expect(screen.queryByText(/Showback/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/coût d'infrastructure attribué/i)).not.toBeInTheDocument();
  });

  it('facture sans ligne d’infrastructure : la ventilation le dit, sans montant', async () => {
    mockMeteringApi(invoice());
    renderWithProviders(<MeteringPage />);

    expect(await screen.findByText("Aucune ligne d'infrastructure sur cette facture.")).toBeInTheDocument();
  });

  it('tuiles : dépassement en pourcentage du quota inclus, 6 tuiles au plus', async () => {
    const lines = Array.from({ length: 8 }, (_, i) => ({
      metric: `m${i}`,
      label: `Inducteur ${i}`,
      unit: 'u',
      includedQuota: 100,
      unitPrice: 1,
      measured: i === 0 ? 164 : 90,
      facturable: i === 0 ? 64 : 0,
      amount: i === 0 ? 64 : 0,
    }));
    mockMeteringApi(invoice({ lines }));
    renderWithProviders(<MeteringPage />);

    const tiles = await screen.findByRole('region', { name: 'Consommation par inducteur' });
    expect(within(tiles).getAllByText(/^quota /)).toHaveLength(6);
    expect(within(tiles).getByText(/\+64\s?%/)).toBeInTheDocument();
    expect(within(tiles).queryByText('Inducteur 6')).not.toBeInTheDocument();
  });

  it('facture : ligne d’abonnement + une ligne par inducteur, paginées 6 par page', async () => {
    const lines = Array.from({ length: 7 }, (_, i) => ({
      metric: `m${i}`,
      label: `Inducteur ${i}`,
      unit: '1 000 appels',
      includedQuota: 1000,
      unitPrice: 45,
      measured: 3000,
      facturable: 2000,
      amount: 90,
    }));
    mockMeteringApi(invoice({ lines }));
    renderWithProviders(<MeteringPage />);

    const card = (await screen.findByText(/^Facture — /)).closest('.sheet') as HTMLElement;
    expect(within(card).getByText('Standard')).toBeInTheDocument();
    expect(within(card).getByText(/1–6 sur 8/)).toBeInTheDocument();
    // Unité de prix « 1 000 appels » : facturable ramené à l'unité (2 000 ÷ 1 000 = 2).
    expect(within(card).getAllByText(/÷\s?1\s?000\s?=\s?2$/).length).toBeGreaterThan(0);
    expect(within(card).queryByText('Inducteur 5')).not.toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'Suivant' }));
    expect(await within(card).findByText('Inducteur 5')).toBeInTheDocument();
    expect(within(card).getByText(/7–8 sur 8/)).toBeInTheDocument();
  });

  describe('SEC-38 : compagnie issue de l’identité réelle, plus de CAAT par défaut', () => {
    const SAA: CompanyView = { ...COMPANIES.items[0], id: 'co-2', code: 'SAA', name: 'SAA' };
    const TWO: Paginated<CompanyView> = { page: 1, total: 2, items: [SAA, COMPANIES.items[0]] };
    const invoiceUrls = () =>
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => new URL(String(c[0])).pathname)
        .filter((p) => p.startsWith('/api/v1/metering/') && !p.includes('/history/'));

    it('rôle place : part de la première compagnie du référentiel, pas de CAAT codé en dur', async () => {
      mockMeteringApi(invoice({ company: 'SAA' }), ME, TWO);
      renderWithProviders(<MeteringPage />);

      const select = (await screen.findByLabelText('Compagnie')) as HTMLSelectElement;
      await waitFor(() => expect(select.value).toBe('SAA'));
      expect(select).not.toBeDisabled();
      await waitFor(() => expect(invoiceUrls().length).toBeGreaterThan(0));
      expect(invoiceUrls().every((p) => p.startsWith('/api/v1/metering/SAA/'))).toBe(true);
    });

    it('rôle compagnie : seule sa compagnie est proposée, sélecteur verrouillé', async () => {
      const tresorier: MeResponse = { user: { id: 't', name: 'Trésorier CAAT', email: 't@caat.dz' }, role: 'TRESORIER', privileges: [], company: 'CAAT' };
      mockMeteringApi(invoice(), tresorier, TWO);
      renderWithProviders(<MeteringPage />);

      const select = (await screen.findByLabelText('Compagnie')) as HTMLSelectElement;
      await waitFor(() => expect(select.value).toBe('CAAT'));
      expect(select).toBeDisabled();
      expect(Array.from(select.options).map((o) => o.value)).toEqual(['CAAT']);
      await waitFor(() => expect(invoiceUrls().length).toBeGreaterThan(0));
      expect(invoiceUrls().every((p) => p.startsWith('/api/v1/metering/CAAT/'))).toBe(true);
    });

    it('rôle compagnie sans compagnie dans le jeton : message explicite, aucun appel de facture', async () => {
      const orphan: MeResponse = { user: { id: 'c', name: 'Correspondant', email: 'c@x.dz' }, role: 'CORRESPONDANT_IDA', privileges: [] };
      mockMeteringApi(invoice(), orphan, TWO);
      renderWithProviders(<MeteringPage />);

      expect(await screen.findByText(/Aucune compagnie n’est associée à votre compte/)).toBeInTheDocument();
      expect(invoiceUrls()).toEqual([]);
    });
  });
});
