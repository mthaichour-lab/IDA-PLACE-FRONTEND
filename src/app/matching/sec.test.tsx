import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatchDecisionHistoryEntry, MatchQueueItem, MeResponse } from '@/lib/types';
import { FetchRequest, mockFetchRequests, renderWithProviders } from '@/test/render';
import MatchingPage from './page';

/**
 * SEC-03 / SEC-26 / SEC-28 — écran 2 : valeurs de l'autre compagnie masquées
 * (« •••• », `masked`), auteur de décision anonymisé, historique des
 * décisions et motif obligatoire pour une re-décision.
 */

const CORRESPONDANT: MeResponse = {
  user: { id: 'u-corr', name: 'Correspondant', email: 'c@caat.dz' },
  role: 'CORRESPONDANT_IDA',
  privileges: ['matchDecide', 'insert'],
  company: 'CAAT',
};
const OPERATEUR: MeResponse = { user: { id: 'u-op', name: 'Opérateur', email: 'op@uar.dz' }, role: 'OPERATEUR_PLACE', privileges: ['matchDecide'] };

function item(overrides: Partial<MatchQueueItem> = {}): MatchQueueItem {
  return {
    id: 'm-1',
    reference: 'MAT-261013-001',
    refA: 'ECN-1',
    companyA: 'CAAT',
    plateA: '16001-120-16',
    refB: 'ECN-2',
    companyB: 'SAA',
    plateB: '••••',
    policeB: '••••',
    assureBIdentite: '••••',
    canalDeclarationB: '••••' as never,
    wilayaA: '16',
    wilayaB: '16',
    score: 65,
    level: 'MANUEL',
    status: 'A_CONFIRMER',
    econstatShared: false,
    criteria: { econstatPartage: false, plaquesCroisees: true, policeCroisee: false, dateHeure: true, compagniesCroisees: true, gps: false },
    at: '2026-10-19T08:00:00.000Z',
    divergence: false,
    masked: true,
    ...overrides,
  };
}

const HISTORY: MatchDecisionHistoryEntry[] = [
  {
    id: 'd-1',
    action: 'reject',
    previousStatus: 'A_CONFIRMER',
    newStatus: 'REJETE',
    reason: 'Plaques incohérentes',
    decidedBy: 'Compagnie SAA',
    decidedByRole: 'CORRESPONDANT_IDA',
    decidedByCompany: 'SAA',
    decidedAt: '2026-10-18T09:00:00.000Z',
  },
];

/** Panneau « Appariement » (aside) : les boutons de décision y sont uniques (la vue de confrontation en répète deux). */
const panel = () => screen.getByRole('complementary', { name: 'Appariement' });

function mockApi(me: MeResponse, row: MatchQueueItem, decide?: (req: FetchRequest) => { status?: number; body: unknown }) {
  const requests: FetchRequest[] = [];
  mockFetchRequests((req) => {
    requests.push(req);
    if (req.method === 'POST' && req.pathname === '/api/v1/matching/m-1/decide') return decide ? decide(req) : { body: { id: 'm-1', status: 'CONFIRME_MANUEL', decidedAt: '', decidedBy: '' } };
    switch (req.pathname) {
      case '/api/v1/me':
        return { body: me };
      case '/api/v1/matching/queue/counters':
        return { body: { TOUS: 1, AUTO: 0, A_CONFIRMER: 1, NON_APPARIES: 0 } };
      case '/api/v1/matching/thresholds':
        return { body: { autoThreshold: 80, confirmThreshold: 50 } };
      case '/api/v1/matching/queue':
        return { body: { page: 1, total: 1, items: [row] } };
      case '/api/v1/matching/m-1':
        return { body: { ...row, claimAId: 'c-caat' } };
      case '/api/v1/matching/m-1/decisions':
        return { body: row.status === 'REJETE' ? HISTORY : [] };
      case '/api/v1/referential/constat-circumstances':
      case '/api/v1/referential/bareme-versions':
      case '/api/v1/referential/vehicle-categories':
        return { body: [] };
      default:
        return undefined;
    }
  });
  return requests;
}

describe('Écran 2 — masquage, historique et re-décision motivée', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('SEC-03 : valeurs « •••• » de l’autre compagnie affichées « masqué », jamais en clair ni comparées', async () => {
    mockApi(CORRESPONDANT, item());
    renderWithProviders(<MatchingPage />);

    await screen.findByText("Données nominatives de l'autre compagnie masquées tant que l'appariement n'est pas confirmé.");
    expect(screen.queryByText('••••')).not.toBeInTheDocument();
    expect(screen.getAllByText('masqué').length).toBeGreaterThanOrEqual(4);
    // Carte véhicule B : canal masqué sans erreur de libellé.
    const vehicleB = screen.getByText('Véhicule B').closest('div')!.parentElement!;
    expect(within(vehicleB).getAllByText('masqué').length).toBeGreaterThanOrEqual(3);
    // Saisie Art. 14 de la compagnie adverse non publiée.
    await screen.findByText("Saisie de l'autre compagnie masquée tant que l'appariement n'est pas confirmé.");
  });

  it('SEC-26 : auteur d’une autre compagnie affiché tel que renvoyé (« Compagnie SAA »)', async () => {
    mockApi(CORRESPONDANT, item({ status: 'REJETE', masked: true, confirmedBy: 'Compagnie SAA', confirmedByCompany: 'SAA', confirmedAt: '2026-10-18T09:00:00.000Z' }));
    renderWithProviders(<MatchingPage />);

    expect(await screen.findByText(/Décidé par: Compagnie SAA/)).toBeInTheDocument();
  });

  it('SEC-28 : historique des décisions affiché dans le panneau (auteur, transition, motif)', async () => {
    mockApi(CORRESPONDANT, item({ status: 'REJETE' }));
    renderWithProviders(<MatchingPage />);

    const history = await screen.findByRole('region', { name: 'Historique des décisions' });
    await within(history).findByText('Rejet');
    expect(history).toHaveTextContent('A_CONFIRMER → REJETE');
    expect(history).toHaveTextContent('par Compagnie SAA (SAA)');
    expect(history).toHaveTextContent('Motif : Plaques incohérentes');
  });

  it('SEC-28 : ligne déjà tranchée → motif obligatoire, actions désactivées tant qu’il est vide, puis envoyé', async () => {
    const requests = mockApi(OPERATEUR, item({ status: 'REJETE', masked: false, plateB: '31002-118-31' }));
    renderWithProviders(<MatchingPage />);
    const user = userEvent.setup();

    const reason = await screen.findByLabelText('Motif (obligatoire : confrontation déjà tranchée)');
    expect(screen.getByText('Revenir sur une décision déjà prise exige un motif.')).toBeInTheDocument();
    expect(within(panel()).getByRole('button', { name: "Confirmer l'appariement" })).toBeDisabled();
    expect(within(panel()).getByRole('button', { name: 'Rejeter' })).toBeDisabled();

    // Raccourci clavier C ignoré tant que le motif manque.
    await user.keyboard('c');
    expect(requests.some((r) => r.method === 'POST')).toBe(false);

    await user.type(reason, 'Nouvelle pièce reçue');
    await user.click(within(panel()).getByRole('button', { name: "Confirmer l'appariement" }));

    await waitFor(() => expect(requests.find((r) => r.method === 'POST')?.body).toEqual({ action: 'confirm', reason: 'Nouvelle pièce reçue' }));
  });

  it('ligne non tranchée : motif facultatif, confirmation sans motif sans champ `reason`', async () => {
    const requests = mockApi(OPERATEUR, item({ masked: false, plateB: '31002-118-31' }));
    renderWithProviders(<MatchingPage />);
    const user = userEvent.setup();

    await screen.findByLabelText('Motif (facultatif)');
    await user.click(within(panel()).getByRole('button', { name: "Confirmer l'appariement" }));
    await waitFor(() => expect(requests.find((r) => r.method === 'POST')?.body).toEqual({ action: 'confirm' }));
  });

  it('400 MOTIF_REQUIS : message traduit en toast', async () => {
    mockApi(OPERATEUR, item({ masked: false, plateB: '31002-118-31' }), () => ({ status: 400, body: { code: 'MOTIF_REQUIS', message: 'reason' } }));
    renderWithProviders(<MatchingPage />);
    const user = userEvent.setup();

    await screen.findByRole('complementary', { name: 'Appariement' });
    await user.click(await within(panel()).findByRole('button', { name: "Confirmer l'appariement" }));
    expect(await screen.findByText('Cette confrontation a déjà été tranchée : indiquez le motif de la nouvelle décision.')).toBeInTheDocument();
  });
});
