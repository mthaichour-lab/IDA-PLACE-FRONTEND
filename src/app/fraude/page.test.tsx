import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mockFetchRouter, renderWithProviders } from '@/test/render';
import { FraudCase, MeResponse, Paginated } from '@/lib/types';
import FraudePage from './page';

const ME: MeResponse = {
  user: { id: 'dev-op', name: 'Opérateur Place (dev)', email: 'operateur@finlab.dz' },
  role: 'OPERATEUR_PLACE',
  privileges: [],
};

function fraudCase(i: number, overrides: Partial<FraudCase> = {}): FraudCase {
  return {
    id: `fc-${i}`,
    type: 'DOUBLON',
    score: 80,
    severity: 'MOYENNE',
    claimIds: [`c-${i}`],
    companiesInvolved: ['CAAT', 'SAA'],
    details: { ecart: 12 },
    detectedAt: new Date().toISOString(),
    ...overrides,
  };
}

function mockFraudeApi(cases: FraudCase[]) {
  mockFetchRouter((pathname, url) => {
    if (pathname === '/api/v1/me') return ME;
    if (pathname === '/api/v1/fraud/cases') {
      const pageSize = Number(url.searchParams.get('pageSize') ?? '7');
      const page = Number(url.searchParams.get('page') ?? '1');
      if (pageSize >= 10_000) return { page: 1, total: cases.length, items: cases } as Paginated<FraudCase>;
      const start = (page - 1) * pageSize;
      return { page, total: cases.length, items: cases.slice(start, start + pageSize) } as Paginated<FraudCase>;
    }
    if (pathname === '/api/v1/fraud/actions') return { page: 1, total: 0, items: [] };
    return undefined;
  });
}

/**
 * Écran Anti-fraude (/fraude, écran 9, Module G §6.9) — tri d'affichage par
 * gravité (ÉLEVÉE avant MOYENNE avant FAIBLE), ouverture du détail au clic.
 */
describe('Écran Anti-fraude (/fraude)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('affiche la file des cas détectés, triée par gravité décroissante', async () => {
    mockFraudeApi([fraudCase(1, { severity: 'FAIBLE' }), fraudCase(2, { severity: 'ELEVEE' }), fraudCase(3, { severity: 'MOYENNE' })]);

    renderWithProviders(<FraudePage />);

    await waitFor(() => expect(screen.getByText('fc-1')).toBeInTheDocument());
    const rows = screen.getAllByRole('row').slice(1); // sans l'en-tête
    expect(rows[0]).toHaveTextContent('fc-2'); // ÉLEVÉE en premier
    expect(rows[1]).toHaveTextContent('fc-3'); // MOYENNE
    expect(rows[2]).toHaveTextContent('fc-1'); // FAIBLE en dernier
  });

  it('ouvre le panneau de détail (compagnies, dossiers liés) au clic sur un cas', async () => {
    mockFraudeApi([fraudCase(1, { companiesInvolved: ['CAAT', 'SAA'], claimIds: ['c-1', 'c-2'] })]);

    renderWithProviders(<FraudePage />);

    await waitFor(() => expect(screen.getByText('fc-1')).toBeInTheDocument());
    const row = screen.getByText('fc-1').closest('tr');
    if (row) fireEvent.click(row);

    await waitFor(() => expect(screen.getByText('c-1, c-2')).toBeInTheDocument());
  });
});
