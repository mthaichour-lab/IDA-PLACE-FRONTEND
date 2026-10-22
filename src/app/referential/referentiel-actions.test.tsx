import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgencyView, CompanyListItem, ExpertView, MeResponse } from '@/lib/types';
import { FetchRequest, mockFetchRequests, renderWithProviders } from '@/test/render';
import ReferentialPage from './page';

/**
 * Écran 12 — actions d'écriture du référentiel jusque-là sans bouton :
 * agences (POST/PUT /referential/agencies), experts (POST/PUT
 * /referential/experts, suspension comprise) et périmètre d'une wilaya
 * (PUT /referential/wilayas/:code). Boutons visibles selon le privilège de la
 * route (`refedit` / `params`) ; corps envoyés conformes aux DTO du backend.
 */

const ME_OPERATOR: MeResponse = { user: { id: 'u-op', name: 'Opérateur', email: 'op@uar.dz' }, role: 'OPERATEUR_PLACE', privileges: ['refedit', 'params'] };
const ME_READER: MeResponse = { user: { id: 'u-audit', name: 'Auditeur', email: 'a@csa.dz' }, role: 'AUDITEUR_CSA', privileges: [] };
const ME_CORRESPONDANT: MeResponse = {
  user: { id: 'u-corr', name: 'Correspondant', email: 'c@caat.dz' },
  role: 'CORRESPONDANT_IDA',
  privileges: ['refedit', 'import'],
  company: 'CAAT',
};

const CAAT_ID = '00000000-0000-4000-8000-0000000000a1';
const SAA_ID = '00000000-0000-4000-8000-0000000000a2';

const COMPANIES: CompanyListItem[] = [
  { id: CAAT_ID, code: 'CAAT', name: 'CAAT Assurance', color: '#1F4FA3', kind: 'INSURER', status: 'ACTIF', agencyCounts: { DG: 1, DR: 0, AG: 1 } } as CompanyListItem,
  { id: SAA_ID, code: 'SAA', name: 'SAA', color: '#654321', kind: 'INSURER', status: 'ACTIF', agencyCounts: { DG: 0, DR: 0, AG: 1 } } as CompanyListItem,
];

const AGENCIES: AgencyView[] = [
  { id: '00000000-0000-4000-8000-0000000000b1', companyId: CAAT_ID, code: 'CAAT-DG', name: 'Direction générale CAAT', type: 'DG', wilayaCode: '16', status: 'ACTIF' },
  { id: '00000000-0000-4000-8000-0000000000b2', companyId: SAA_ID, code: 'SAA-ORAN', name: 'Agence Oran', type: 'AG', status: 'ACTIF' },
];

const EXPERTS: ExpertView[] = [
  { id: '00000000-0000-4000-8000-0000000000c1', name: 'Karim Belkacem', firm: 'Cabinet Belkacem', wilayas: ['16', '09'], specialties: ['Carrosserie'], companies: ['CAAT', 'SAA'], status: 'ACTIF' },
  { id: '00000000-0000-4000-8000-0000000000c2', name: 'Yasmine Ould Ali', wilayas: ['25'], specialties: [], companies: ['SAA'], status: 'SUSPENDU' },
];

const WILAYAS = [
  { code: '09', name: 'Blida' },
  { code: '16', name: 'Alger' },
  { code: '58', name: 'El Meniaa', effectiveFrom: '2019-12-18', parentCode: '47' },
  { code: '47', name: 'Ghardaïa' },
];

function mockApi(me: MeResponse, opts: { agencies?: AgencyView[]; experts?: ExpertView[] } = {}) {
  const writes: FetchRequest[] = [];
  mockFetchRequests((req) => {
    if (req.method !== 'GET') {
      writes.push(req);
      return { body: { ...(req.body as object), id: 'new' } };
    }
    switch (req.pathname) {
      case '/api/v1/me':
        return { body: me };
      case '/api/v1/referential/companies':
        return { body: { page: 1, total: COMPANIES.length, items: COMPANIES } };
      case '/api/v1/referential/agencies': {
        const companyId = req.url.searchParams.get('companyId');
        const all = opts.agencies ?? AGENCIES;
        const items = companyId ? all.filter((a) => a.companyId === companyId) : all;
        return { body: { page: 1, total: items.length, items } };
      }
      case '/api/v1/referential/experts': {
        const items = opts.experts ?? EXPERTS;
        return { body: { page: 1, total: items.length, items } };
      }
      case '/api/v1/referential/wilayas':
        return { body: WILAYAS };
      case '/api/v1/referential/wilaya-populations':
        return { body: [] };
      case '/api/v1/referential/convention':
        return { body: { version: 'v1', silenceDays: 10, oppositionDays: 15, forclusionMonths: 6, maxAmountDA: 500_000 } };
      case '/api/v1/referential/motifs':
        return { body: [] };
      default:
        return undefined;
    }
  });
  return writes;
}

async function openSection(title: string) {
  const user = userEvent.setup();
  const nav = await screen.findByRole('navigation', { name: /référentiel de place/i });
  await user.click(within(nav).getByText(title));
  return user;
}

describe('Référentiel › Agences — création et modification (refedit)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sans le privilège refedit : ni « Nouvelle agence » ni « Modifier »', async () => {
    mockApi(ME_READER);
    renderWithProviders(<ReferentialPage />);
    await openSection('Agences');
    await screen.findByText('Direction générale CAAT');
    expect(screen.queryByRole('button', { name: /nouvelle agence/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /modifier l'agence/i })).not.toBeInTheDocument();
  });

  it('rôle place : crée une agence positionnée dans l’organisation (POST /referential/agencies)', async () => {
    const writes = mockApi(ME_OPERATOR);
    renderWithProviders(<ReferentialPage />);
    const user = await openSection('Agences');
    await user.click(await screen.findByRole('button', { name: /nouvelle agence/i }));
    const dialog = await screen.findByRole('dialog');

    await user.selectOptions(within(dialog).getByLabelText('Compagnie'), within(dialog).getByRole('option', { name: /^CAAT — / }));
    await user.type(within(dialog).getByLabelText(/code agence/i), 'CAAT-BLIDA');
    await user.type(within(dialog).getByLabelText('Nom'), 'Agence Blida');
    // La compagnie a déjà sa Direction générale : le niveau DG n'est plus proposé.
    await waitFor(() => expect(within(dialog).getByRole('radio', { name: /DG — Direction générale/ })).toBeDisabled());
    await user.click(within(dialog).getByRole('radio', { name: /AG — Agence/ }));
    // Organisation : une agence relève d'une DR ou de la DG de la MÊME compagnie (jamais d'une autre agence, ni d'une autre compagnie).
    const dgOption = await within(dialog).findByRole('option', { name: 'DG · CAAT-DG — Direction générale CAAT' });
    expect(within(dialog).queryByRole('option', { name: /SAA-ORAN/ })).not.toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText('Rattachement'), dgOption);
    expect(within(dialog).getByText(/CAAT-BLIDA/, { selector: '.org-path-new' })).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole('option', { name: '09 — Blida' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByLabelText('Wilaya'), '09');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].method).toBe('POST');
    expect(writes[0].pathname).toBe('/api/v1/referential/agencies');
    expect(writes[0].body).toEqual({ companyId: CAAT_ID, code: 'CAAT-BLIDA', name: 'Agence Blida', type: 'AG', wilayaCode: '09', parentId: AGENCIES[0].id });
    expect(await screen.findByText('Agence créée.')).toBeInTheDocument();
  });

  it('rôle place : modifie une agence (PUT /referential/agencies/:id, champs modifiés seulement)', async () => {
    const writes = mockApi(ME_OPERATOR);
    renderWithProviders(<ReferentialPage />);
    const user = await openSection('Agences');
    await user.click(await screen.findByRole('button', { name: "Modifier l'agence CAAT-DG" }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/code agence/i)).toBeDisabled();
    expect(within(dialog).getByLabelText('Compagnie')).toBeDisabled();

    const name = within(dialog).getByLabelText('Nom');
    await user.clear(name);
    await user.type(name, 'DG CAAT — Alger');
    await user.type(within(dialog).getByLabelText('Responsable'), 'M. Amrani');
    await user.selectOptions(within(dialog).getByLabelText('Statut'), 'SUSPENDU');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].method).toBe('PUT');
    expect(writes[0].pathname).toBe(`/api/v1/referential/agencies/${AGENCIES[0].id}`);
    expect(writes[0].body).toEqual({ name: 'DG CAAT — Alger', manager: 'M. Amrani', status: 'SUSPENDU' });
    expect(await screen.findByText('Agence mise à jour.')).toBeInTheDocument();
  });

  it('correspondant : compagnie imposée (la sienne) et « Modifier » sur ses seules agences (B.7)', async () => {
    const writes = mockApi(ME_CORRESPONDANT);
    renderWithProviders(<ReferentialPage />);
    const user = await openSection('Agences');
    await screen.findByText('Direction générale CAAT');
    expect(screen.getByRole('button', { name: "Modifier l'agence CAAT-DG" })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: "Modifier l'agence SAA-ORAN" })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /nouvelle agence/i }));
    const dialog = await screen.findByRole('dialog');
    const company = within(dialog).getByLabelText('Compagnie');
    expect(company).toBeDisabled();
    expect(company).toHaveValue(CAAT_ID);
    await user.type(within(dialog).getByLabelText(/code agence/i), 'CAAT-ORAN');
    await user.type(within(dialog).getByLabelText('Nom'), 'Agence Oran CAAT');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toEqual({ companyId: CAAT_ID, code: 'CAAT-ORAN', name: 'Agence Oran CAAT', type: 'AG' });
  });
});

describe('Référentiel › Experts agréés — création, modification, suspension (refedit)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sans le privilège refedit : ni « Nouvel expert », ni « Modifier », ni « Suspendre »', async () => {
    mockApi(ME_READER);
    renderWithProviders(<ReferentialPage />);
    await openSection('Experts agréés');
    await screen.findByText('Karim Belkacem');
    expect(screen.queryByRole('button', { name: /nouvel expert/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /modifier l'expert/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /suspendre/i })).not.toBeInTheDocument();
  });

  it('rôle place : crée un expert (POST /referential/experts, corps du CreateExpertDto)', async () => {
    const writes = mockApi(ME_OPERATOR);
    renderWithProviders(<ReferentialPage />);
    const user = await openSection('Experts agréés');
    await user.click(await screen.findByRole('button', { name: /nouvel expert/i }));
    const dialog = await screen.findByRole('dialog');

    await user.type(within(dialog).getByLabelText('Nom'), 'Nadia Hamdi');
    await user.type(within(dialog).getByLabelText('Cabinet'), 'Expertises Hamdi');
    await user.type(within(dialog).getByLabelText("N° d'agrément"), 'AGR-2024-0007');
    await user.type(within(dialog).getByLabelText(/wilayas couvertes/i), '16, 09');
    await user.type(within(dialog).getByLabelText(/spécialités/i), 'Carrosserie, Mécanique');
    await user.click(within(dialog).getByLabelText('CAAT'));
    await user.type(within(dialog).getByLabelText(/^RIB/), '00799999000123456789');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].method).toBe('POST');
    expect(writes[0].pathname).toBe('/api/v1/referential/experts');
    expect(writes[0].body).toEqual({
      name: 'Nadia Hamdi',
      firm: 'Expertises Hamdi',
      agrement: 'AGR-2024-0007',
      wilayas: ['16', '09'],
      specialties: ['Carrosserie', 'Mécanique'],
      companies: ['CAAT'],
      rib: '00799999000123456789',
    });
    expect(await screen.findByText('Expert créé.')).toBeInTheDocument();
  });

  it('rôle place : modifie un expert (PUT, champs modifiés seulement, statut compris)', async () => {
    const writes = mockApi(ME_OPERATOR);
    renderWithProviders(<ReferentialPage />);
    const user = await openSection('Experts agréés');
    await user.click(await screen.findByRole('button', { name: "Modifier l'expert Karim Belkacem" }));
    const dialog = await screen.findByRole('dialog');

    const wilayas = within(dialog).getByLabelText(/wilayas couvertes/i);
    await user.clear(wilayas);
    await user.type(wilayas, '16, 09, 42');
    await user.click(within(dialog).getByLabelText('SAA'));
    await user.selectOptions(within(dialog).getByLabelText('Statut'), 'RADIE');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].method).toBe('PUT');
    expect(writes[0].pathname).toBe(`/api/v1/referential/experts/${EXPERTS[0].id}`);
    expect(writes[0].body).toEqual({ wilayas: ['16', '09', '42'], companies: ['CAAT'], status: 'RADIE' });
  });

  it('rôle place : « Suspendre » / « Réactiver » envoient PUT { status }', async () => {
    const writes = mockApi(ME_OPERATOR);
    renderWithProviders(<ReferentialPage />);
    const user = await openSection('Experts agréés');
    await user.click(await screen.findByRole('button', { name: 'Suspendre Karim Belkacem' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ method: 'PUT', pathname: `/api/v1/referential/experts/${EXPERTS[0].id}`, body: { status: 'SUSPENDU' } });
    expect(await screen.findByText('Expert suspendu.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Réactiver Yasmine Ould Ali' }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]).toMatchObject({ method: 'PUT', pathname: `/api/v1/referential/experts/${EXPERTS[1].id}`, body: { status: 'ACTIF' } });
  });

  it('correspondant : rattachement imposé à sa compagnie, ni statut ni suspension (SEC-14)', async () => {
    const own: ExpertView[] = [{ id: '00000000-0000-4000-8000-0000000000c3', name: 'Expert CAAT', wilayas: ['16'], specialties: [], companies: ['CAAT'], status: 'ACTIF' }];
    const writes = mockApi(ME_CORRESPONDANT, { experts: own });
    renderWithProviders(<ReferentialPage />);
    const user = await openSection('Experts agréés');
    await screen.findByText('Expert CAAT');
    expect(screen.queryByRole('button', { name: /suspendre/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: "Modifier l'expert Expert CAAT" }));
    let dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('Statut')).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Cabinet'), 'Cabinet Ouest');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toEqual({ firm: 'Cabinet Ouest' });

    await user.click(screen.getByRole('button', { name: /nouvel expert/i }));
    dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Nom'), 'Nouvel expert CAAT');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1].body).toEqual({ name: 'Nouvel expert CAAT', companies: ['CAAT'] });
  });
});

describe('Référentiel › Populations — périmètre d’une wilaya (params)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('liste les périmètres renseignés ; sans params, aucune action', async () => {
    mockApi(ME_READER);
    renderWithProviders(<ReferentialPage />);
    await openSection('Populations de référence');
    const section = await screen.findByRole('region', { name: 'Périmètre des wilayas' });
    await waitFor(() => expect(within(section).getByText('58 — El Meniaa')).toBeInTheDocument());
    expect(within(section).getByText('2019-12-18')).toBeInTheDocument();
    expect(within(section).getByText('47 — Ghardaïa')).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: /modifier/i })).not.toBeInTheDocument();
  });

  it('modifie le périmètre (PUT /referential/wilayas/:code) ; un champ vidé part à null', async () => {
    const writes = mockApi(ME_OPERATOR);
    renderWithProviders(<ReferentialPage />);
    const user = await openSection('Populations de référence');
    const section = await screen.findByRole('region', { name: 'Périmètre des wilayas' });
    await user.click(await within(section).findByRole('button', { name: 'Modifier le périmètre de la wilaya 58 — El Meniaa' }));
    let dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Wilaya mère'), '');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ method: 'PUT', pathname: '/api/v1/referential/wilayas/58', body: { parentCode: null } });
    expect(await screen.findByText('Périmètre enregistré.')).toBeInTheDocument();

    // Nouveau périmètre d'une wilaya sans périmètre : choix de la wilaya puis date + wilaya mère.
    await user.click(within(section).getByRole('button', { name: 'Modifier un périmètre' }));
    dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Wilaya'), '09');
    fireEvent.change(within(dialog).getByLabelText(/date d'entrée en vigueur/i), { target: { value: '2021-01-01' } });
    await user.selectOptions(within(dialog).getByLabelText('Wilaya mère'), '16');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]).toMatchObject({ method: 'PUT', pathname: '/api/v1/referential/wilayas/09', body: { effectiveFrom: '2021-01-01', parentCode: '16' } });
  });
});
