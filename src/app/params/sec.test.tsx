import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeResponse, PlaceUser } from '@/lib/types';
import { FetchRequest, mockFetchRequests, renderWithProviders } from '@/test/render';
import ParamsPage from './page';

/**
 * SEC-25 / SEC-44 — administration : `companyId` est un code compagnie,
 * obligatoire pour un rôle compagnie et absent pour un rôle place ; un
 * privilège de place refusé à un rôle compagnie (403 PRIVILEGE_RESERVE_PLACE)
 * est expliqué.
 */

const ADMIN: MeResponse = { user: { id: 'u-admin', name: 'Admin', email: 'admin@uar.dz' }, role: 'ADMIN_UAR', privileges: ['admin'] };

const USER: PlaceUser = {
  id: '5c1f7a52-2222-4222-8222-000000000001',
  name: 'Nadia',
  email: 'nadia@caat.dz',
  role: 'CORRESPONDANT_IDA',
  companyId: 'CAAT',
  active: true,
  grant: [],
  revoke: [],
};

const COMPANIES = {
  page: 1,
  total: 2,
  items: [
    { id: '3b6f2c1e-0c1a-4a7e-8c01-00000000ca01', code: 'CAAT', name: 'CAAT Assurance', color: '#1F4FA3', kind: 'INSURER', status: 'ACTIF' },
    { id: '3b6f2c1e-0c1a-4a7e-8c01-00000000ca02', code: 'SAA', name: 'SAA Assurances', color: '#C99A06', kind: 'INSURER', status: 'ACTIF' },
  ],
};

function mockApi(onWrite: (req: FetchRequest) => { status?: number; body: unknown } = (req) => ({ status: 201, body: { ...USER, ...(req.body as object) } })) {
  const writes: FetchRequest[] = [];
  mockFetchRequests((req) => {
    if (req.method !== 'GET') {
      writes.push(req);
      return onWrite(req);
    }
    switch (req.pathname) {
      case '/api/v1/me':
        return { body: ADMIN };
      case '/api/v1/admin/users':
        return { body: { page: 1, total: 1, items: [USER] } };
      case '/api/v1/admin/roles/matrix':
        return { body: { roles: ['OPERATEUR_PLACE', 'ADMIN_UAR', 'CORRESPONDANT_IDA', 'TRESORIER'], matrix: { CORRESPONDANT_IDA: { insert: true, decide: false } } } };
      case '/api/v1/referential/companies':
        return { body: COMPANIES };
      default:
        return undefined;
    }
  });
  return writes;
}

async function openCreate() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Nouvel utilisateur' }));
  const dialog = screen.getByRole('dialog');
  await user.type(within(dialog).getByLabelText(/Nom/), 'Karim');
  await user.type(within(dialog).getByLabelText(/E-mail|Email|Courriel/i), 'karim@saa.dz');
  return { user, dialog };
}

describe('Paramétrage — utilisateurs (SEC-25, SEC-44)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rôle compagnie : code compagnie obligatoire (liste du référentiel), envoyé comme code', async () => {
    const writes = mockApi();
    renderWithProviders(<ParamsPage />);
    const { user, dialog } = await openCreate();

    await user.selectOptions(within(dialog).getByLabelText(/Rôle/), 'CORRESPONDANT_IDA');
    const footerSubmit = within(screen.getByRole('dialog')).getByRole('button', { name: 'Créer' });
    expect(footerSubmit).toBeDisabled();

    await user.selectOptions(await within(dialog).findByLabelText('Compagnie (code, obligatoire pour un rôle compagnie)'), 'SAA');
    expect(footerSubmit).toBeEnabled();
    await user.click(footerSubmit);

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ method: 'POST', pathname: '/api/v1/admin/users', body: { name: 'Karim', email: 'karim@saa.dz', role: 'CORRESPONDANT_IDA', companyId: 'SAA' } });
  });

  it('rôle place : aucune compagnie envoyée', async () => {
    const writes = mockApi();
    renderWithProviders(<ParamsPage />);
    const { user, dialog } = await openCreate();

    await user.selectOptions(within(dialog).getByLabelText(/Rôle/), 'OPERATEUR_PLACE');
    expect(within(dialog).getByText('Rôle de place : aucune compagnie rattachée.')).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Créer' }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).not.toHaveProperty('companyId');
  });

  it('403 PRIVILEGE_RESERVE_PLACE : message traduit', async () => {
    mockApi(() => ({ status: 403, body: { code: 'PRIVILEGE_RESERVE_PLACE', message: 'x' } }));
    renderWithProviders(<ParamsPage />);
    const user = userEvent.setup();

    // Bascule actif/suspendu depuis la ligne : PUT /admin/users/:id (UUID).
    const row = (await screen.findByText('Nadia')).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: /Suspendre|Activer/ }));
    expect(await screen.findByText('Ce privilège est réservé aux rôles de la place : il ne peut pas être accordé à un rôle compagnie.')).toBeInTheDocument();
  });
});
