import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mockFetchRouter, renderWithProviders } from '@/test/render';
import { MeResponse, MonitoringCompanyProfile, MonitoringCompanyScore, MonitoringJourney, MonitoringScores, Paginated } from '@/lib/types';
import MonitoringPage from './page';

const ME: MeResponse = {
  user: { id: 'dev-op', name: 'Opérateur Place (dev)', email: 'operateur@finlab.dz' },
  role: 'OPERATEUR_PLACE',
  privileges: [],
};

const WEIGHTS = { delais: 0.3, silences: 0.15, oppositions: 0.15, qualiteDonnees: 0.15, forclusions: 0.1, demandesTardives: 0.1, penalites: 0.05 };

function profile(overrides: Partial<MonitoringCompanyProfile> = {}): MonitoringCompanyProfile {
  return {
    onTimeResponsePct: 86,
    avgResponseDays: 4.5,
    oppositionsEmisesCount: 8,
    oppositionsSubiesCount: 6,
    silencesCount: 5,
    contestationsCount: 1,
    forclosCount: 0,
    silencesRatePct: 14,
    oppositionsRatePct: 21,
    ...overrides,
  };
}

function companyScore(code: string, score: number | null, overrides: Partial<MonitoringCompanyScore> = {}): MonitoringCompanyScore {
  return {
    code,
    score,
    grade: score === null ? null : score >= 90 ? 'A' : score >= 72 ? 'B' : score >= 50 ? 'C' : 'D',
    rank: 1,
    details: {
      delais: { value: score, dataSource: score === null ? 'NON_DISPONIBLE' : 'REEL', sampleSize: 12 },
      silences: { value: score, dataSource: score === null ? 'NON_DISPONIBLE' : 'REEL', sampleSize: 12 },
      oppositions: { value: score, dataSource: score === null ? 'NON_DISPONIBLE' : 'REEL', sampleSize: 12 },
      qualiteDonnees: { value: score, dataSource: score === null ? 'NON_DISPONIBLE' : 'REEL', sampleSize: 12 },
      forclusions: { value: score, dataSource: score === null ? 'NON_DISPONIBLE' : 'REEL', sampleSize: 12 },
      demandesTardives: { value: score, dataSource: score === null ? 'NON_DISPONIBLE' : 'REEL', sampleSize: 12 },
      penalites: { value: score, dataSource: score === null ? 'NON_DISPONIBLE' : 'REEL', sampleSize: 12 },
    },
    profile: profile(),
    ...overrides,
  };
}

function journey(overrides: Partial<MonitoringJourney> = {}): MonitoringJourney {
  return {
    id: 'rec-1',
    claimId: 'SAA-2025-000160',
    direction: 'EMIS',
    counterparty: 'CAAR',
    amount: 120_000,
    state: 'EN_ATTENTE',
    steps: [{ key: 'annexe2', at: new Date().toISOString() }],
    requestSentAt: new Date().toISOString(),
    ...overrides,
  };
}

function mockMonitoringApi(scores: MonitoringScores, journeys: Record<string, MonitoringJourney[]> = {}) {
  mockFetchRouter((pathname) => {
    if (pathname === '/api/v1/me') return ME;
    if (pathname === '/api/v1/monitoring/scores') return scores;
    const m = /^\/api\/v1\/monitoring\/companies\/(.+)\/journeys$/.exec(pathname);
    if (m) {
      const items = journeys[m[1]] ?? [];
      const result: Paginated<MonitoringJourney> = { page: 1, total: items.length, items };
      return result;
    }
    return undefined;
  });
}

/**
 * Écran Monitoring & scoring (/monitoring, écran 8, B.2/§6.8) — classement
 * de conformité (nouvelles colonnes incluant la note), profil radar +
 * tuiles de la compagnie sélectionnée, bandeau "oppositions fréquentes"
 * conditionnel, et "Vue par dossier" (parcours réel, pas un compte fixe
 * 8/11 — voir HANDOFF.md).
 */
describe('Écran Monitoring & scoring (/monitoring)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('affiche le classement des compagnies avec score composite, note et taux bruts', async () => {
    const scores: MonitoringScores = {
      weights: WEIGHTS,
      companies: [companyScore('SAA', 82, { rank: 1 }), companyScore('CASH', 65, { rank: 2 })],
      notes: [],
      silenceDays: 30,
      oppositionAlertThresholdPct: 20,
    };
    mockMonitoringApi(scores);

    renderWithProviders(<MonitoringPage />);

    await waitFor(() => expect(screen.getAllByText('SAA').length).toBeGreaterThan(0));
    expect(screen.getAllByText('CASH').length).toBeGreaterThan(0);
    // Note lettrée : B pour un score de 82 (seuil B >= 72, voir gradeFromScore back).
    expect(screen.getAllByText('• B').length).toBeGreaterThan(0);
    // Colonnes de taux bruts (profile), pas les scores composite inversés.
    expect(screen.getAllByText('86 %').length).toBeGreaterThan(0);
    expect(screen.getAllByText('14 %').length).toBeGreaterThan(0);
  });

  it('affiche un repère "non disponible" plutôt qu\'un crash pour une composante NON_DISPONIBLE', async () => {
    const scores: MonitoringScores = {
      weights: WEIGHTS,
      companies: [companyScore('CAAT', null)],
      notes: [],
      silenceDays: 30,
      oppositionAlertThresholdPct: 20,
    };
    mockMonitoringApi(scores);

    renderWithProviders(<MonitoringPage />);

    await waitFor(() => expect(screen.getAllByText('CAAT').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Aucune donnée.').length).toBeGreaterThan(0);
  });

  it('affiche le profil radar et les 8 tuiles de la compagnie sélectionnée par défaut (la première du classement)', async () => {
    const scores: MonitoringScores = {
      weights: WEIGHTS,
      companies: [companyScore('SAA', 82, { rank: 1 })],
      notes: [],
      silenceDays: 30,
      oppositionAlertThresholdPct: 20,
    };
    mockMonitoringApi(scores);

    renderWithProviders(<MonitoringPage />);

    await waitFor(() => expect(screen.getByText('Profil — SAA')).toBeInTheDocument());
    // Libellé dynamique avec la vraie fenêtre Art.10 configurée (30 j ici), jamais "10 j" en dur.
    expect(screen.getByText('Réponses dans les 30 j')).toBeInTheDocument();
    expect(screen.getByText('Délai moyen de réponse')).toBeInTheDocument();
    expect(screen.getByText('Oppositions émises')).toBeInTheDocument();
    expect(screen.getByText('Qualité des données')).toBeInTheDocument();
    // Grand nombre centré du radar = le score composite de la compagnie sélectionnée
    // (aussi affiché dans le classement — ScoreBar — d'où `getAllByText`).
    expect(screen.getAllByText('82').length).toBeGreaterThanOrEqual(2);
  });

  it("affiche le bandeau « oppositions fréquentes » quand le taux brut dépasse le seuil renvoyé par l'API", async () => {
    const scores: MonitoringScores = {
      weights: WEIGHTS,
      companies: [companyScore('SAA', 82, { profile: profile({ oppositionsRatePct: 25 }) })],
      notes: [],
      silenceDays: 30,
      oppositionAlertThresholdPct: 20,
    };
    mockMonitoringApi(scores);

    renderWithProviders(<MonitoringPage />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    // Même valeur brute affichée dans le bandeau et dans la colonne "Opp. émises" du
    // classement (`profile.oppositionsRatePct`, voir choix de mapping documenté dans le
    // composant) — on vérifie le contenu du bandeau précisément plutôt qu'un texte isolé.
    expect(screen.getByRole('alert').textContent).toContain('Oppositions fréquentes (25 %)');
  });

  it("n'affiche pas le bandeau quand le taux brut d'oppositions est sous le seuil", async () => {
    const scores: MonitoringScores = {
      weights: WEIGHTS,
      companies: [companyScore('SAA', 82, { profile: profile({ oppositionsRatePct: 12 }) })],
      notes: [],
      silenceDays: 30,
      oppositionAlertThresholdPct: 20,
    };
    mockMonitoringApi(scores);

    renderWithProviders(<MonitoringPage />);

    await waitFor(() => expect(screen.getByText('Profil — SAA')).toBeInTheDocument());
    expect(screen.queryByText(/Oppositions fréquentes/)).not.toBeInTheDocument();
  });

  it('« Vue par dossier » affiche le nombre RÉEL d\'étapes par dossier (pas un compte fixe 8/11)', async () => {
    const scores: MonitoringScores = {
      weights: WEIGHTS,
      companies: [companyScore('SAA', 82)],
      notes: [],
      silenceDays: 30,
      oppositionAlertThresholdPct: 20,
    };
    mockMonitoringApi(scores, {
      SAA: [
        journey({ id: 'rec-1', steps: [{ key: 'annexe2', at: new Date().toISOString() }] }),
        journey({
          id: 'rec-2',
          claimId: 'SAA-2026-000141',
          direction: 'RECU',
          counterparty: 'CAAT',
          state: 'COMMISSION',
          steps: [
            { key: 'annexe2', at: '2026-01-01T00:00:00.000Z' },
            { key: 'annexe3', at: '2026-01-05T00:00:00.000Z' },
            { key: 'commission', at: '2026-01-10T00:00:00.000Z' },
          ],
        }),
      ],
    });

    renderWithProviders(<MonitoringPage />);

    await waitFor(() => expect(screen.getByText('rec-1')).toBeInTheDocument());
    expect(screen.getByText('1 étapes')).toBeInTheDocument();
    expect(screen.getByText('3 étapes')).toBeInTheDocument();
    expect(screen.getByText('rec-2')).toBeInTheDocument();
  });

  it('pagine la « Vue par dossier » par 6 lignes (convention de place A.5)', async () => {
    const scores: MonitoringScores = {
      weights: WEIGHTS,
      companies: [companyScore('SAA', 82)],
      notes: [],
      silenceDays: 30,
      oppositionAlertThresholdPct: 20,
    };
    const items = Array.from({ length: 8 }, (_, i) => journey({ id: `rec-${i + 1}`, claimId: `SAA-2026-${String(i + 1).padStart(6, '0')}` }));
    mockMonitoringApi(scores, { SAA: items });

    renderWithProviders(<MonitoringPage />);

    await waitFor(() => expect(screen.getByText('rec-1')).toBeInTheDocument());
    expect(screen.queryByText('rec-7')).not.toBeInTheDocument();

    const journeysSheet = screen.getByText('Vue par dossier — parcours complet').closest('.sheet') as HTMLElement;
    fireEvent.click(within(journeysSheet).getByRole('button', { name: 'Suivant' }));

    await waitFor(() => expect(screen.getByText('rec-7')).toBeInTheDocument());
    expect(screen.queryByText('rec-1')).not.toBeInTheDocument();
  });
});
