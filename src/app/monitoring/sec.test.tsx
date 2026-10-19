import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeResponse, MonitoringCompanyScore, MonitoringScores } from '@/lib/types';
import { renderWithProviders } from '@/test/render';
import MonitoringPage from './page';

/**
 * SEC-26 — écran 8 : un rôle compagnie ne reçoit ni `details` ni `profile`
 * pour les autres compagnies ; le classement s'affiche avec « — » et le
 * détail (profil, parcours) reste celui de SA compagnie.
 */

const CORRESPONDANT: MeResponse = { user: { id: 'u-c', name: 'Corr.', email: 'c@caat.dz' }, role: 'CORRESPONDANT_IDA', privileges: [], company: 'CAAT' };

const DETAIL = { value: 80, dataSource: 'REEL' as const, sampleSize: 10 };
const OWN: MonitoringCompanyScore = {
  code: 'CAAT',
  score: 80,
  grade: 'B',
  rank: 2,
  details: { delais: DETAIL, silences: DETAIL, oppositions: DETAIL, qualiteDonnees: DETAIL, forclusions: DETAIL, demandesTardives: DETAIL, penalites: DETAIL },
  profile: {
    onTimeResponsePct: 91,
    avgResponseDays: 3,
    oppositionsEmisesCount: 1,
    oppositionsSubiesCount: 2,
    silencesCount: 0,
    contestationsCount: 0,
    forclosCount: 4,
    silencesRatePct: 0,
    oppositionsRatePct: 5,
  },
};
const OTHER: MonitoringCompanyScore = { code: 'SAA', score: 92, grade: 'A', rank: 1 };

const SCORES: MonitoringScores = {
  weights: { delais: 0.3, silences: 0.15, oppositions: 0.15, qualiteDonnees: 0.15, forclusions: 0.1, demandesTardives: 0.1, penalites: 0.05 },
  companies: [OTHER, OWN],
  notes: [],
  silenceDays: 10,
  oppositionAlertThresholdPct: 30,
};

describe('Écran 8 — classement sans détail des autres compagnies (SEC-26)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('autres compagnies : « — » sans planter ; profil et parcours de SA compagnie seulement', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === 'string' ? input : input.toString());
        calls.push(url.pathname);
        const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
        if (url.pathname === '/api/v1/me') return json(CORRESPONDANT);
        if (url.pathname === '/api/v1/monitoring/scores') return json(SCORES);
        if (url.pathname === '/api/v1/monitoring/companies/CAAT/journeys') return json({ page: 1, total: 0, items: [] });
        return json({ code: 'FORBIDDEN', message: 'Accès hors périmètre' }, 403);
      }),
    );
    renderWithProviders(<MonitoringPage />);

    await screen.findByText(/le détail \(taux, délais, parcours\) n’est publié que pour votre compagnie/);
    const otherRow = screen.getByText('#1').closest('tr')!;
    expect(otherRow).toHaveTextContent('—');
    expect(await screen.findByText('Profil — CAAT')).toBeInTheDocument();

    // Clic sur une autre compagnie : la sélection reste sur CAAT, aucun appel hors périmètre.
    fireEvent.click(otherRow);
    await waitFor(() => expect(calls).toContain('/api/v1/monitoring/companies/CAAT/journeys'));
    expect(calls).not.toContain('/api/v1/monitoring/companies/SAA/journeys');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
