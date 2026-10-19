import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeResponse, RecoursHistoryEntry, RecoursItem, RecoursState } from '@/lib/types';
import { FetchRequest, mockFetchRequests, renderWithProviders } from '@/test/render';
import { visibleRecoursActions } from '@/lib/recours-actions';
import ExchangesPage from './page';

/**
 * SEC-17 / SEC-25 / SEC-32 / SEC-46 — écran 4 : actions proposées selon le
 * rôle (un rôle place n'accepte, ne s'oppose, ne lève ni ne conteste),
 * historique d'audit réservé à la place, erreurs 409 traduites et fiche
 * relue par l'API.
 */

const OPERATEUR: MeResponse = { user: { id: 'u-op', name: 'Op.', email: 'op@uar.dz' }, role: 'OPERATEUR_PLACE', privileges: ['exchange', 'decide'] };
const DESTINATAIRE: MeResponse = { user: { id: 'u-saa', name: 'Corr. SAA', email: 'c@saa.dz' }, role: 'CORRESPONDANT_IDA', privileges: ['exchange'], company: 'SAA' };
const DEMANDEUR: MeResponse = { user: { id: 'u-caat', name: 'Corr. CAAT', email: 'c@caat.dz' }, role: 'CORRESPONDANT_IDA', privileges: ['exchange'], company: 'CAAT' };

function recours(state: RecoursState, overrides: Partial<RecoursItem> = {}): RecoursItem {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    claimId: 'c-1',
    from: 'CAAT',
    to: 'SAA',
    state,
    requestSentAt: '2026-10-01T08:00:00.000Z',
    amount: 150_000,
    timer: { timerType: 'AUCUN', remainingDays: 0, expired: false },
    createdAt: '2026-10-01T08:00:00.000Z',
    ...overrides,
  };
}

const HISTORY: RecoursHistoryEntry[] = [
  { at: '2026-10-01T08:00:00.000Z', action: 'creation', toState: 'EN_ATTENTE', actorId: 'u-caat', actorRole: 'CORRESPONDANT_IDA', onBehalfOf: 'CAAT' },
  { at: '2026-10-05T08:00:00.000Z', action: 'opposer', fromState: 'EN_ATTENTE', toState: 'OPPOSITION', actorId: 'u-saa', actorRole: 'CORRESPONDANT_IDA', onBehalfOf: 'SAA', reason: 'Responsabilité contestée' },
];

function mockApi(me: MeResponse, item: RecoursItem, onTransition?: (req: FetchRequest) => { status?: number; body: unknown }) {
  const requests: FetchRequest[] = [];
  let detail = item;
  mockFetchRequests((req) => {
    requests.push(req);
    const base = `/api/v1/recours/${item.id}`;
    if (req.method === 'POST' && req.pathname === `${base}/transition`) {
      const res = onTransition ? onTransition(req) : { body: { id: item.id, state: 'COMMISSION', timer: item.timer, transitionedAt: '' } };
      if (!res.status || res.status < 400) detail = { ...item, state: 'COMMISSION', commissionAt: '2026-10-19T08:00:00.000Z' };
      return res;
    }
    switch (req.pathname) {
      case '/api/v1/me':
        return { body: me };
      case '/api/v1/recours/counters':
        return { body: { TOUS: 1 } };
      case '/api/v1/recours':
        return { body: { page: 1, total: 1, items: [item] } };
      case '/api/v1/settlement/quarter/closures':
      case '/api/v1/referential/opposition-motifs':
      case '/api/v1/documents':
        return { body: [] };
      case base:
        return { body: detail };
      case `${base}/history`:
        return me.company ? { status: 404, body: { code: 'NOT_FOUND', message: 'Recours introuvable.' } } : { body: HISTORY };
      default:
        return undefined;
    }
  });
  return requests;
}

async function openDetail() {
  const user = userEvent.setup();
  await user.click((await screen.findByText('c-1')).closest('tr')!);
  return user;
}

describe('Écran 4 — actions selon le rôle et audit de place', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('visibleRecoursActions : miroir des règles du backend', () => {
    expect(visibleRecoursActions(recours('EN_ATTENTE'), OPERATEUR)).toEqual([]);
    expect(visibleRecoursActions(recours('EN_ATTENTE'), DESTINATAIRE)).toEqual(['accepter', 'opposer']);
    expect(visibleRecoursActions(recours('EN_ATTENTE'), DEMANDEUR)).toEqual([]);
    expect(visibleRecoursActions(recours('OPPOSITION'), DEMANDEUR)).toEqual(['lever_opposition', 'contester']);
    expect(visibleRecoursActions(recours('OPPOSITION'), OPERATEUR)).toEqual([]);
    expect(visibleRecoursActions(recours('CONTESTATION'), OPERATEUR)).toEqual(['transmettre_commission']);
    expect(visibleRecoursActions(recours('CONTESTATION'), DESTINATAIRE)).toEqual(['transmettre_commission']);
    expect(visibleRecoursActions(recours('COMMISSION'), OPERATEUR)).toEqual(['cloturer_commission_favorable', 'cloturer_commission_defavorable']);
    expect(visibleRecoursActions(recours('COMMISSION'), DESTINATAIRE)).toEqual([]);
  });

  it('SEC-17 : OPERATEUR_PLACE — ni Accepter ni Opposer sur un recours en attente', async () => {
    mockApi(OPERATEUR, recours('EN_ATTENTE'));
    renderWithProviders(<ExchangesPage />);
    await openDetail();

    expect(await screen.findByText('Aucune action disponible dans cet état pour votre profil.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accepter' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Formuler une opposition' })).not.toBeInTheDocument();
  });

  it('SEC-17 : historique d’audit affiché dans le fil d’échanges pour un rôle place', async () => {
    mockApi(OPERATEUR, recours('OPPOSITION'));
    renderWithProviders(<ExchangesPage />);
    await openDetail();

    const history = await screen.findByRole('region', { name: 'Historique des transitions (audit de place)' });
    await within(history).findByText('Création du recours');
    expect(history).toHaveTextContent('EN_ATTENTE → OPPOSITION');
    expect(history).toHaveTextContent('au nom de SAA');
    expect(history).toHaveTextContent('Responsabilité contestée');
  });

  it('rôle compagnie : l’historique d’audit n’est ni affiché ni demandé', async () => {
    const requests = mockApi(DESTINATAIRE, recours('EN_ATTENTE'));
    renderWithProviders(<ExchangesPage />);
    await openDetail();

    await screen.findByRole('button', { name: 'Accepter' });
    expect(screen.queryByRole('region', { name: 'Historique des transitions (audit de place)' })).not.toBeInTheDocument();
    expect(requests.some((r) => r.pathname.endsWith('/history'))).toBe(false);
  });

  it('transition réussie : la fiche est relue par l’API (nouvel état affiché)', async () => {
    mockApi(OPERATEUR, recours('CONTESTATION'));
    renderWithProviders(<ExchangesPage />);
    const user = await openDetail();

    await user.click(await screen.findByRole('button', { name: 'Transmettre en commission' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Clôturer — favorable' })).toBeInTheDocument());
  });

  it.each([
    ['CONFLIT_CONCURRENT', 409, 'Le dossier a été modifié entre-temps : rechargez-le avant de recommencer.'],
    ['DECISION_COMMISSION_REQUISE', 409, 'La clôture exige une décision de commission prononcée, de même sens, dont le PV est signé.'],
  ])('erreur %s : message traduit', async (code, status, message) => {
    mockApi(OPERATEUR, recours('COMMISSION'), () => ({ status, body: { code, message: 'texte serveur' } }));
    renderWithProviders(<ExchangesPage />);
    const user = await openDetail();

    await user.click(await screen.findByRole('button', { name: 'Clôturer — favorable' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
  });
});
