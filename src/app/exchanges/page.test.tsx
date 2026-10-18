import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mockFetchRouter, renderWithProviders } from '@/test/render';
import { MeResponse, RecoursItem, SettlementQuarterClosure } from '@/lib/types';
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
    if (pathname === '/api/v1/recours/counters') {
      return { TOUS: items.length, EN_ATTENTE: items.length, OPPOSITION: 0, CONTESTATION: 0, COMMISSION: 0, REGLE: 0, REJETE: 0, FORCLOS: 0 };
    }
    if (/^\/api\/v1\/recours\/[^/]+$/.test(pathname)) {
      const id = pathname.split('/').pop();
      return items.find((r) => r.id === id);
    }
    if (pathname === '/api/v1/recours') {
      const page = Number(url.searchParams.get('page') ?? '1');
      const q = url.searchParams.get('q')?.toLowerCase();
      const filtered = q ? items.filter((r) => [r.id, r.claimId, r.from, r.to].some((v) => v.toLowerCase().includes(q))) : items;
      return { page, total: filtered.length, items: filtered };
    }
    return undefined;
  });
}

/**
 * Variante qui respecte RÉELLEMENT `filter` (contrairement à `mockExchangesApi`
 * ci-dessus, qui renvoie toujours la même liste quel que soit l'onglet —
 * suffisant pour les tests existants, pas pour vérifier le sous-classement
 * REGLE) et mocke `GET /settlement/quarter/closures` — nécessaire pour les
 * tests de sous-onglets "Accepté/silence" / "Réglé/compensé".
 */
function mockExchangesApiWithClosures(me: MeResponse, items: RecoursItem[], closures: SettlementQuarterClosure[]) {
  mockFetchRouter((pathname, url) => {
    if (pathname === '/api/v1/me') return me;
    if (pathname === '/api/v1/settlement/quarter/closures') return closures;
    if (pathname === '/api/v1/recours/counters') {
      const counters: Record<string, number> = { TOUS: items.length, EN_ATTENTE: 0, OPPOSITION: 0, CONTESTATION: 0, COMMISSION: 0, REGLE: 0, REJETE: 0, FORCLOS: 0 };
      for (const r of items) counters[r.state] = (counters[r.state] ?? 0) + 1;
      return counters;
    }
    if (/^\/api\/v1\/recours\/[^/]+$/.test(pathname)) {
      const id = pathname.split('/').pop();
      return items.find((r) => r.id === id);
    }
    if (pathname === '/api/v1/recours') {
      const page = Number(url.searchParams.get('page') ?? '1');
      const filterParam = url.searchParams.get('filter');
      const q = url.searchParams.get('q')?.toLowerCase();
      let filtered = filterParam && filterParam !== 'TOUS' ? items.filter((r) => r.state === filterParam) : items;
      if (q) filtered = filtered.filter((r) => [r.id, r.claimId, r.from, r.to].some((v) => v.toLowerCase().includes(q)));
      return { page, total: filtered.length, items: filtered };
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

  it('propose les onglets Réglés et Rejetés (états réels non exposés jusqu’ici)', async () => {
    mockExchangesApi(ME_WITH_EXCHANGE, [recoursItem()]);
    renderWithProviders(<ExchangesPage />);

    await waitFor(() => expect(screen.getByRole('tab', { name: /réglés/i })).toBeInTheDocument());
    expect(screen.getByRole('tab', { name: /rejetés/i })).toBeInTheDocument();
  });

  it('reconstruit le fil d’échanges à partir des champs réels (Annexe 2 + Annexe 3 avec son motif)', async () => {
    mockExchangesApi(ME_WITH_EXCHANGE, [
      recoursItem({
        state: 'OPPOSITION',
        opposition: { raisedAt: new Date().toISOString(), reason: 'Montant contesté', status: 'EN_COURS', deadlineAt: new Date(Date.now() + 10 * 86_400_000).toISOString() },
      }),
    ]);
    renderWithProviders(<ExchangesPage />);

    await waitFor(() => expect(screen.getByText('c-1')).toBeInTheDocument());
    fireEvent.click(screen.getByText('c-1').closest('tr')!);

    await waitFor(() => expect(screen.getByText('Annexe 2 — Demande d’indemnisation')).toBeInTheDocument());
    expect(screen.getByText('Annexe 3 — Avis d’opposition motivé')).toBeInTheDocument();
    expect(screen.getByText('Montant contesté')).toBeInTheDocument();
  });

  it('filtre la liste par recherche libre (n° recours, dossier, compagnie)', async () => {
    mockExchangesApi(ME_WITH_EXCHANGE, [recoursItem({ id: 'r-1', claimId: 'c-1' }), recoursItem({ id: 'r-2', claimId: 'c-2', from: 'CASH', to: 'CAAR' })]);
    renderWithProviders(<ExchangesPage />);

    await waitFor(() => expect(screen.getByText('c-1')).toBeInTheDocument());
    expect(screen.getByText('c-2')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/rechercher/i), { target: { value: 'CAAR' } });

    await waitFor(() => expect(screen.getByText('c-2')).toBeInTheDocument());
    expect(screen.queryByText('c-1')).not.toBeInTheDocument();
  });

  /**
   * Sous-onglets REGLE "Accepté/silence" / "Réglé/compensé" (décision Product
   * Owner 2026-10-18) — distinction PUREMENT côté client, à partir du
   * croisement `settledAt` ↔ `GET /settlement/quarter/closures`, voir
   * commentaire `RegleSubTab` dans `page.tsx`.
   */
  describe('Sous-onglets REGLE "Accepté/silence" / "Réglé/compensé"', () => {
    const CLOSURES: SettlementQuarterClosure[] = [{ period: '2026-Q1', closedAt: '2026-04-02T08:00:00.000Z', closedBy: 'UAR' }];

    const REGLE_Q1_COMPENSATED = recoursItem({
      id: 'r-q1',
      claimId: 'c-q1-compense',
      state: 'REGLE',
      settledAt: '2026-02-15T10:00:00.000Z', // 2026-Q1 — clôturé
      timer: { timerType: 'AUCUN', remainingDays: 0, expired: false },
    });
    const REGLE_Q2_SILENCE = recoursItem({
      id: 'r-q2',
      claimId: 'c-q2-silence',
      state: 'REGLE',
      settledAt: '2026-05-20T10:00:00.000Z', // 2026-Q2 — pas encore clôturé
      timer: { timerType: 'AUCUN', remainingDays: 0, expired: false },
    });
    const REGLE_NO_SETTLED_AT = recoursItem({
      id: 'r-no-date',
      claimId: 'c-no-date',
      state: 'REGLE',
      settledAt: undefined,
      timer: { timerType: 'AUCUN', remainingDays: 0, expired: false },
    });
    const EN_ATTENTE_ITEM = recoursItem({ id: 'r-attente', claimId: 'c-attente', state: 'EN_ATTENTE' });

    it('affiche les sous-onglets avec les bons compteurs en entrant sur REGLE', async () => {
      mockExchangesApiWithClosures(ME_WITH_EXCHANGE, [REGLE_Q1_COMPENSATED, REGLE_Q2_SILENCE, REGLE_NO_SETTLED_AT, EN_ATTENTE_ITEM], CLOSURES);
      renderWithProviders(<ExchangesPage />);

      await waitFor(() => expect(screen.getByRole('tab', { name: /réglés/i })).toBeInTheDocument());
      fireEvent.click(screen.getByRole('tab', { name: /réglés/i }));

      // 2 en silence (Q2 pas clôturé + sans settledAt) / 1 compensé (Q1 clôturé).
      await waitFor(() => expect(screen.getByRole('tab', { name: /accepté\/silence/i })).toHaveTextContent('2'));
      expect(screen.getByRole('tab', { name: /réglé\/compensé/i })).toHaveTextContent('1');
    });

    it('le sous-onglet "Réglé/compensé" n’affiche que les recours dont le trimestre de règlement est clôturé', async () => {
      mockExchangesApiWithClosures(ME_WITH_EXCHANGE, [REGLE_Q1_COMPENSATED, REGLE_Q2_SILENCE, REGLE_NO_SETTLED_AT], CLOSURES);
      renderWithProviders(<ExchangesPage />);

      await waitFor(() => expect(screen.getByRole('tab', { name: /réglés/i })).toBeInTheDocument());
      fireEvent.click(screen.getByRole('tab', { name: /réglés/i }));

      await waitFor(() => expect(screen.getByRole('tab', { name: /réglé\/compensé/i })).toBeInTheDocument());
      fireEvent.click(screen.getByRole('tab', { name: /réglé\/compensé/i }));

      await waitFor(() => expect(screen.getByText('c-q1-compense')).toBeInTheDocument());
      expect(screen.queryByText('c-q2-silence')).not.toBeInTheDocument();
      expect(screen.queryByText('c-no-date')).not.toBeInTheDocument();
    });

    it('le sous-onglet "Accepté/silence" affiche le trimestre non clôturé ET le recours sans `settledAt` (défensif, pas de plantage)', async () => {
      mockExchangesApiWithClosures(ME_WITH_EXCHANGE, [REGLE_Q1_COMPENSATED, REGLE_Q2_SILENCE, REGLE_NO_SETTLED_AT], CLOSURES);
      renderWithProviders(<ExchangesPage />);

      await waitFor(() => expect(screen.getByRole('tab', { name: /réglés/i })).toBeInTheDocument());
      fireEvent.click(screen.getByRole('tab', { name: /réglés/i }));

      // "Accepté/silence" est le sous-onglet par défaut.
      await waitFor(() => expect(screen.getByText('c-q2-silence')).toBeInTheDocument());
      expect(screen.getByText('c-no-date')).toBeInTheDocument();
      expect(screen.queryByText('c-q1-compense')).not.toBeInTheDocument();
    });

    it("n'affiche aucun sous-onglet sur un autre onglet de premier niveau (régression) — pagination serveur existante inchangée", async () => {
      mockExchangesApiWithClosures(ME_WITH_EXCHANGE, [REGLE_Q1_COMPENSATED, REGLE_Q2_SILENCE, EN_ATTENTE_ITEM], CLOSURES);
      renderWithProviders(<ExchangesPage />);

      await waitFor(() => expect(screen.getByText('c-attente')).toBeInTheDocument());
      expect(screen.queryByRole('tab', { name: /accepté\/silence/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: /réglé\/compensé/i })).not.toBeInTheDocument();
    });
  });
});
