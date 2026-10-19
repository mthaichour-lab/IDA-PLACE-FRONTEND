import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeResponse, OppositionMotif, RecoursItem } from '@/lib/types';
import { FetchRequest, mockFetchRequests, renderWithProviders } from '@/test/render';
import ExchangesPage from './page';

/**
 * Écran 4 — action « opposer » (décision PO §1, arbitrage Tech Lead) :
 * catalogue sans motif admis → motif libre + attestation obligatoire « pas
 * une non-déclaration » ; motifs admis → liste déroulante obligatoire, motif
 * interdit visible mais grisé. `reasonCode` n'est envoyé qu'avec un motif choisi.
 */

const ME: MeResponse = { user: { id: 'u-corr', name: 'Correspondant', email: 'c@saa.dz' }, role: 'CORRESPONDANT_IDA', privileges: ['exchange'] };

const RECOURS: RecoursItem = {
  id: 'r-1',
  claimId: 'c-1',
  from: 'CAAT',
  to: 'SAA',
  state: 'EN_ATTENTE',
  requestSentAt: new Date().toISOString(),
  amount: 150_000,
  timer: { timerType: 'SILENCE_ART10', deadlineAt: new Date(Date.now() + 5 * 86_400_000).toISOString(), remainingDays: 5, expired: false },
  createdAt: new Date().toISOString(),
};

const NON_DECLARATION: OppositionMotif = {
  code: 'NON_DECLARATION',
  label: 'Non-déclaration du sinistre',
  forbidden: true,
  status: 'SAISI',
  createdBy: 'system:seed',
  createdAt: '2026-10-18T00:00:00.000Z',
};
const MONTANT_CONTESTE: OppositionMotif = { ...NON_DECLARATION, code: 'MONTANT_CONTESTE', label: 'Montant contesté', forbidden: false, createdBy: 'u-op' };

function mockApi(motifs: OppositionMotif[], recours: RecoursItem = RECOURS) {
  const writes: FetchRequest[] = [];
  mockFetchRequests((req) => {
    if (req.method === 'POST') {
      writes.push(req);
      return { body: { id: recours.id, state: 'OPPOSITION', timer: recours.timer, transitionedAt: new Date().toISOString() } };
    }
    if (req.pathname === '/api/v1/me') return { body: ME };
    if (req.pathname === '/api/v1/recours/counters') return { body: { TOUS: 1, EN_ATTENTE: 1 } };
    if (req.pathname === '/api/v1/recours') return { body: { page: 1, total: 1, items: [recours] } };
    if (req.pathname === `/api/v1/recours/${recours.id}`) return { body: recours };
    if (req.pathname === '/api/v1/referential/opposition-motifs') return { body: motifs };
    if (req.pathname === '/api/v1/documents') return { body: [] };
    if (req.pathname === '/api/v1/settlement/quarter/closures') return { body: [] };
    return undefined;
  });
  return writes;
}

async function openOpposition() {
  renderWithProviders(<ExchangesPage />);
  const user = userEvent.setup();
  await user.click((await screen.findByText('c-1')).closest('tr')!);
  await user.click(await screen.findByRole('button', { name: 'Formuler une opposition' }));
  return { user, group: await screen.findByRole('group', { name: 'Formuler une opposition' }) };
}

describe('Écran 4 — opposition motivée (décision PO §1)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sans motif admis au catalogue : motif libre et case obligatoire, sans `reasonCode`', async () => {
    const writes = mockApi([NON_DECLARATION]);
    const { user, group } = await openOpposition();

    await waitFor(() => expect(within(group).getByRole('checkbox', { name: "Cette opposition n'est pas motivée par une non-déclaration (Art. 10)" })).toBeInTheDocument());
    expect(within(group).queryByRole('combobox')).not.toBeInTheDocument();
    const confirm = within(group).getByRole('button', { name: "Confirmer l'opposition" });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText('Motif (optionnel)'), 'Responsabilité contestée');
    await user.click(within(group).getByRole('checkbox'));
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].pathname).toBe('/api/v1/recours/r-1/transition');
    expect(writes[0].body).toEqual({ action: 'opposer', reason: 'Responsabilité contestée' });
  });

  it('catalogue indisponible : même repli (motif libre + attestation)', async () => {
    const writes: FetchRequest[] = [];
    mockFetchRequests((req) => {
      if (req.method === 'POST') {
        writes.push(req);
        return { body: { id: 'r-1', state: 'OPPOSITION', timer: RECOURS.timer, transitionedAt: new Date().toISOString() } };
      }
      if (req.pathname === '/api/v1/me') return { body: ME };
      if (req.pathname === '/api/v1/recours/counters') return { body: { TOUS: 1 } };
      if (req.pathname === '/api/v1/recours') return { body: { page: 1, total: 1, items: [RECOURS] } };
      if (req.pathname === '/api/v1/recours/r-1') return { body: RECOURS };
      if (req.pathname === '/api/v1/documents') return { body: [] };
      return undefined; // /referential/opposition-motifs → 404
    });
    const { group } = await openOpposition();

    await waitFor(() => expect(within(group).getByRole('checkbox')).toBeInTheDocument());
    expect(within(group).queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('avec des motifs admis : liste obligatoire, motif interdit grisé, `reasonCode` envoyé', async () => {
    const writes = mockApi([MONTANT_CONTESTE, NON_DECLARATION]);
    const { user, group } = await openOpposition();

    const select = await within(group).findByRole('combobox', { name: "Motif d'opposition (obligatoire)" });
    expect(select).toBeRequired();
    expect(within(group).queryByRole('checkbox')).not.toBeInTheDocument();

    const forbidden = within(select).getByRole('option', { name: 'Non-déclaration du sinistre — Interdit — Art. 10' });
    expect(forbidden).toBeDisabled();
    expect(within(select).getByRole('option', { name: 'Montant contesté' })).toBeEnabled();

    const confirm = within(group).getByRole('button', { name: "Confirmer l'opposition" });
    expect(confirm).toBeDisabled();
    await user.selectOptions(select, 'MONTANT_CONTESTE');
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toEqual({ action: 'opposer', reasonCode: 'MONTANT_CONTESTE' });
  });

  it('les autres actions restent directes (pas de formulaire d’opposition pour « Accepter »)', async () => {
    const writes = mockApi([MONTANT_CONTESTE]);
    renderWithProviders(<ExchangesPage />);
    const user = userEvent.setup();
    await user.click((await screen.findByText('c-1')).closest('tr')!);
    await user.click(await screen.findByRole('button', { name: 'Accepter' }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toEqual({ action: 'accepter' });
    expect(screen.queryByRole('group', { name: 'Formuler une opposition' })).not.toBeInTheDocument();
  });

  it('affiche le libellé du motif choisi dans le fil d’échanges (Annexe 3)', async () => {
    mockApi([MONTANT_CONTESTE, NON_DECLARATION], {
      ...RECOURS,
      state: 'OPPOSITION',
      opposition: { raisedAt: new Date().toISOString(), reasonCode: 'MONTANT_CONTESTE', reason: 'Devis surévalué', status: 'EN_COURS' },
    });
    renderWithProviders(<ExchangesPage />);
    const user = userEvent.setup();
    await user.click((await screen.findByText('c-1')).closest('tr')!);

    expect(await screen.findByText('Montant contesté — Devis surévalué')).toBeInTheDocument();
  });
});
