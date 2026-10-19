import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDelayOverrides } from '@/components/referential/GovernancePanel';
import { BaremeVersion, CompanyListItem, CompanyView, ExpertView, GovernanceChange, MeResponse, VehicleCategory } from '@/lib/types';
import { FetchRequest, mockFetchRequests, renderWithProviders } from '@/test/render';
import ReferentialPage from './page';

/**
 * SEC-04 / SEC-14 / SEC-26 / SEC-30 — écran 12 : profil et gouvernance
 * séparés (403 GOUVERNANCE_RESERVEE, demande + validation quatre yeux),
 * projection publique des concurrentes, RIB masqué, révision renvoyée à la
 * validation.
 */

const CAAT_ID = '3b6f2c1e-0c1a-4a7e-8c01-00000000ca01';
const SAA_ID = '3b6f2c1e-0c1a-4a7e-8c01-00000000ca02';

const CAAT: CompanyView = {
  id: CAAT_ID,
  code: 'CAAT',
  name: 'CAAT Assurance',
  color: '#1F4FA3',
  kind: 'INSURER',
  feedMode: 'API',
  status: 'ACTIF',
  apiKeyMasked: 'sk_live_•••••3f2a',
  createdAt: '2025-12-15T00:00:00.000Z',
  agencyCounts: { DG: 1, DR: 2, AG: 6 },
  correspondentName: 'M. Benali',
};
/** Projection publique (SEC-26) : ni réseau, ni date, ni contacts, ni mode d'alimentation. */
const SAA_PUBLIC: CompanyListItem = { id: SAA_ID, code: 'SAA', name: 'SAA Assurances', color: '#C99A06', kind: 'INSURER', status: 'ACTIF' };

const CORRESPONDANT: MeResponse = { user: { id: 'u-c', name: 'Corr.', email: 'c@caat.dz' }, role: 'CORRESPONDANT_IDA', privileges: ['refedit', 'insert'], company: 'CAAT' };
const OPERATEUR: MeResponse = { user: { id: 'u-op', name: 'Op.', email: 'op@uar.dz' }, role: 'OPERATEUR_PLACE', privileges: ['refedit', 'onboardCompany', 'params'] };
const ADMIN_UAR: MeResponse = { user: { id: 'u-admin', name: 'Admin UAR', email: 'admin@uar.dz' }, role: 'ADMIN_UAR', privileges: ['refedit', 'params', 'validateRef'] };

const PENDING: GovernanceChange = {
  id: '9d0c2a7e-1111-4111-8111-000000000001',
  companyId: CAAT_ID,
  companyCode: 'CAAT',
  patch: { status: 'SUSPENDU' },
  reason: 'Décision de commission n° 12',
  status: 'EN_ATTENTE',
  requestedById: 'u-admin-1',
  requestedBy: 'Admin UAR 1',
  requestedAt: '2026-10-18T08:00:00.000Z',
};

const EXPERT: ExpertView = { id: 'e-1', name: 'Expert Un', wilayas: ['16'], specialties: [], companies: ['CAAT'], status: 'ACTIF', ribMasked: '•••• 4821' };

interface State {
  me: MeResponse;
  companies?: CompanyListItem[];
  governance?: GovernanceChange[];
  versions?: BaremeVersion[];
  categories?: VehicleCategory[];
  writeResponses?: Record<string, { status: number; body: unknown }>;
}

function mockApi(state: State) {
  const writes: FetchRequest[] = [];
  mockFetchRequests((req) => {
    if (req.method !== 'GET') {
      writes.push(req);
      const forced = state.writeResponses?.[`${req.method} ${req.pathname}`];
      if (forced) return forced;
      return { body: { ...PENDING, id: 'new' } };
    }
    switch (req.pathname) {
      case '/api/v1/me':
        return { body: state.me };
      case '/api/v1/referential/companies': {
        const items = state.companies ?? [CAAT, SAA_PUBLIC];
        return { body: { page: 1, total: items.length, items } };
      }
      case '/api/v1/referential/agencies':
        return { body: { page: 1, total: 0, items: [] } };
      case '/api/v1/referential/experts':
        return { body: { page: 1, total: 1, items: [state.me.company ? { ...EXPERT, ribMasked: undefined } : EXPERT] } };
      case '/api/v1/referential/convention':
        return { body: { version: 'v1', silenceDays: 10, oppositionDays: 15, forclusionMonths: 6, maxAmountDA: 500_000 } };
      case '/api/v1/referential/motifs':
        return { body: [] };
      case `/api/v1/referential/companies/${CAAT_ID}/governance-changes`:
        return { body: state.governance ?? [PENDING] };
      case '/api/v1/referential/bareme-versions':
        return { body: state.versions ?? [] };
      case '/api/v1/referential/vehicle-categories':
        return { body: state.categories ?? [] };
      default:
        return undefined;
    }
  });
  return writes;
}

function card(code: string): HTMLElement {
  return screen.getAllByText(code).find((el) => el.closest('.co-card'))!.closest('.co-card') as HTMLElement;
}

describe('Écran 12 — gouvernance, projection publique, révision (SEC-04/14/26/30)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('SEC-26 : rôle compagnie — concurrente en projection publique sans planter ; modification de SA compagnie seulement', async () => {
    mockApi({ me: CORRESPONDANT });
    renderWithProviders(<ReferentialPage />);

    await screen.findByText('SAA Assurances');
    expect(card('SAA')).toHaveTextContent('fiche publique (compagnie concurrente)');
    expect(within(card('SAA')).queryByRole('button', { name: /Modifier/ })).not.toBeInTheDocument();
    expect(within(card('CAAT')).getByRole('button', { name: "Modifier l'adhérent CAAT" })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Gouvernance/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nouvel adhérent' })).not.toBeInTheDocument();
  });

  it('SEC-04 : modification du profil — jamais status, kind, feedMode ni delayOverrides dans le PUT', async () => {
    const writes = mockApi({ me: OPERATEUR });
    renderWithProviders(<ReferentialPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: "Modifier l'adhérent CAAT" }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Statut')).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: /Enregistrer/ }));

    await waitFor(() => expect(writes.find((w) => w.method === 'PUT')).toBeDefined());
    const body = writes.find((w) => w.method === 'PUT')!.body as Record<string, unknown>;
    expect(body).toMatchObject({ name: 'CAAT Assurance', color: '#1F4FA3' });
    for (const key of ['status', 'kind', 'feedMode', 'delayOverrides', 'code']) expect(body).not.toHaveProperty(key);
  });

  it('403 GOUVERNANCE_RESERVEE : message traduit', async () => {
    mockApi({ me: OPERATEUR, writeResponses: { [`PUT /api/v1/referential/companies/${CAAT_ID}`]: { status: 403, body: { code: 'GOUVERNANCE_RESERVEE', message: 'x' } } } });
    renderWithProviders(<ReferentialPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: "Modifier l'adhérent CAAT" }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Enregistrer/ }));
    expect(await screen.findByText(/passent par une demande de changement de gouvernance/)).toBeInTheDocument();
  });

  it('SEC-04 : ADMIN_UAR — demande motivée de changement, puis validation ; 409 FOUR_EYES traduit', async () => {
    const writes = mockApi({
      me: ADMIN_UAR,
      writeResponses: {
        [`POST /api/v1/referential/companies/${CAAT_ID}/governance-changes/${PENDING.id}/validate`]: { status: 409, body: { code: 'FOUR_EYES', message: 'x' } },
      },
    });
    renderWithProviders(<ReferentialPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Gouvernance CAAT' }));
    const dialog = screen.getByRole('dialog');
    await within(dialog).findByText('Décision de commission n° 12', { exact: false });

    const submit = within(dialog).getByRole('button', { name: 'Déposer la demande' });
    expect(submit).toBeDisabled();
    await user.selectOptions(within(dialog).getAllByLabelText('Statut').at(-1)!, 'EN_RETRAIT');
    await user.type(within(dialog).getByLabelText(/Délais dérogatoires \(clé=jours/), 'silenceDays=15');
    expect(submit).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Motif \(décision, courrier/), 'Courrier UAR 2026/77');
    await user.click(submit);
    await waitFor(() => expect(writes.some((w) => w.pathname.endsWith('/governance-changes'))).toBe(true));
    expect(writes.find((w) => w.pathname.endsWith('/governance-changes'))!.body).toEqual({
      status: 'EN_RETRAIT',
      delayOverrides: { silenceDays: 15 },
      reason: 'Courrier UAR 2026/77',
    });

    await user.click(within(dialog).getByRole('button', { name: 'Valider' }));
    expect(await screen.findByText('Règle des quatre yeux : cette action doit être accomplie par un autre membre que l’auteur.')).toBeInTheDocument();
  });

  it('OPERATEUR_PLACE sans validateRef : historique de gouvernance visible, aucune action', async () => {
    mockApi({ me: OPERATEUR });
    renderWithProviders(<ReferentialPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Gouvernance CAAT' }));
    const dialog = screen.getByRole('dialog');
    await within(dialog).findByText('En attente');
    expect(within(dialog).queryByRole('button', { name: 'Déposer la demande' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Valider' })).not.toBeInTheDocument();
  });

  it('SEC-14 : RIB masqué affiché aux rôles place, colonne absente pour un rôle compagnie', async () => {
    mockApi({ me: OPERATEUR });
    const { unmount } = renderWithProviders(<ReferentialPage />);
    const user = userEvent.setup();
    await user.click(within(await screen.findByRole('navigation', { name: /référentiel de place/i })).getByText('Experts agréés'));
    expect(await screen.findByText('•••• 4821')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'RIB (masqué)' })).toBeInTheDocument();
    unmount();

    mockApi({ me: CORRESPONDANT });
    renderWithProviders(<ReferentialPage />);
    await user.click(within(await screen.findByRole('navigation', { name: /référentiel de place/i })).getByText('Experts agréés'));
    await screen.findByText('Expert Un');
    expect(screen.queryByRole('columnheader', { name: 'RIB (masqué)' })).not.toBeInTheDocument();
  });

  it('SEC-30 : la révision lue part avec la validation ; 409 REVISION_PERIMEE traduit', async () => {
    const writes = mockApi({
      me: ADMIN_UAR,
      versions: [{ id: 'v-1', label: 'Barème UAR 2026', status: 'BROUILLON', createdBy: 'u-op', createdAt: '2026-10-19T08:00:00.000Z', cases: [], revision: 3 }],
      categories: [{ code: 'VL', label: 'Véhicule léger', status: 'SAISI', createdBy: 'u-op', createdAt: '2026-10-19T08:00:00.000Z', revision: 2 }],
      writeResponses: { 'POST /api/v1/referential/vehicle-categories/VL/validate': { status: 409, body: { code: 'REVISION_PERIMEE', message: 'x' } } },
    });
    renderWithProviders(<ReferentialPage />);
    const user = userEvent.setup();
    await user.click(within(await screen.findByRole('navigation', { name: /référentiel de place/i })).getByText('Barème Art. 14'));

    await user.click(within((await screen.findByText('Barème UAR 2026')).closest('tr')!).getByRole('button', { name: 'Valider (UAR)' }));
    await waitFor(() => expect(writes.find((w) => w.pathname.endsWith('/bareme-versions/v-1/validate'))?.body).toEqual({ revision: 3 }));

    await user.click(within(screen.getByText('Véhicule léger').closest('tr')!).getByRole('button', { name: 'Valider (UAR)' }));
    await waitFor(() => expect(writes.find((w) => w.pathname.endsWith('/vehicle-categories/VL/validate'))?.body).toEqual({ revision: 2 }));
    expect(await screen.findByText('La valeur a changé depuis votre lecture : rechargez-la avant de la valider.')).toBeInTheDocument();
  });

  it('parseDelayOverrides : format clé=jours borné', () => {
    expect(parseDelayOverrides('')).toBeUndefined();
    expect(parseDelayOverrides('silenceDays=15, oppositionDays=20')).toEqual({ silenceDays: 15, oppositionDays: 20 });
    expect(parseDelayOverrides('silenceDays=4000')).toBeNull();
    expect(parseDelayOverrides('1abc=3')).toBeNull();
    expect(parseDelayOverrides('silenceDays')).toBeNull();
  });
});
