import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mockFetchRouter, renderWithProviders } from '@/test/render';
import { MeResponse, PlaceUser, RolesMatrixResponse } from '@/lib/types';
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

function placeUser(overrides: Partial<PlaceUser> = {}): PlaceUser {
  return { id: 'u-1', name: 'Nadia', email: 'nadia@caat.dz', role: 'CORRESPONDANT_IDA', companyId: 'CAAT', active: true, grant: [], revoke: [], ...overrides };
}

function mockParamsApi(me: MeResponse, users: PlaceUser[], onUpdate?: (id: string, body: unknown) => PlaceUser) {
  mockFetchRouter((pathname) => {
    if (pathname === '/api/v1/me') return me;
    if (pathname === '/api/v1/admin/users') return { page: 1, total: users.length, items: users };
    if (pathname === '/api/v1/admin/roles/matrix') return MATRIX;
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
});
