import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BaremeVersion, ConstatCircumstance, DeclarationResponsabilite, MatchQueueItem, MeResponse, VehicleCategory } from '@/lib/types';
import { FetchRequest, mockFetchRequests, renderWithProviders } from '@/test/render';
import MatchingPage from './page';

/**
 * Écran 2 — responsabilité Art. 14 (décision PO §5) : déclarations A et B côte
 * à côte, badge « Divergence », taux selon barème face au taux déclaré, saisie
 * via `PATCH /claims/:id/responsabilite` (le backend fait foi : 403/400 en toast).
 */

const ME_OPERATOR: MeResponse = { user: { id: 'u-op', name: 'Opérateur', email: 'op@uar.dz' }, role: 'OPERATEUR_PLACE', privileges: ['matchDecide', 'insert'] };
const ME_CORRESPONDANT_CAAT: MeResponse = {
  user: { id: 'u-caat', name: 'Correspondant CAAT', email: 'c@caat.dz' },
  role: 'CORRESPONDANT_IDA',
  privileges: ['matchDecide', 'insert'],
  company: 'CAAT',
};
const ME_AUDITOR: MeResponse = { user: { id: 'u-audit', name: 'Auditeur', email: 'a@csa.dz' }, role: 'AUDITEUR_CSA', privileges: [] };

const CIRCUMSTANCES: ConstatCircumstance[] = Array.from({ length: 17 }, (_, i) => ({
  number: i + 1,
  labelFr: `circonstance ${i + 1}`,
  status: 'STANDARD_A_CONFIRMER',
  createdBy: 'system:seed',
}));

const PUBLISHED: BaremeVersion = {
  id: 'v-pub',
  label: 'Barème UAR 2026',
  status: 'VALIDE_UAR',
  createdBy: 'u-op',
  createdAt: '2026-10-19T08:00:00.000Z',
  validatedBy: 'u-admin',
  cases: [
    { code: 'X1', label: 'Choc arrière', partA: 0, partB: 100, createdBy: 'u-op', createdAt: '2026-10-19T08:00:00.000Z' },
    { code: 'X2', label: 'Changement de file', partA: 100, partB: 0, createdBy: 'u-op', createdAt: '2026-10-19T08:00:00.000Z' },
  ],
};
const DRAFT: BaremeVersion = { ...PUBLISHED, id: 'v-draft', label: 'Brouillon 2027', status: 'BROUILLON', cases: [{ ...PUBLISHED.cases[0], code: 'DRAFT1', label: 'Cas brouillon' }] };
const CATEGORIES: VehicleCategory[] = [
  { code: 'VL', label: 'Véhicule léger', status: 'VALIDE_UAR', createdBy: 'u-op', createdAt: '2026-10-19T08:00:00.000Z' },
  { code: 'PL', label: 'Poids lourd', status: 'SAISI', createdBy: 'u-op', createdAt: '2026-10-19T08:00:00.000Z' },
];

function item(responsabiliteA?: DeclarationResponsabilite, responsabiliteB?: DeclarationResponsabilite, overrides: Partial<MatchQueueItem> = {}): MatchQueueItem {
  return {
    id: 'm-1',
    refA: 'ECN-1',
    companyA: 'CAAT',
    plateA: '16001',
    refB: 'ECN-1',
    companyB: 'SAA',
    plateB: '31001',
    score: 100,
    level: 'AUTO',
    status: 'AUTO_CONFIRME',
    econstatShared: true,
    criteria: { econstatPartage: true, plaquesCroisees: true, policeCroisee: true, dateHeure: true, compagniesCroisees: true, gps: true },
    at: '2026-10-19T08:00:00.000Z',
    responsabiliteA,
    responsabiliteB,
    divergence: false,
    ...overrides,
  };
}

interface State {
  me: MeResponse;
  detail: MatchQueueItem;
  versions?: BaremeVersion[];
  categories?: VehicleCategory[];
  patch?: { status: number; body: unknown };
}

function mockApi(state: State) {
  const requests: FetchRequest[] = [];
  mockFetchRequests((req) => {
    requests.push(req);
    if (req.method === 'PATCH') return state.patch ?? { body: { id: 'c-caat' } };
    switch (req.pathname) {
      case '/api/v1/me':
        return { body: state.me };
      case '/api/v1/matching/queue/counters':
        return { body: { TOUS: 1, AUTO: 1, A_CONFIRMER: 0, NON_APPARIES: 0 } };
      case '/api/v1/matching/thresholds':
        return { body: { autoThreshold: 80, confirmThreshold: 50 } };
      case '/api/v1/matching/queue':
        return { body: { page: 1, total: 1, items: [{ ...state.detail, responsabiliteA: undefined, responsabiliteB: undefined, divergence: false }] } };
      case '/api/v1/matching/m-1':
        return { body: { ...state.detail, claimAId: 'c-caat', claimBId: 'c-saa' } };
      case '/api/v1/referential/constat-circumstances':
        return { body: CIRCUMSTANCES };
      case '/api/v1/referential/bareme-versions':
        return { body: state.versions ?? [PUBLISHED, DRAFT] };
      case '/api/v1/referential/vehicle-categories':
        return { body: state.categories ?? CATEGORIES };
      default:
        return undefined;
    }
  });
  return requests;
}

async function renderPanel() {
  renderWithProviders(<MatchingPage />);
  return screen.findByText('Responsabilité — barème Art. 14');
}

function declaration(side: 'A' | 'B') {
  return screen.getByRole('region', { name: `Déclaration ${side}` });
}

describe('Écran 2 — responsabilité Art. 14 (décision PO §5)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('affiche A et B côte à côte, circonstances en numéro et libellé, et le badge « Divergence »', async () => {
    mockApi({
      me: ME_AUDITOR,
      detail: item(
        { circonstancesA: [8], circonstancesB: [1], baremeCode: 'X1', vehicleCategoryA: 'VL', responsabiliteDeclareeA: 0, responsabiliteDeclareeB: 100 },
        { baremeCode: 'X2' },
        { divergence: true },
      ),
    });
    await renderPanel();

    await waitFor(() => expect(within(declaration('A')).getByText('X1')).toBeInTheDocument());
    expect(within(declaration('A')).getByText(/circonstance 8/)).toBeInTheDocument();
    expect(within(declaration('A')).getByText(/circonstance 1$/)).toBeInTheDocument();
    expect(within(declaration('B')).getByText('X2')).toBeInTheDocument();
    expect(screen.getByText('Divergence')).toBeInTheDocument();
  });

  it('pas de badge « Divergence » quand le backend n’en signale pas', async () => {
    mockApi({ me: ME_AUDITOR, detail: item({ baremeCode: 'X1' }, { baremeCode: 'X1' }) });
    await renderPanel();

    await waitFor(() => expect(within(declaration('B')).getByText('X1')).toBeInTheDocument());
    expect(screen.queryByText('Divergence')).not.toBeInTheDocument();
  });

  it('alerte non bloquante quand le taux selon barème diffère du taux déclaré', async () => {
    const taux = { baremeVersionId: 'v-pub', versionLabel: 'Barème UAR 2026', partA: 0, partB: 100 };
    mockApi({
      me: ME_AUDITOR,
      detail: item(
        { baremeCode: 'X1', responsabiliteDeclareeA: 50, responsabiliteDeclareeB: 50, tauxSelonBareme: taux },
        { baremeCode: 'X1', responsabiliteDeclareeA: 0, responsabiliteDeclareeB: 100, tauxSelonBareme: taux },
      ),
    });
    await renderPanel();

    await waitFor(() => expect(within(declaration('A')).getByText('(Barème UAR 2026)')).toBeInTheDocument());
    expect(within(declaration('A')).getByRole('status')).toHaveTextContent('Le taux selon barème diffère du taux déclaré');
    expect(within(declaration('B')).queryByRole('status')).not.toBeInTheDocument();
  });

  it('CORRESPONDANT_IDA : saisie sur la déclaration de sa compagnie seulement', async () => {
    mockApi({ me: ME_CORRESPONDANT_CAAT, detail: item() });
    await renderPanel();

    expect(await within(declaration('A')).findByRole('button', { name: 'Saisir la responsabilité' })).toBeInTheDocument();
    expect(within(declaration('B')).queryByRole('button', { name: 'Saisir la responsabilité' })).not.toBeInTheDocument();
  });

  it('rôle place avec matchDecide : saisie sur les deux déclarations ; sans privilège : aucune', async () => {
    mockApi({ me: ME_OPERATOR, detail: item() });
    const { unmount } = renderWithProviders(<MatchingPage />);
    await screen.findByText('Responsabilité — barème Art. 14');
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Saisir la responsabilité' })).toHaveLength(2));
    unmount();
    vi.unstubAllGlobals();

    mockApi({ me: ME_AUDITOR, detail: item() });
    await renderPanel();
    await within(declaration('B')).findByText('SAA');
    expect(screen.queryByRole('button', { name: 'Saisir la responsabilité' })).not.toBeInTheDocument();
  });

  it('listes alimentées par les seules valeurs VALIDE_UAR ; envoi des seuls champs modifiés au dossier retrouvé', async () => {
    const requests = mockApi({ me: ME_CORRESPONDANT_CAAT, detail: item({ circonstancesA: [8] }) });
    await renderPanel();
    const user = userEvent.setup();

    await user.click(await within(declaration('A')).findByRole('button', { name: 'Saisir la responsabilité' }));
    const dialog = screen.getByRole('dialog');
    const code = within(dialog).getByLabelText('Code de barème');
    await waitFor(() => expect(code).toBeEnabled());
    const codeOptions = within(code).getAllByRole('option').map((o) => o.textContent);
    expect(codeOptions.some((o) => o?.startsWith('X1 — Choc arrière (Barème UAR 2026)'))).toBe(true);
    expect(codeOptions.some((o) => o?.includes('DRAFT1'))).toBe(false);
    const categoryOptions = within(within(dialog).getByLabelText('Catégorie de véhicule · son assuré')).getAllByRole('option').map((o) => o.textContent);
    expect(categoryOptions).toContain('VL — Véhicule léger');
    expect(categoryOptions.some((o) => o?.startsWith('PL'))).toBe(false);

    await user.selectOptions(code, 'v-pub|X2');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => expect(requests.some((r) => r.method === 'PATCH')).toBe(true));
    const patch = requests.find((r) => r.method === 'PATCH')!;
    expect(patch.pathname).toBe('/api/v1/claims/c-caat/responsabilite');
    expect(patch.body).toEqual({ baremeCode: 'X2', baremeVersionId: 'v-pub' });
    expect(requests.some((r) => r.pathname === '/api/v1/claims')).toBe(false);
    expect(await screen.findByText('Responsabilité Art. 14 enregistrée.')).toBeInTheDocument();
  });

  it('403 RECOURS_OUVERT : le message du backend s’affiche en toast', async () => {
    const message = 'Un recours est ouvert sur ce dossier : seul l’opérateur de la place peut encore modifier le barème Art. 14.';
    mockApi({ me: ME_CORRESPONDANT_CAAT, detail: item(), patch: { status: 403, body: { code: 'RECOURS_OUVERT', message } } });
    await renderPanel();
    const user = userEvent.setup();

    await user.click(await within(declaration('A')).findByRole('button', { name: 'Saisir la responsabilité' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getAllByLabelText(/^1 · circonstance 1$/)[0]);
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('400 BAREME_NON_PUBLIE : le message du backend s’affiche en toast', async () => {
    const message = 'Barème non publié : catégorie de véhicule « VL » non validée UAR.';
    mockApi({ me: ME_OPERATOR, detail: item(), patch: { status: 400, body: { code: 'BAREME_NON_PUBLIE', message } } });
    await renderPanel();
    const user = userEvent.setup();

    await user.click((await within(declaration('A')).findAllByRole('button', { name: 'Saisir la responsabilité' }))[0]);
    const dialog = screen.getByRole('dialog');
    const select = within(dialog).getByLabelText('Catégorie de véhicule · son assuré');
    await waitFor(() => expect(select).toBeEnabled());
    await user.selectOptions(select, 'VL');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it('sans barème ni catégorie publiés : listes désactivées avec « Barème non publié »', async () => {
    mockApi({ me: ME_OPERATOR, detail: item(), versions: [DRAFT], categories: [CATEGORIES[1]] });
    await renderPanel();
    const user = userEvent.setup();

    await user.click((await within(declaration('A')).findAllByRole('button', { name: 'Saisir la responsabilité' }))[0]);
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(within(dialog).getByLabelText('Code de barème')).toBeDisabled());
    for (const label of ['Code de barème', 'Catégorie de véhicule · son assuré', 'Catégorie de véhicule · partie adverse']) {
      const select = within(dialog).getByLabelText(label);
      expect(select).toBeDisabled();
      expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Barème non publié']);
    }
  });
});
