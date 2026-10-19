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
    divergence: false,
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
      const pageSize = Number(url.searchParams.get('pageSize') ?? '6');
      const start = (page - 1) * pageSize;
      return { page, total: items.length, items: items.slice(start, start + pageSize) };
    }
    return undefined;
  });
}

/**
 * Écran Confrontation & matching (/matching, écran 2) — pagination 6/p et
 * affichage conditionnel des actions Confirmer/Rejeter/Complément selon le
 * privilège `matchDecide` (B.7 : AUDITEUR_CSA toujours en lecture seule).
 */
describe('Écran Confrontation & matching (/matching)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pagine la file à 6 lignes/page (A.5) sur 9 éléments', async () => {
    const items = Array.from({ length: 9 }, (_, i) => queueItem(i + 1));
    mockQueueApi(ME_WITH_MATCH_DECIDE, items);

    renderWithProviders(<MatchingPage />);

    await waitFor(() => expect(screen.getByText('ECN-1')).toBeInTheDocument());
    expect(screen.getByText('ECN-6')).toBeInTheDocument();
    expect(screen.queryByText('ECN-7')).not.toBeInTheDocument();
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

  /**
   * B.5 : l'algorithme réel (`matching.scoring.ts` back) n'accorde jamais de
   * crédit partiel — un critère pondéré donne son poids plein ou zéro. Le
   * panneau doit refléter ça honnêtement (fraction poids/poids ou 0/poids),
   * jamais une valeur graduée fabriquée (ex. "21/35" de la capture de
   * référence, qui n'existe dans aucune donnée réelle).
   */
  it('affiche un critère pondéré vrai en fraction réelle 35/35 — jamais une valeur partielle', async () => {
    const vrai = queueItem(1, { criteria: { econstatPartage: false, plaquesCroisees: true, policeCroisee: true, dateHeure: true, compagniesCroisees: true, gps: true } });
    mockQueueApi(ME_WITH_MATCH_DECIDE, [vrai]);
    renderWithProviders(<MatchingPage />);

    await waitFor(() => expect(screen.getByText('ECN-1')).toBeInTheDocument());
    expect(screen.getByText('35/35')).toBeInTheDocument();
    expect(screen.queryByText(/21\/35|67\s?%/)).not.toBeInTheDocument();
  });

  it('affiche un critère pondéré faux en fraction réelle 0/35 — jamais une valeur partielle', async () => {
    const faux = queueItem(1, { criteria: { econstatPartage: false, plaquesCroisees: false, policeCroisee: true, dateHeure: true, compagniesCroisees: true, gps: true } });
    mockQueueApi(ME_WITH_MATCH_DECIDE, [faux]);
    renderWithProviders(<MatchingPage />);

    await waitFor(() => expect(screen.getByText('ECN-1')).toBeInTheDocument());
    expect(screen.getByText('0/35')).toBeInTheDocument();
  });

  /**
   * Section additive "Vue de confrontation" (2026-10-18) : badge Concordant/
   * Discordant calculé côté front à partir des VRAIES valeurs A/B (ici
   * `wilayaA`/`wilayaB`), jamais fabriqué — on vérifie les deux sens.
   */
  it('affiche "Concordant" quand les valeurs A/B de la confrontation correspondent réellement', async () => {
    const item = queueItem(1, { wilayaA: '16', wilayaB: '16', accidentDateA: '2026-10-10', accidentDateB: '2026-10-10' });
    mockQueueApi(ME_WITH_MATCH_DECIDE, [item]);
    renderWithProviders(<MatchingPage />);

    await waitFor(() => expect(screen.getByText('Wilaya')).toBeInTheDocument());
    const wilayaCard = screen.getByText('Wilaya').closest('div')?.parentElement as HTMLElement;
    expect(wilayaCard).toHaveTextContent('Concordant');
    expect(wilayaCard).not.toHaveTextContent('Discordant');
  });

  it('affiche "Discordant" quand les valeurs A/B de la confrontation diffèrent réellement', async () => {
    const item = queueItem(1, { wilayaA: '16', wilayaB: '31' });
    mockQueueApi(ME_WITH_MATCH_DECIDE, [item]);
    renderWithProviders(<MatchingPage />);

    await waitFor(() => expect(screen.getByText('Wilaya')).toBeInTheDocument());
    const wilayaCard = screen.getByText('Wilaya').closest('div')?.parentElement as HTMLElement;
    expect(wilayaCard).toHaveTextContent('Discordant');
    expect(wilayaCard).toHaveTextContent('16');
    expect(wilayaCard).toHaveTextContent('31');
  });

  /**
   * Cartes "Véhicule A/B" (2026-10-18) : UNIQUEMENT dossier/identité
   * assuré/immatriculation/canal — réellement capturés par le modèle 47
   * colonnes. Assertions négatives : pas de "Conducteur" (nom du conducteur
   * s'il diffère de l'assuré), pas de modèle de véhicule, pas de point de
   * choc/schéma — aucun de ces champs n'existe dans les données réelles.
   */
  it('affiche les 4 champs réels des cartes Véhicule A/B et rien de plus (pas de Conducteur/modèle/chocs)', async () => {
    const item = queueItem(1, {
      assureAIdentite: 'Meriem Belaid',
      assureBIdentite: 'Hanane Ghezali',
      canalDeclarationA: 'ECONSTAT',
      canalDeclarationB: 'ERP',
    });
    mockQueueApi(ME_WITH_MATCH_DECIDE, [item]);
    renderWithProviders(<MatchingPage />);

    await waitFor(() => expect(screen.getByText('Véhicule A')).toBeInTheDocument());
    expect(screen.getByText('Véhicule B')).toBeInTheDocument();
    expect(screen.getByText('Meriem Belaid')).toBeInTheDocument();
    expect(screen.getByText('Hanane Ghezali')).toBeInTheDocument();
    expect(screen.getByText('E-constat')).toBeInTheDocument();
    expect(screen.getByText('ERP')).toBeInTheDocument();
    expect(screen.getAllByText(item.refA).length).toBeGreaterThan(0);

    expect(screen.queryByText(/conducteur/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/chery|tiggo|seat leon|modèle de véhicule/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/choc/i)).not.toBeInTheDocument();
  });
});
