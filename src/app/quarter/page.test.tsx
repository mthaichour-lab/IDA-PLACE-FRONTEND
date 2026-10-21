import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { mockFetchRequests, mockFetchRouter, renderWithProviders } from '@/test/render';
import { MeResponse, PipelineStepView, PriceGrid, QuarterlyPipeline, SettlementQuarter, SettlementQuarterMatrix, SettlementQuarterSummary } from '@/lib/types';
import QuarterPage from './page';

const ME: MeResponse = {
  user: { id: 'dev-op', name: 'Opérateur Place (dev)', email: 'operateur@finlab.dz' },
  role: 'OPERATEUR_PLACE',
  privileges: [],
};

const QUARTER: SettlementQuarter = {
  quarter: '2026-Q4',
  bordereau: 'BORD-2026-Q4',
  // Convention du back : `from` = créancier (Recours.from). CAAT a 300 k de créances sur SAA et 50 k de dettes envers elle : créancier net de 250 k.
  positions: [{ from: 'CAAT', to: 'SAA', amount: 250_000 }],
  net: [
    { code: 'CAAT', net: 250_000 },
    { code: 'SAA', net: -250_000 },
  ],
  closedAt: undefined,
};

const SUMMARY: SettlementQuarterSummary = {
  quarter: '2026-Q4',
  grossTotal: 400_000,
  bilateralNetTotal: 250_000,
  multilateralNetTotal: 250_000,
  reductionPct: 37.5,
  settledCount: 3,
  opposedCount: 1,
};

const MATRIX: SettlementQuarterMatrix = {
  quarter: '2026-Q4',
  companies: ['CAAT', 'SAA'],
  cells: [
    { from: 'CAAT', to: 'SAA', amount: 300_000 },
    { from: 'SAA', to: 'CAAT', amount: 50_000 },
  ],
};

const GRID: PriceGrid = {
  version: 'TARIF-2026.01',
  effectiveFrom: '2026-01-01',
  subscription: { label: 'Standard', monthly: 50_000 },
  metrics: [{ metric: 'claims', label: 'Dossiers', unit: 'dossier', includedQuota: 100, unitPrice: 50 }],
};

const STEP_INFO: Array<Pick<PipelineStepView, 'step' | 'label' | 'article' | 'dueDate'>> = [
  { step: 'SAISIE', label: 'Saisie et validation des recours sur la plateforme', article: 'Art. 16', dueDate: '2027-01-08' },
  { step: 'SYNTHESE_ANNEXE_7', label: 'Synthèse mensuelle automatisée (Annexe n°7)', article: 'Art. 16', dueDate: '2027-01-10' },
  { step: 'TRANSMISSION_ANNEXE_8', label: 'Insertion des informations de règlement (Annexe n°8)', article: 'Art. 16-17', dueDate: '2027-01-31' },
  { step: 'SYNTHESE_GLOBALE_REUNION', label: "Synthèse globale trimestrielle et réunion au siège de l'UAR", article: 'Art. 17-18', dueDate: '2027-01-31' },
  { step: 'PV_REGLEMENT', label: 'Signature du PV trimestriel (Annexe n°9) et règlement sous 8 jours', article: 'Art. 18', dueDate: '2027-02-08' },
];

/** Pipeline dont les `doneCount` premières étapes sont faites ; `overdue` s'applique à l'étape EN_COURS. */
function pipeline(doneCount: number, overdue = false): QuarterlyPipeline {
  return {
    quarter: '2026-Q4',
    steps: STEP_INFO.map((s, i) => ({
      ...s,
      status: i < doneCount ? 'DONE' : i === doneCount ? 'EN_COURS' : 'A_VENIR',
      overdue: i === doneCount && overdue,
      ...(i < doneCount ? { completedAt: '2027-01-05T09:00:00.000Z', completedBy: 'Opérateur Place (dev)' } : {}),
    })),
  };
}

function mockQuarterApi() {
  mockFetchRouter((pathname) => {
    if (pathname === '/api/v1/me') return ME;
    if (pathname === '/api/v1/settlement/quarter/2026-Q4/pipeline') return pipeline(0);
    if (pathname === '/api/v1/settlement/quarter/2026-Q4/summary') return SUMMARY;
    if (pathname === '/api/v1/settlement/quarter/2026-Q4/matrix') return MATRIX;
    if (pathname === '/api/v1/settlement/quarter/2026-Q4') return QUARTER;
    if (pathname === '/api/v1/pricing/grid') return GRID;
    return undefined;
  });
}

/** Même jeu que `QUARTER` mais sans aucune position/position nette — pour vérifier l'état vide honnête du diagramme de flux (jamais un diagramme fabriqué). */
function mockQuarterApiEmptyFlows() {
  mockFetchRouter((pathname) => {
    if (pathname === '/api/v1/me') return ME;
    if (pathname === '/api/v1/settlement/quarter/2026-Q4/pipeline') return pipeline(0);
    if (pathname === '/api/v1/settlement/quarter/2026-Q4/summary') return SUMMARY;
    if (pathname === '/api/v1/settlement/quarter/2026-Q4/matrix') return MATRIX;
    if (pathname === '/api/v1/settlement/quarter/2026-Q4') return { ...QUARTER, positions: [], net: [] };
    if (pathname === '/api/v1/pricing/grid') return GRID;
    return undefined;
  });
}

/**
 * Écran Compensation trimestrielle (/quarter, écran 6, Module D §6.6) — KPI
 * de synthèse (brut/net bilatéral/net multilatéral/réduction/recours
 * compensés/en opposition), positions nettes multilatérales par compagnie,
 * matrice des positions BRUTES (créancier × débiteur, avant tout netting),
 * bordereau de référence.
 */
describe('Écran Compensation trimestrielle (/quarter)', () => {
  /**
   * Le trimestre affiché par défaut est le lot EN COURS DE RÈGLEMENT (le
   * trimestre qui précède le trimestre courant, même règle que le Cockpit) :
   * l'horloge est figée au 20 janvier 2027 pour que ce lot soit 2026-Q4,
   * celui des jeux de données ci-dessus. Seul `Date` est simulé (les
   * minuteries de `waitFor` restent réelles).
   */
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2027-01-20T10:00:00Z') });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('sélectionne par défaut le lot en cours de règlement (trimestre précédent), sélecteur conservé', async () => {
    mockQuarterApi();
    renderWithProviders(<QuarterPage />);

    await waitFor(() => expect(screen.getByRole('tab', { name: '2026 Q4' })).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByRole('tab', { name: '2027 Q1' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: '2026 Q2' })).toBeInTheDocument();
  });

  it('affiche les KPI de synthèse (brut, net bilatéral, net multilatéral, réduction, recours)', async () => {
    mockQuarterApi();
    renderWithProviders(<QuarterPage />);

    // Montants compacts de la maquette (« 400 k DA »), valeur exacte en infobulle.
    await waitFor(() => expect(screen.getAllByText(/^400\s?k$/).length).toBeGreaterThan(0));
    expect(screen.getByTitle(/400\s?000 DA/)).toBeInTheDocument();
    expect(screen.getByText('37,5 %')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('affiche la position nette par compagnie, dans le bon sens (à recevoir / à payer)', async () => {
    mockQuarterApi();
    renderWithProviders(<QuarterPage />);

    await waitFor(() => expect(screen.getAllByText(/250\s?000/).length).toBeGreaterThan(0));
    expect(screen.getAllByText('À recevoir').length).toBeGreaterThan(0);
    expect(screen.getAllByText('À payer').length).toBeGreaterThan(0);
  });

  it('affiche la matrice des positions brutes (créancier × débiteur), distincte des positions nettes', async () => {
    mockQuarterApi();
    renderWithProviders(<QuarterPage />);

    await waitFor(() => expect(screen.getByRole('table', { name: /positions brutes/i })).toBeInTheDocument());
    const matrix = within(screen.getByRole('table', { name: /positions brutes/i }));
    // Cellule CAAT→SAA (et son total de ligne) : 300 k ; cellule SAA→CAAT : 50 k ; montant exact en infobulle.
    expect(matrix.getAllByText('300 k').length).toBeGreaterThan(0);
    expect(matrix.getAllByText('50 k').length).toBeGreaterThan(0);
    expect(matrix.getAllByTitle(/^300\s?000 DA$/).length).toBeGreaterThan(0);
  });

  it('affiche la référence du bordereau trimestriel', async () => {
    mockQuarterApi();
    renderWithProviders(<QuarterPage />);

    await waitFor(() => expect(screen.getByText('BORD-2026-Q4')).toBeInTheDocument());
  });

  /**
   * Carte condensée "Trimestre en compensation" (additive, fidélité à la
   * capture écran 6) — étape en cours + échéance réelle de la réunion
   * (`/settlement/quarter/:q/pipeline`, Art. 17-18), jamais une convocation
   * ou un ordre du jour fabriqués (aucune entité de planification côté API).
   */
  it('affiche la carte « Trimestre … — en compensation » : statut, étape en cours et échéance de la réunion (données réelles)', async () => {
    mockQuarterApi();
    renderWithProviders(<QuarterPage />);

    await waitFor(() => expect(screen.getByText('Trimestre 2026 Q4 — en compensation')).toBeInTheDocument());
    expect(screen.getByText('En compensation')).toBeInTheDocument();
    expect(screen.getAllByText('Saisie et validation des recours sur la plateforme').length).toBeGreaterThan(0);
    expect(screen.getAllByText("Synthèse globale trimestrielle et réunion au siège de l'UAR").length).toBeGreaterThan(0);
    // Gap documenté (aucune entité de planification côté API) : ni convocation ni ordre du jour fabriqués.
    expect(screen.queryByText(/Convocation|Ordre du jour/)).not.toBeInTheDocument();
  });

  it('affiche la légende de la carte thermique des positions brutes', async () => {
    mockQuarterApi();
    renderWithProviders(<QuarterPage />);

    await waitFor(() => expect(screen.getByText(/0 → 300\s?000 DA \(échelle racine\)/)).toBeInTheDocument());
  });

  it('propose un export Excel (CSV) des positions nettes multilatérales', async () => {
    mockQuarterApi();
    renderWithProviders(<QuarterPage />);

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Excel' }).length).toBeGreaterThan(0));
  });

  /**
   * Section additive "Flux de règlement entre les N compagnies" (2026-10-18,
   * sous la matrice des positions brutes) — titre dynamique (nombre réel de
   * compagnies de `rawMatrix.companies`, jamais un "5" en dur), bascule
   * Net multilatéral (par défaut, hub-and-spoke) / Bilatéral (pair à pair,
   * une flèche RÉELLE par entrée `data.positions`).
   */
  describe('Flux de règlement entre les compagnies (diagramme additif)', () => {
    it('affiche le titre avec le nombre réel de compagnies (pas une valeur en dur)', async () => {
      mockQuarterApi();
      renderWithProviders(<QuarterPage />);

      await waitFor(() => expect(screen.getByText(/Flux de règlement entre les 2 compagnies/)).toBeInTheDocument());
    });

    it('affiche par défaut le mode "Net multilatéral" : le hub (la place) + un nœud par entrée de `net`', async () => {
      mockQuarterApi();
      renderWithProviders(<QuarterPage />);

      await waitFor(() => expect(screen.getByTestId('flow-hub')).toBeInTheDocument());
      expect(screen.getByTestId('flow-node-CAAT')).toBeInTheDocument();
      expect(screen.getByTestId('flow-node-SAA')).toBeInTheDocument();
      // Mode bilatéral pas encore affiché : aucune flèche pair-à-pair.
      expect(screen.queryByTestId('flow-edge-CAAT-SAA')).not.toBeInTheDocument();
    });

    it('bascule vers "Bilatéral" : affiche une flèche réelle par entrée de `data.positions`, sans hub', async () => {
      mockQuarterApi();
      renderWithProviders(<QuarterPage />);

      await waitFor(() => expect(screen.getByTestId('flow-hub')).toBeInTheDocument());
      fireEvent.click(screen.getByRole('tab', { name: 'Bilatéral' }));

      await waitFor(() => expect(screen.getByTestId('flow-edge-CAAT-SAA')).toBeInTheDocument());
      // La flèche suit le règlement : le débiteur net (SAA) paie le créancier net (CAAT).
      expect(screen.getByTestId('flow-edge-CAAT-SAA')).toHaveAttribute('data-payer', 'SAA');
      expect(screen.getByTestId('flow-edge-CAAT-SAA')).toHaveAttribute('data-payee', 'CAAT');
      // Une seule entrée dans `QUARTER.positions` → une seule flèche, pas de fabrication d'un ordre pair-à-pair pour le hub.
      expect(screen.queryAllByTestId(/^flow-edge-/).length).toBe(QUARTER.positions.length);
      expect(screen.queryByTestId('flow-hub')).not.toBeInTheDocument();
    });

    it("affiche l'état vide honnête (pas de diagramme fabriqué) quand `net`/`positions` sont vides", async () => {
      mockQuarterApiEmptyFlows();
      renderWithProviders(<QuarterPage />);

      await waitFor(() => expect(screen.getByText('BORD-2026-Q4')).toBeInTheDocument());
      expect(screen.queryByTestId('flow-hub')).not.toBeInTheDocument();
      expect(screen.getAllByText('Aucune donnée.').length).toBeGreaterThan(0);

      fireEvent.click(screen.getByRole('tab', { name: 'Bilatéral' }));
      await waitFor(() => expect(screen.queryByTestId(/^flow-edge-/)).not.toBeInTheDocument());
      expect(screen.getAllByText('Aucune donnée.').length).toBeGreaterThan(0);
    });
  });

  /**
   * Section « Avancement du lot » (Diagramme 2, Art. 16-18) — étapes 1-4
   * réalisées à la main dans l'ordre (privilège `closeQuarter`), étape 5
   * dérivée de la clôture trimestrielle.
   */
  describe('Avancement du lot', () => {
    const ME_CLOSE: MeResponse = { ...ME, privileges: ['closeQuarter'] };

    function mockPipelineApi(me: MeResponse, initial: QuarterlyPipeline) {
      let current = initial;
      const completed: string[] = [];
      const fetchMock = mockFetchRequests(({ method, pathname }) => {
        if (method === 'POST' && pathname === '/api/v1/settlement/quarter/2026-Q4/close') {
          completed.push('CLOSE');
          current = pipeline(5);
          return { status: 201, body: { quarter: '2026-Q4', bordereauRef: 'BDX-2026-Q4' } };
        }
        if (pathname === '/api/v1/me') return { body: me };
        if (pathname === '/api/v1/settlement/quarter/2026-Q4/summary') return { body: SUMMARY };
        if (pathname === '/api/v1/settlement/quarter/2026-Q4/matrix') return { body: MATRIX };
        if (pathname === '/api/v1/settlement/quarter/2026-Q4') return { body: QUARTER };
        if (pathname === '/api/v1/pricing/grid') return { body: GRID };
        if (method === 'GET' && pathname === '/api/v1/settlement/quarter/2026-Q4/pipeline') return { body: current };
        const match = /^\/api\/v1\/settlement\/quarter\/2026-Q4\/pipeline\/(\w+)\/complete$/.exec(pathname);
        if (method === 'POST' && match) {
          completed.push(match[1]);
          current = pipeline(current.steps.filter((s) => s.status === 'DONE').length + 1);
          return { status: 201, body: current };
        }
        return undefined;
      });
      const pipelineGets = () => fetchMock.mock.calls.filter(([input, init]) => String(input).endsWith('/pipeline') && (init?.method ?? 'GET') === 'GET').length;
      return { completed, pipelineGets };
    }

    it('affiche les 5 étapes avec article, statut et badge « en retard »', async () => {
      mockPipelineApi(ME, pipeline(1, true));
      renderWithProviders(<QuarterPage />);

      await waitFor(() => expect(screen.getByTestId('pipeline-step-SAISIE')).toBeInTheDocument());
      expect(within(screen.getByTestId('pipeline-step-SAISIE')).getByText('Fait')).toBeInTheDocument();
      expect(within(screen.getByTestId('pipeline-step-SAISIE')).getByText(/Opérateur Place \(dev\)/)).toBeInTheDocument();
      const current = screen.getByTestId('pipeline-step-SYNTHESE_ANNEXE_7');
      expect(within(current).getByText('En cours')).toBeInTheDocument();
      expect(within(current).getByText('En retard')).toBeInTheDocument();
      expect(screen.getAllByText('En retard')).toHaveLength(1);
      expect(within(screen.getByTestId('pipeline-step-PV_REGLEMENT')).getByText('À venir')).toBeInTheDocument();
      expect(within(screen.getByTestId('pipeline-step-PV_REGLEMENT')).getByText('Art. 18')).toBeInTheDocument();
    });

    it('n’affiche « Marquer comme réalisée » que sur l’étape EN_COURS, avec closeQuarter', async () => {
      mockPipelineApi(ME_CLOSE, pipeline(1));
      renderWithProviders(<QuarterPage />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'Marquer comme réalisée' })).toBeInTheDocument());
      expect(screen.getAllByRole('button', { name: 'Marquer comme réalisée' })).toHaveLength(1);
      expect(within(screen.getByTestId('pipeline-step-SYNTHESE_ANNEXE_7')).getByRole('button', { name: 'Marquer comme réalisée' })).toBeInTheDocument();
    });

    it('masque le bouton sans le privilège closeQuarter', async () => {
      mockPipelineApi(ME, pipeline(1));
      renderWithProviders(<QuarterPage />);

      await waitFor(() => expect(screen.getByTestId('pipeline-step-SYNTHESE_ANNEXE_7')).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: 'Marquer comme réalisée' })).not.toBeInTheDocument();
    });

    it("l'étape 5 EN_COURS propose la clôture trimestrielle, pas « Marquer comme réalisée »", async () => {
      mockPipelineApi(ME_CLOSE, pipeline(4));
      renderWithProviders(<QuarterPage />);

      await waitFor(() => expect(within(screen.getByTestId('pipeline-step-PV_REGLEMENT')).getByText('En cours')).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: 'Marquer comme réalisée' })).not.toBeInTheDocument();
      expect(within(screen.getByTestId('pipeline-step-PV_REGLEMENT')).getByText(/réalisée par la clôture de la compensation trimestrielle/)).toBeInTheDocument();
      expect(within(screen.getByTestId('pipeline-step-PV_REGLEMENT')).getByRole('button', { name: 'Clôturer le trimestre' })).toBeInTheDocument();
    });

    it('masque la clôture sans closeQuarter et tant que les étapes 1 à 4 ne sont pas faites', async () => {
      mockPipelineApi(ME, pipeline(4));
      const { unmount } = renderWithProviders(<QuarterPage />);
      await waitFor(() => expect(within(screen.getByTestId('pipeline-step-PV_REGLEMENT')).getByText('En cours')).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: 'Clôturer le trimestre' })).not.toBeInTheDocument();
      unmount();

      mockPipelineApi(ME_CLOSE, pipeline(2));
      renderWithProviders(<QuarterPage />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Marquer comme réalisée' })).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: 'Clôturer le trimestre' })).not.toBeInTheDocument();
    });

    it('clôture le trimestre après confirmation puis recharge le pipeline', async () => {
      const api = mockPipelineApi(ME_CLOSE, pipeline(4));
      renderWithProviders(<QuarterPage />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'Clôturer le trimestre' })).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: 'Clôturer le trimestre' }));
      expect(screen.getByRole('dialog', { name: 'Clôture de la compensation trimestrielle' })).toBeInTheDocument();
      expect(api.completed).toEqual([]);
      fireEvent.click(screen.getByRole('button', { name: 'Confirmer la clôture' }));

      await waitFor(() => expect(screen.getByText('Trimestre clôturé.')).toBeInTheDocument());
      expect(api.completed).toEqual(['CLOSE']);
      await waitFor(() => expect(within(screen.getByTestId('pipeline-step-PV_REGLEMENT')).getByText('Fait')).toBeInTheDocument());
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it("réalise l'étape EN_COURS puis recharge le pipeline", async () => {
      const api = mockPipelineApi(ME_CLOSE, pipeline(0));
      renderWithProviders(<QuarterPage />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'Marquer comme réalisée' })).toBeInTheDocument());
      const getsBefore = api.pipelineGets();
      fireEvent.change(screen.getByLabelText('Note (facultative)'), { target: { value: 'RAS' } });
      fireEvent.click(screen.getByRole('button', { name: 'Marquer comme réalisée' }));

      await waitFor(() => expect(screen.getByText('Étape marquée comme réalisée.')).toBeInTheDocument());
      expect(api.completed).toEqual(['SAISIE']);
      await waitFor(() => expect(api.pipelineGets()).toBeGreaterThan(getsBefore));
      await waitFor(() => expect(within(screen.getByTestId('pipeline-step-SAISIE')).getByText('Fait')).toBeInTheDocument());
      expect(within(screen.getByTestId('pipeline-step-SYNTHESE_ANNEXE_7')).getByRole('button', { name: 'Marquer comme réalisée' })).toBeInTheDocument();
    });
  });
});
