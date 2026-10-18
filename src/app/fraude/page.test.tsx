import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mockFetchRouter, renderWithProviders } from '@/test/render';
import { FraudAction, FraudCase, FraudSignalGroupResult, MeResponse, Paginated } from '@/lib/types';
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
    plateA: `0000${i}-000-00`,
    ...overrides,
  };
}

function fraudAction(i: number, overrides: Partial<FraudAction> = {}): FraudAction {
  return {
    id: `fa-${i}`,
    type: 'TRANSMISSION_TARDIVE',
    actor: 'CASH',
    claimId: `c-ref-${i}`,
    at: new Date().toISOString(),
    ...overrides,
  };
}

function mockFraudeApi(cases: FraudCase[], actions: FraudAction[] = [], signalsByCompany: Record<string, FraudSignalGroupResult[]> = {}) {
  mockFetchRouter((pathname, url) => {
    if (pathname === '/api/v1/me') return ME;
    if (pathname === '/api/v1/fraud/cases') {
      const pageSize = Number(url.searchParams.get('pageSize') ?? '7');
      const page = Number(url.searchParams.get('page') ?? '1');
      if (pageSize >= 10_000) return { page: 1, total: cases.length, items: cases } as Paginated<FraudCase>;
      const start = (page - 1) * pageSize;
      return { page, total: cases.length, items: cases.slice(start, start + pageSize) } as Paginated<FraudCase>;
    }
    if (pathname === '/api/v1/fraud/actions') return { page: 1, total: actions.length, items: actions } as Paginated<FraudAction>;
    const signalsMatch = /^\/api\/v1\/fraud\/adherents\/(.+)\/signals$/.exec(pathname);
    if (signalsMatch) return signalsByCompany[decodeURIComponent(signalsMatch[1])] ?? [];
    return undefined;
  });
}

/**
 * Écran Anti-fraude (/fraude, écran 9, Module G §6.9) — tri d'affichage par
 * gravité (ÉLEVÉE avant MOYENNE avant FAIBLE), panneau de détail docké
 * (grouping des signaux par adhérent, `GET /fraud/adherents/:company/signals`,
 * additif 2026-10-18) ouvert au clic sur un cas.
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

  it('affiche la colonne "Plaque" (plateA, jointure back sur le premier dossier lié)', async () => {
    mockFraudeApi([fraudCase(1, { plateA: '05875-309-31' })]);

    renderWithProviders(<FraudePage />);

    await waitFor(() => expect(screen.getByText('fc-1')).toBeInTheDocument());
    expect(screen.getByText('Plaque')).toBeInTheDocument();
    expect(screen.getByText('05875-309-31')).toBeInTheDocument();
  });

  it('rend "—" pour la plaque quand `plateA` est absent (aucun dossier lié n\'en a une)', async () => {
    mockFraudeApi([fraudCase(1, { plateA: undefined })]);

    renderWithProviders(<FraudePage />);

    await waitFor(() => expect(screen.getByText('fc-1')).toBeInTheDocument());
    const row = screen.getByText('fc-1').closest('tr')!;
    expect(within(row).getByText('—')).toBeInTheDocument();
  });

  it('ouvre le panneau de détail docké et affiche les sections de signaux groupés au clic sur un cas', async () => {
    const signals: FraudSignalGroupResult[] = [
      {
        group: 'MONTANTS_PLAFOND',
        count: 1,
        maxScore: 70,
        cases: [fraudCase(10, { type: 'MONTANT_CALIBRE', details: { company: 'CAAT', count: 4, bandMin: 248_130, bandMax: 275_700 }, score: 70 })],
      },
      {
        group: 'DOUBLONS_ECONSTAT',
        count: 3,
        maxScore: 66,
        cases: [
          fraudCase(11, { type: 'ECONSTAT_REUTILISE', details: { numEconstat: 'EC-1', count: 3, datesDistinctes: 2, wilayasDistinctes: 1 }, score: 66 }),
          fraudCase(12, { type: 'DOUBLON', score: 60 }),
          fraudCase(13, { type: 'DOUBLON', score: 55 }),
        ],
      },
    ];

    mockFraudeApi([fraudCase(1, { companiesInvolved: ['CAAT', 'SAA'], plateA: '05875-309-31' })], [], { CAAT: signals });

    renderWithProviders(<FraudePage />);

    await waitFor(() => expect(screen.getByText('fc-1')).toBeInTheDocument());
    const row = screen.getByText('fc-1').closest('tr');
    if (row) fireEvent.click(row);

    // Panneau docké à côté du tableau (pas une modale) : titre "Cas fc-1".
    await waitFor(() => expect(screen.getByText('Cas fc-1')).toBeInTheDocument());

    // Attend la résolution de `GET /fraud/adherents/CAAT/signals` (panneau en
    // "Chargement…" jusque-là) avant d'inspecter les sections.
    await waitFor(() => expect(screen.getByText('Montants & plafond')).toBeInTheDocument());

    // Groupe "Montants & plafond" : 1 seul cas sous-jacent -> pas de badge "+N".
    const montantsSection = screen.getByText('Montants & plafond').closest('div')!;
    expect(within(montantsSection).queryByText(/^\+\d+$/)).not.toBeInTheDocument();
    expect(screen.getByText(/Montant calibré juste sous le plafond IDA/)).toBeInTheDocument();

    // Groupe "Doublons & e-constat" : 3 cas sous-jacents -> badge "+2".
    const doublonsSection = screen.getByText('Doublons & e-constat').closest('div')!;
    expect(within(doublonsSection).getByText('+2')).toBeInTheDocument();
    expect(screen.getByText(/N° e-constat EC-1 réutilisé/)).toBeInTheDocument();

    // Lien vers l'appariement (idiome repris de /monitoring).
    expect(screen.getByRole('link', { name: "Ouvrir l'appariement" })).toHaveAttribute('href', '/matching');
  });

  it('affiche la colonne "Réf." du journal des actions suspectes (claimId, sinon matchId, sinon id)', async () => {
    mockFraudeApi([], [fraudAction(1, { claimId: 'c-ref-1', actor: 'CASH' }), fraudAction(2, { claimId: undefined, matchId: 'm-99', actor: 'CAAT' })]);

    renderWithProviders(<FraudePage />);

    await waitFor(() => expect(screen.getByText('Réf.')).toBeInTheDocument());
    expect(screen.getByText('c-ref-1')).toBeInTheDocument();
    expect(screen.getByText('m-99')).toBeInTheDocument();
  });
});
