import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mockFetchRouter, renderWithProviders } from '@/test/render';
import { MeResponse, PlaceMeteringSummary, PlaceUser, PriceGrid, RolesMatrixResponse } from '@/lib/types';
import ParamsPage from './page';

const ME_ADMIN: MeResponse = {
  user: { id: 'dev-admin-uar', name: 'Admin UAR (dev)', email: 'admin@uar.dz' },
  role: 'ADMIN_UAR',
  privileges: ['admin', 'grid'],
};

const ME_WITHOUT_ADMIN: MeResponse = {
  user: { id: 'dev-op', name: 'Opérateur Place (dev)', email: 'operateur@finlab.dz' },
  role: 'CORRESPONDANT_IDA',
  privileges: ['exchange'],
};

const MATRIX: RolesMatrixResponse = {
  roles: ['OPERATEUR_PLACE', 'CORRESPONDANT_IDA'],
  matrix: {
    OPERATEUR_PLACE: { admin: true, bill: true },
    CORRESPONDANT_IDA: { admin: false, bill: false },
  },
};

const GRID: PriceGrid = {
  version: 'TARIF-2026.01',
  effectiveFrom: '2026-01-01',
  subscription: { label: 'Abonnement mensuel', monthly: 180_000 },
  metrics: [{ metric: 'claimsIngested', label: 'Dossiers ingérés', unit: 'dossier', includedQuota: 600, unitPrice: 120 }],
};

function placeSummary(overrides: Partial<PlaceMeteringSummary> = {}): PlaceMeteringSummary {
  return {
    period: '2026-09',
    gridVersion: 'TARIF-2026.01',
    adherentCount: 5,
    subscriptionTotal: 900_000,
    consumptionTotal: 117_250,
    revenueTotal: 1_017_250,
    inducerCount: 2,
    lines: [
      { metric: 'activeUsers', label: 'Utilisateurs actifs', unit: 'utilisateur', measured: 159, facturable: 34, amountHT: 51_000, revenueSharePct: 43.5 },
      { metric: 'ocrPages', label: 'Traitements OCR / IA', unit: 'page', measured: 21_220, facturable: 2_311, amountHT: 20_799, revenueSharePct: 17.7 },
    ],
    ...overrides,
  };
}

function placeUser(overrides: Partial<PlaceUser> = {}): PlaceUser {
  return { id: 'u-1', name: 'Nadia', email: 'nadia@caat.dz', role: 'CORRESPONDANT_IDA', companyId: 'CAAT', active: true, grant: [], revoke: [], ...overrides };
}

function mockParamsApi(
  me: MeResponse,
  users: PlaceUser[],
  onUpdate?: (id: string, body: unknown) => PlaceUser,
  options?: { summary?: PlaceMeteringSummary; grid?: PriceGrid },
) {
  mockFetchRouter((pathname) => {
    if (pathname === '/api/v1/me') return me;
    if (pathname === '/api/v1/admin/users') return { page: 1, total: users.length, items: users };
    if (pathname === '/api/v1/admin/roles/matrix') return MATRIX;
    if (pathname.startsWith('/api/v1/metering/place-summary/')) return options?.summary ?? placeSummary();
    if (pathname === '/api/v1/pricing/grid') return options?.grid ?? GRID;
    const match = /^\/api\/v1\/admin\/users\/(.+)$/.exec(pathname);
    if (match && onUpdate) return onUpdate(match[1], undefined);
    return undefined;
  });
}

/**
 * Écran Paramétrage (/params, écran 14, Admin §5.1) — réservé au privilège
 * `admin` ; onglet Utilisateurs & accès (édition actif/suspendu +
 * dérogations grant/revoke, B.3/B.7).
 */
describe('Écran Paramétrage (/params)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("affiche un message d'accès réservé pour un rôle sans le privilège admin", async () => {
    mockParamsApi(ME_WITHOUT_ADMIN, []);
    renderWithProviders(<ParamsPage />);

    await waitFor(() => expect(screen.getByText('Accès réservé')).toBeInTheDocument());
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('SEC-38 : n’affiche ni l’accès réservé ni les onglets tant que /me n’est pas connu', async () => {
    let releaseMe: (v: unknown) => void = () => {};
    const meResponse = new Promise((resolve) => (releaseMe = resolve));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const { pathname } = new URL(String(input));
        if (pathname === '/api/v1/me') {
          await meResponse;
          return new Response(JSON.stringify(ME_WITHOUT_ADMIN), { status: 200 });
        }
        return new Response(JSON.stringify({ page: 1, total: 0, items: [] }), { status: 200 });
      }),
    );
    renderWithProviders(<ParamsPage />);

    expect(await screen.findByText('Chargement…')).toBeInTheDocument();
    expect(screen.queryByText('Accès réservé')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    releaseMe(undefined);
    expect(await screen.findByText('Accès réservé')).toBeInTheDocument();
  });

  it('SEC-38 : un rôle compagnie disposant du privilège admin ne peut créer d’utilisateur que pour sa compagnie', async () => {
    const correspondantAdmin: MeResponse = { ...ME_ADMIN, role: 'CORRESPONDANT_IDA', company: 'CAAT' };
    mockParamsApi(correspondantAdmin, [placeUser()]);
    renderWithProviders(<ParamsPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Créer un utilisateur' }));
    const companyInput = screen.getByLabelText('Compagnie (si applicable)') as HTMLInputElement;
    expect(companyInput.value).toBe('CAAT');
    expect(companyInput).toBeDisabled();
  });

  it('liste les utilisateurs pour un ADMIN_UAR (privilège admin)', async () => {
    mockParamsApi(ME_ADMIN, [placeUser()]);
    renderWithProviders(<ParamsPage />);

    await waitFor(() => expect(screen.getByText('Nadia')).toBeInTheDocument());
    expect(screen.getByText('Actif')).toBeInTheDocument();
  });

  it('ouvre le détail d\'un utilisateur et affiche son statut actif/suspendu avec la case à cocher correspondante', async () => {
    mockParamsApi(ME_ADMIN, [placeUser({ active: false })]);
    renderWithProviders(<ParamsPage />);

    await waitFor(() => expect(screen.getByText('Nadia')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Nadia').closest('tr')!);

    await waitFor(() => expect(screen.getByText('Détail utilisateur — Nadia')).toBeInTheDocument());
    const statusCheckbox = screen.getByRole('checkbox', { name: /Suspendu/i });
    expect(statusCheckbox).not.toBeChecked();
  });

  it('enregistre une dérogation grant cochée dans le détail utilisateur (PUT /admin/users/:id)', async () => {
    const user = placeUser();
    mockParamsApi(ME_ADMIN, [user], (id, _body) => ({ ...user, id, grant: ['bill'] }));
    renderWithProviders(<ParamsPage />);

    await waitFor(() => expect(screen.getByText('Nadia')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Nadia').closest('tr')!);

    await waitFor(() => expect(screen.getByText('Dérogations accordées')).toBeInTheDocument());
    // Deux cases "bill" existent (section "accordées" puis "retirées", même privilège affiché deux fois) — la première est celle du grant.
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'bill' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => expect(screen.getByText('Utilisateur mis à jour.')).toBeInTheDocument());
  });

  it('affiche les 4 KPI (utilisateurs/actifs/suspendus/rôles) avec les bons comptes', async () => {
    const users = [
      placeUser({ id: 'u-1', name: 'Nadia', active: true }),
      placeUser({ id: 'u-2', name: 'Farid', active: true }),
      placeUser({ id: 'u-3', name: 'Ouarda', active: true }),
      placeUser({ id: 'u-4', name: 'Karim', active: false }),
    ];
    mockParamsApi(ME_ADMIN, users);
    renderWithProviders(<ParamsPage />);

    await waitFor(() => expect(screen.getByText('Nadia')).toBeInTheDocument());
    // 4 utilisateurs (2 rôles dans MATRIX), dont 3 actifs et 1 suspendu — valeurs toutes distinctes pour éviter toute ambiguïté.
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('utilisateurs')).toBeInTheDocument();
    expect(screen.getByText('actifs')).toBeInTheDocument();
    expect(screen.getByText('suspendus')).toBeInTheDocument();
    expect(screen.getByText('rôles')).toBeInTheDocument();
  });

  it('permet de suspendre/activer un utilisateur directement depuis la ligne du tableau', async () => {
    const user = placeUser({ active: true });
    mockParamsApi(ME_ADMIN, [user], (id, _body) => ({ ...user, id, active: false }));
    renderWithProviders(<ParamsPage />);

    await waitFor(() => expect(screen.getByText('Nadia')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Suspendre' }));

    await waitFor(() => expect(screen.getByText('Statut mis à jour.')).toBeInTheDocument());
    // Le clic sur le bouton d'action ne doit pas ouvrir la modale de détail (stopPropagation).
    expect(screen.queryByText('Détail utilisateur — Nadia')).not.toBeInTheDocument();
  });

  it("affiche la matrice rôles × privilèges transposée (rôles en colonnes, privilèges en lignes avec leur clé technique) et permet de cocher/enregistrer", async () => {
    mockParamsApi(ME_ADMIN, []);
    renderWithProviders(<ParamsPage />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Rôles & privilèges' }));

    await waitFor(() => expect(screen.getByRole('columnheader', { name: 'Opérateur de place' })).toBeInTheDocument());
    expect(screen.getByRole('columnheader', { name: 'Correspondant IDA' })).toBeInTheDocument();
    expect(screen.getByText('Administration & paramétrage de la place')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText(/Cochez une cellule pour accorder le privilège au rôle/)).toBeInTheDocument();

    const checkbox = screen.getByRole('checkbox', { name: 'CORRESPONDANT_IDA × admin' });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer la matrice' }));
    await waitFor(() => expect(screen.getByText('Matrice des privilèges mise à jour.')).toBeInTheDocument());
  });

  it('affiche les 4 KPI place entière et le tableau des inducteurs de coût (Coûts & tarification)', async () => {
    mockParamsApi(ME_ADMIN, []);
    renderWithProviders(<ParamsPage />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Coûts & tarification' }));

    await waitFor(() => expect(screen.getByText('Utilisateurs actifs')).toBeInTheDocument());
    expect(screen.getByText('revenu mensuel HT')).toBeInTheDocument();
    expect(screen.getByText('abonnements')).toBeInTheDocument();
    expect(screen.getByText('5 adhérents')).toBeInTheDocument();
    expect(screen.getByText('consommation hors forfait')).toBeInTheDocument();
    expect(screen.getByText('inducteurs de coût')).toBeInTheDocument();
    expect(screen.getByText('Traitements OCR / IA')).toBeInTheDocument();
    expect(screen.getByText(/43\.5\s?%/)).toBeInTheDocument();
    expect(screen.getByText('Consommation hors forfait')).toBeInTheDocument();
    // Grille tarifaire paramétrable toujours présente, inchangée (plus de sélecteur de compagnie).
    expect(screen.getByText('Dossiers ingérés')).toBeInTheDocument();
    expect(screen.queryByLabelText('Compagnie')).not.toBeInTheDocument();
  });
});
