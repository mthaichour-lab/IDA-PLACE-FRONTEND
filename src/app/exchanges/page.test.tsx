import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mockFetchRouter, renderWithProviders } from '@/test/render';
import { MeResponse, RecoursItem } from '@/lib/types';
import ExchangesPage from './page';

const ME_WITH_EXCHANGE: MeResponse = {
  user: { id: 'dev-correspondant', name: 'Correspondant IDA (dev)', email: 'correspondant@compagnie.dz' },
  role: 'CORRESPONDANT_IDA',
  privileges: ['exchange'],
};

const ME_WITHOUT_EXCHANGE: MeResponse = {
  user: { id: 'dev-auditeur', name: 'Auditeur CSA (dev)', email: 'auditeur@csa.dz' },
  role: 'AUDITEUR_CSA',
  privileges: [],
};

function recoursItem(overrides: Partial<RecoursItem> = {}): RecoursItem {
  return {
    id: 'r-1',
    claimId: 'c-1',
    from: 'CAAT',
    to: 'SAA',
    state: 'EN_ATTENTE',
    requestSentAt: new Date().toISOString(),
    amount: 150_000,
    timer: { timerType: 'SILENCE_ART10', deadlineAt: new Date(Date.now() + 5 * 86_400_000).toISOString(), remainingDays: 5, expired: false },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function mockExchangesApi(me: MeResponse, items: RecoursItem[]) {
  mockFetchRouter((pathname, url) => {
    if (pathname === '/api/v1/me') return me;
    if (pathname === '/api/v1/recours/counters') return { TOUS: items.length, EN_ATTENTE: items.length, OPPOSITION: 0, CONTESTATION: 0, COMMISSION: 0, FORCLOS: 0 };
    if (pathname === '/api/v1/recours') {
      const page = Number(url.searchParams.get('page') ?? '1');
      return { page, total: items.length, items };
    }
    return undefined;
  });
}

/**
 * Écran Échanges Annexe 2/3/4 (/exchanges, écran 4, Module B §6.4) — n'affiche
 * que les actions autorisées par l'état courant (`RECOURS_ALLOWED_ACTIONS`),
 * échéance conventionnelle (`CountdownBar`), lecture seule pour AUDITEUR_CSA.
 */
describe('Écran Échanges (/exchanges)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('affiche la file des recours avec échéance et montant', async () => {
    mockExchangesApi(ME_WITH_EXCHANGE, [recoursItem()]);
    renderWithProviders(<ExchangesPage />);

    await waitFor(() => expect(screen.getByText('c-1')).toBeInTheDocument());
    expect(screen.getByText(/150\s?000/)).toBeInTheDocument();
  });

  it('ouvre le détail et propose uniquement les actions autorisées pour EN_ATTENTE (Accepter/Opposer)', async () => {
    mockExchangesApi(ME_WITH_EXCHANGE, [recoursItem({ state: 'EN_ATTENTE' })]);
    renderWithProviders(<ExchangesPage />);

    await waitFor(() => expect(screen.getByText('c-1')).toBeInTheDocument());
    fireEvent.click(screen.getByText('c-1').closest('tr')!);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Accepter' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Formuler une opposition' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lever l’opposition' })).not.toBeInTheDocument();
  });

  it("n'affiche aucune action disponible pour un dossier REGLE (terminal)", async () => {
    mockExchangesApi(ME_WITH_EXCHANGE, [recoursItem({ state: 'REGLE', timer: { timerType: 'AUCUN', remainingDays: 0, expired: false } })]);
    renderWithProviders(<ExchangesPage />);

    await waitFor(() => expect(screen.getByText('c-1')).toBeInTheDocument());
    fireEvent.click(screen.getByText('c-1').closest('tr')!);

    await waitFor(() => expect(screen.getByText('Aucune action disponible dans cet état.')).toBeInTheDocument());
  });

  it('désactive les actions de transition pour AUDITEUR_CSA (lecture seule, B.7)', async () => {
    mockExchangesApi(ME_WITHOUT_EXCHANGE, [recoursItem({ state: 'EN_ATTENTE' })]);
    renderWithProviders(<ExchangesPage />);

    await waitFor(() => expect(screen.getByText('c-1')).toBeInTheDocument());
    fireEvent.click(screen.getByText('c-1').closest('tr')!);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Accepter' })).toBeDisabled());
  });
});
