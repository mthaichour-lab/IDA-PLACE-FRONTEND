import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mockFetchJson, renderWithProviders } from '@/test/render';
import { LedgerEntry, LedgerVerifyResult, MeResponse } from '@/lib/types';
import LedgerPage from './page';

const ME: MeResponse = {
  user: { id: 'dev-auditeur', name: 'Auditeur CSA (dev)', email: 'auditeur@csa.dz' },
  role: 'AUDITEUR_CSA',
  privileges: [],
};

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: 'le-1',
    type: 'RECOURS_TRANSITION',
    ref: 'r-1',
    actor: 'dev-op',
    summary: 'Transition recours',
    at: new Date().toISOString(),
    hash: '11112222333344445555666677778888',
    prevHash: null,
    ...overrides,
  };
}

function fetchCallCount(): number {
  return (global.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
}

/**
 * La ligne de titre d'une carte ("#seq Type · réf") mélange texte brut et
 * `<span className="mono">` (A.3) : son texte complet n'est donc PAS une
 * correspondance par défaut de `getByText` (qui, par défaut, ne concatène
 * que les nœuds texte DIRECTS d'un élément, pas ceux des enfants imbriqués
 * — voir la doc Testing Library sur le découpage du texte). On compare donc
 * `element.textContent` explicitement via un matcher fonction.
 */
function fullText(text: string) {
  return (_content: string, element: Element | null) => element?.textContent === text;
}

/**
 * Écran Journal scellé (/ledger, écran 13, Module XI) — chaînage SHA-256
 * append-only, liste en cartes (icône + titre "#seq Type · réf" + résumé —
 * auteur + horodatage/empreintes), filtrable par type et par recherche
 * libre, vérification d'intégrité déclenchable manuellement depuis
 * l'en-tête, export CSV côté front (placeholder documenté, aucun endpoint
 * d'export côté API).
 */
describe('Écran Journal scellé (/ledger)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('affiche une entrée sous forme de carte : titre #séquence/type/référence, description résumé — auteur, empreintes', async () => {
    mockFetchJson({ '/api/v1/me': ME, '/api/v1/ledger': [entry()], '/api/v1/ledger/verify': { valid: true } as LedgerVerifyResult });

    renderWithProviders(<LedgerPage />);

    await waitFor(() => expect(screen.getByText(fullText('#1 Recours Transition · r-1'))).toBeInTheDocument());
    expect(screen.getByText('Transition recours — dev-op')).toBeInTheDocument();
    expect(screen.getByText('11112222…77778888 ← —')).toBeInTheDocument();
  });

  it('numérote les entrées en séquence décroissante (la plus récente en tête, #total en premier)', async () => {
    mockFetchJson({
      '/api/v1/me': ME,
      // L'API renvoie la liste triée seq ASC (la plus ancienne en premier) —
      // voir ledger.service.ts back ; l'écran doit l'afficher la plus
      // récente en tête, numérotée depuis le total (#3, #2, #1).
      '/api/v1/ledger': [
        entry({ id: 'le-1', ref: 'r-1' }),
        entry({ id: 'le-2', ref: 'r-2' }),
        entry({ id: 'le-3', ref: 'r-3' }),
      ],
      '/api/v1/ledger/verify': { valid: true } as LedgerVerifyResult,
    });

    renderWithProviders(<LedgerPage />);

    await waitFor(() => expect(screen.getByText(fullText('#3 Recours Transition · r-3'))).toBeInTheDocument());
    const titles = screen
      .getAllByText((_content, element) => !!element && /^#\d+ Recours Transition · r-\d+$/.test(element.textContent ?? ''))
      .map((el) => el.textContent);
    expect(titles).toEqual(['#3 Recours Transition · r-3', '#2 Recours Transition · r-2', '#1 Recours Transition · r-1']);
  });

  it("affiche l'état d'intégrité du chaînage (chaîne intègre)", async () => {
    mockFetchJson({ '/api/v1/me': ME, '/api/v1/ledger': [entry()], '/api/v1/ledger/verify': { valid: true } as LedgerVerifyResult });

    renderWithProviders(<LedgerPage />);

    await waitFor(() => expect(screen.getByText('Chaîne intègre')).toBeInTheDocument());
  });

  it("signale une chaîne rompue avec sa référence quand l'API le rapporte", async () => {
    mockFetchJson({ '/api/v1/me': ME, '/api/v1/ledger': [entry()], '/api/v1/ledger/verify': { valid: false, brokenAt: 'le-7' } as LedgerVerifyResult });

    renderWithProviders(<LedgerPage />);

    await waitFor(() => expect(screen.getByText(/Chaîne rompue \(le-7\)/)).toBeInTheDocument());
  });

  it("le bouton « Vérifier l'intégrité » redéclenche immédiatement une vérification (en plus du polling)", async () => {
    mockFetchJson({ '/api/v1/me': ME, '/api/v1/ledger': [entry()], '/api/v1/ledger/verify': { valid: true } as LedgerVerifyResult });

    renderWithProviders(<LedgerPage />);

    await waitFor(() => expect(screen.getByText('Chaîne intègre')).toBeInTheDocument());
    const callsBefore = fetchCallCount();

    fireEvent.click(screen.getByRole('button', { name: 'Vérifier l’intégrité' }));

    await waitFor(() => expect(fetchCallCount()).toBeGreaterThan(callsBefore));
  });

  it('« Page du journal » est désactivé (aucune page dédiée côté API) plutôt qu’une fausse destination', async () => {
    mockFetchJson({ '/api/v1/me': ME, '/api/v1/ledger': [entry()], '/api/v1/ledger/verify': { valid: true } as LedgerVerifyResult });

    renderWithProviders(<LedgerPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Page du journal' })).toBeDisabled());
  });

  it('désactive l’export quand le journal est vide', async () => {
    mockFetchJson({ '/api/v1/me': ME, '/api/v1/ledger': [], '/api/v1/ledger/verify': { valid: true } as LedgerVerifyResult });

    renderWithProviders(<LedgerPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Exporter le journal' })).toBeDisabled());
  });

  it('le filtre par type affiche le bon décompte et restreint la liste', async () => {
    mockFetchJson({
      '/api/v1/me': ME,
      '/api/v1/ledger': [
        entry({ id: 'le-1', type: 'INGESTION', ref: 'i-1' }),
        entry({ id: 'le-2', type: 'INGESTION', ref: 'i-2' }),
        entry({ id: 'le-3', type: 'MATCHING', ref: 'm-1' }),
      ],
      '/api/v1/ledger/verify': { valid: true } as LedgerVerifyResult,
    });

    renderWithProviders(<LedgerPage />);

    await waitFor(() => expect(screen.getByText('Tous les types (3)')).toBeInTheDocument());
    expect(screen.getByText('Ingestion (2)')).toBeInTheDocument();
    expect(screen.getByText('Matching (1)')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Tous les types'), { target: { value: 'MATCHING' } });

    await waitFor(() => expect(screen.queryByText(/i-1/)).not.toBeInTheDocument());
    expect(screen.getByText(/m-1/)).toBeInTheDocument();
  });

  it('la recherche libre filtre par référence, acteur ou empreinte', async () => {
    mockFetchJson({
      '/api/v1/me': ME,
      '/api/v1/ledger': [
        entry({ id: 'le-1', ref: 'r-1', actor: 'operateur-caat', hash: 'aaaa1111bbbb2222cccc3333dddd4444' }),
        entry({ id: 'le-2', ref: 'r-2', actor: 'operateur-saa', hash: 'eeee5555ffff6666aaaa7777bbbb8888' }),
      ],
      '/api/v1/ledger/verify': { valid: true } as LedgerVerifyResult,
    });

    renderWithProviders(<LedgerPage />);

    await waitFor(() => expect(screen.getByText(/r-1/)).toBeInTheDocument());
    expect(screen.getByText(/r-2/)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Référence, acteur, empreinte…'), { target: { value: 'saa' } });

    await waitFor(() => expect(screen.queryByText(/r-1/)).not.toBeInTheDocument());
    expect(screen.getByText(/r-2/)).toBeInTheDocument();
  });

  it('conserve la pagination fixe à 6 entrées par page', async () => {
    const entries = Array.from({ length: 7 }, (_, i) => entry({ id: `le-${i + 1}`, ref: `r-${i + 1}` }));
    mockFetchJson({ '/api/v1/me': ME, '/api/v1/ledger': entries, '/api/v1/ledger/verify': { valid: true } as LedgerVerifyResult });

    renderWithProviders(<LedgerPage />);

    // Liste triée seq ASC côté API → affichage le plus récent en tête : la
    // page 1 montre #7 à #2, la 7ᵉ entrée (#1, la plus ancienne) est reléguée
    // en page 2.
    await waitFor(() => expect(screen.getByText('Page 1 sur 2 · 7')).toBeInTheDocument());
    expect(screen.getByText(fullText('#7 Recours Transition · r-7'))).toBeInTheDocument();
    expect(screen.queryByText(fullText('#1 Recours Transition · r-1'))).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Suivant' }));

    await waitFor(() => expect(screen.getByText(fullText('#1 Recours Transition · r-1'))).toBeInTheDocument());
    expect(screen.getByText('Page 2 sur 2 · 7')).toBeInTheDocument();
    expect(screen.queryByText(fullText('#7 Recours Transition · r-7'))).not.toBeInTheDocument();
  });
});
