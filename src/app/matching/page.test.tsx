import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mockFetchRouter, renderWithProviders } from '@/test/render';
import { MatchQueueItem, MeResponse } from '@/lib/types';
import MatchingPage from './page';

function queueItem(i: number, overrides: Partial<MatchQueueItem> = {}): MatchQueueItem {
  return {
    id: `m-${i}`,
    refA: `ECN-${i}`,
    companyA: 'CAAT',
    plateA: `1600${i}`,
    refB: `ECN-${i}`,
    companyB: 'SAA',
    plateB: `3100${i}`,
    score: 100,
    level: 'AUTO',
    status: 'AUTO_CONFIRME',
    econstatShared: true,
    criteria: { econstatPartage: true, plaquesCroisees: true, policeCroisee: true, dateHeure: true, compagniesCroisees: true, gps: true },
    at: new Date().toISOString(),
    ...overrides,
  };
}

const COUNTERS = { TOUS: 9, AUTO: 9, A_CONFIRMER: 0, NON_APPARIES: 0 };
const THRESHOLDS = { autoThreshold: 80, confirmThreshold: 50 };

const ME_WITH_MATCH_DECIDE: MeResponse = {
  user: { id: 'dev-op', name: 'Opérateur Place (dev)', email: 'operateur@finlab.dz' },
  role: 'OPERATEUR_PLACE',
  privileges: ['matchDecide'],
};

const ME_WITHOUT_MATCH_DECIDE: MeResponse = {
  user: { id: 'dev-auditeur', name: 'Auditeur CSA (dev)', email: 'auditeur@csa.dz' },
  role: 'AUDITEUR_CSA',
  privileges: [],
};

function mockQueueApi(me: MeResponse, items: MatchQueueItem[]) {
  mockFetchRouter((pathname, url) => {
    if (pathname === '/api/v1/me') return me;
    if (pathname === '/api/v1/matching/queue/counters') return COUNTERS;
    if (pathname === '/api/v1/matching/thresholds') return THRESHOLDS;
    if (pathname === '/api/v1/matching/queue') {
      const page = Number(url.searchParams.get('page') ?? '1');
      const pageSize = Number(url.searchParams.get('pageSize') ?? '7');
      const start = (page - 1) * pageSize;
      return { page, total: items.length, items: items.slice(start, start + pageSize) };
    }
    return undefined;
  });
}

/**
 * Écran Confrontation & matching (/matching, écran 2) — pagination 7/p et
 * affichage conditionnel des actions Confirmer/Rejeter/Complément selon le
 * privilège `matchDecide` (B.7 : AUDITEUR_CSA toujours en lecture seule).
 */
describe('Écran Confrontation & matching (/matching)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pagine la file à 7 lignes/page (A.5) sur 9 éléments', async () => {
    const items = Array.from({ length: 9 }, (_, i) => queueItem(i + 1));
    mockQueueApi(ME_WITH_MATCH_DECIDE, items);

    renderWithProviders(<MatchingPage />);

    await waitFor(() => expect(screen.getByText('ECN-1')).toBeInTheDocument());
    expect(screen.getByText('ECN-7')).toBeInTheDocument();
    expect(screen.queryByText('ECN-8')).not.toBeInTheDocument();
  });

  it('active Confirmer/Rejeter/Complément pour un utilisateur avec le privilège matchDecide', async () => {
    mockQueueApi(ME_WITH_MATCH_DECIDE, [queueItem(1)]);
    renderWithProviders(<MatchingPage />);

    await waitFor(() => expect(screen.getByText('ECN-1')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /^Confirmer/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^Rejeter/ })).toBeEnabled();
    expect(screen.queryByText(/n'avez pas le privilège requis/i)).not.toBeInTheDocument();
  });

  it("désactive (grise) les actions de décision pour AUDITEUR_CSA, lecture seule (B.7)", async () => {
    mockQueueApi(ME_WITHOUT_MATCH_DECIDE, [queueItem(1)]);
    renderWithProviders(<MatchingPage />);

    await waitFor(() => expect(screen.getByText('ECN-1')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /^Confirmer/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Rejeter/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Complément/ })).toBeDisabled();
    expect(screen.getByText(/n'avez pas le privilège requis/i)).toBeInTheDocument();
  });

  it('affiche les onglets avec compteurs (role=tablist/tab, A.5 accessibilité)', async () => {
    mockQueueApi(ME_WITH_MATCH_DECIDE, [queueItem(1)]);
    renderWithProviders(<MatchingPage />);

    await waitFor(() => expect(screen.getByRole('tab', { name: /tous/i })).toHaveTextContent('9'));
  });
});
