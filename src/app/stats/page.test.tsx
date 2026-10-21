import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mockFetchJson, renderWithProviders } from '@/test/render';
import { MeResponse, MonthlyActivity, StatsSummary, WilayaStat } from '@/lib/types';
import StatsPage from './page';

const ME: MeResponse = {
  user: { id: 'dev-op', name: 'Opérateur Place (dev)', email: 'operateur@finlab.dz' },
  role: 'OPERATEUR_PLACE',
  privileges: [],
};

const WILAYAS: WilayaStat[] = [
  { code: '16', name: 'Alger', col: 1, row: 1, declarations: 120, montants: 5_000_000, per100k: null, populationRef: null },
  { code: '31', name: 'Oran', col: 2, row: 1, declarations: 80, montants: 3_000_000, per100k: null, populationRef: null },
];

const MONTHLY: MonthlyActivity[] = [
  { month: '2026-09', declarations: 90, econstat: 70, autresCanaux: 20, annexes2: 12, oppositions: 3, indemnises: 8 },
  { month: '2026-10', declarations: 110, econstat: 85, autresCanaux: 25, annexes2: 15, oppositions: 4, indemnises: 10 },
];

const SUMMARY: StatsSummary = { declarations: 200, oppositionRatePct: 16, settledAmount: 8_220_000, avgSettlementDays: 24.5,
  irsam: null,
  irsamStatus: 'NON_RENSEIGNE',
  baremeCodes: { items: [], sansValeur: 0 },
  vehicleCategories: { items: [], sansValeur: 0 },
};

function mockStatsApi(overrides: { wilayas?: WilayaStat[]; monthly?: MonthlyActivity[]; summary?: StatsSummary } = {}) {
  mockFetchJson({
    '/api/v1/me': ME,
    '/api/v1/stats/wilayas': overrides.wilayas ?? WILAYAS,
    '/api/v1/stats/monthly': overrides.monthly ?? MONTHLY,
    '/api/v1/stats/summary': overrides.summary ?? SUMMARY,
  });
}

/**
 * Écran Statistiques de la place (/stats, écran 11, Module H §6.10) — KPI de
 * synthèse, carte des wilayas (référentiel réel) avec bascule déclarations/
 * montants (« Pour 100 000 hab. » : voir `referentiels.test.tsx`), zones à forte sinistralité, activité
 * mensuelle réelle (Annexes 2/oppositions/réglés — RecoursModule), et
 * répartition par canal de déclaration (e-constat vs autres canaux).
 */
describe('Écran Statistiques de la place (/stats)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('affiche les KPI de synthèse (déclarations, taux d’opposition, compensé, délai moyen)', async () => {
    mockStatsApi();
    renderWithProviders(<StatsPage />);

    await waitFor(() => expect(screen.getByText('200')).toBeInTheDocument());
    expect(screen.getByText('16 %')).toBeInTheDocument();
    // Compensé en format compact (maquette « 8,22 M DA »), montant exact en infobulle.
    const settled = screen.getByText(/^8,22\s?M$/).closest('.kpi');
    expect(settled).toHaveTextContent(/8,22\s?M\s?DA/);
    expect(settled?.getAttribute('title')).toMatch(/8\s?220\s?000/);
    // Adoption e-constat = part réelle du canal ECONSTAT (155 / 200).
    expect(screen.getByText('78 %').closest('.kpi')).toHaveTextContent('Adoption e-constat');
    // Unité affichée en petit (`.kpi-unit`) : valeur et unité dans deux nœuds.
    expect(screen.getByText('24,5').closest('.kpi')).toHaveTextContent('24,5 j');
  });

  it('affiche "n/d" pour le délai moyen de règlement si aucun recours n’est encore réglé', async () => {
    mockStatsApi({ summary: { ...SUMMARY, avgSettlementDays: null } });
    renderWithProviders(<StatsPage />);

    await waitFor(() => expect(screen.getByText('n/d')).toBeInTheDocument());
  });

  it('affiche la carte des wilayas (une tuile par code, valeur = mesure "déclarations" par défaut)', async () => {
    mockStatsApi();
    renderWithProviders(<StatsPage />);

    await waitFor(() => expect(screen.getByTitle(/16 — Alger : 120/)).toBeInTheDocument());
    expect(screen.getByTitle(/31 — Oran : 80/)).toBeInTheDocument();
  });

  it('bascule sur la mesure "montants" via les onglets (valeur de la tuile et du classement mis à jour)', async () => {
    mockStatsApi();
    renderWithProviders(<StatsPage />);

    await waitFor(() => expect(screen.getByTitle(/16 — Alger : 120/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: /montants/i }));

    expect(screen.getByRole('tab', { name: /montants/i })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(screen.getByTitle(/16 — Alger : 5000000/)).toBeInTheDocument());
  });

  it('affiche le classement des zones à forte sinistralité, triées par la mesure active', async () => {
    mockStatsApi();
    renderWithProviders(<StatsPage />);

    const zones = await screen.findByRole('region', { name: 'Zones à forte sinistralité' });
    await waitFor(() => expect(within(zones).getByText('Alger')).toBeInTheDocument());
    const items = within(zones).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Alger');
    expect(items[1]).toHaveTextContent('Oran');
  });

  it("affiche un état vide explicite (pas de crash) si l'API renvoie une liste de wilayas vide", async () => {
    mockStatsApi({ wilayas: [] });
    renderWithProviders(<StatsPage />);

    await waitFor(() => expect(screen.getAllByText(/non encore disponible/i).length).toBeGreaterThan(0));
  });

  it('affiche l’activité mensuelle réelle (Annexes 2 émises, oppositions, recours réglés — RecoursModule)', async () => {
    mockStatsApi();
    renderWithProviders(<StatsPage />);

    await waitFor(() => expect(screen.getByText('Annexes 2 émises')).toBeInTheDocument());
    expect(screen.getByText('Oppositions')).toBeInTheDocument();
    expect(screen.getByText('Recours réglés')).toBeInTheDocument();
  });

  it('affiche la répartition par canal de déclaration (e-constat vs autres canaux, en comptes réels)', async () => {
    mockStatsApi();
    renderWithProviders(<StatsPage />);

    // Barres empilées : part e-constat (%) dans la barre, comptes réels en infobulle.
    await waitFor(() => expect(screen.getByTitle(/E-constat \(%\) 70 \/ Autres canaux \(ERP\/import\/API\) 20/)).toHaveTextContent('78'));
    expect(screen.getByTitle(/E-constat \(%\) 85 \/ Autres canaux \(ERP\/import\/API\) 25/)).toHaveTextContent('77');
  });
});
