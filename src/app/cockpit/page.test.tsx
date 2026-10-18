import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mockFetchRouter, renderWithProviders } from '@/test/render';
import { triggerRealtimeEvent } from '../../../vitest.setup';
import { CockpitSummary, MeResponse, PlaceCalendar } from '@/lib/types';
import CockpitPage from './page';

const ME: MeResponse = {
  user: { id: 'dev-op', name: 'Opérateur Place (dev)', email: 'operateur@finlab.dz' },
  role: 'OPERATEUR_PLACE',
  privileges: ['admin'],
};

const CALENDAR: PlaceCalendar = {
  weekendDays: ['FRIDAY', 'SATURDAY'],
  fixedHolidays: [{ date: '2026-11-01', label: 'Anniversaire du déclenchement de la guerre de libération nationale' }],
};

/**
 * Base de données — kpis/indicateursDePlace réutilisent volontairement
 * certaines valeurs du back réel (ex. `tauxAppariementPct` ===
 * `appariementAutoPct`, même variable côté `CockpitController`), les
 * autres sont choisies distinctes pour que chaque assertion `getByText`
 * cible sans ambiguïté une seule tuile.
 */
const SUMMARY: CockpitSummary = {
  kpis: {
    dossiersDuJour: 19,
    aApparier: 32,
    enRetard: 2,
    compensationAVenir: 500_000,
    recoursEnCours: 53,
    delaisDepasses: 6,
    appariementAutoPct: 62,
    volumeBrutT3: 5_650_000,
    reductionNettingPct: 78,
  },
  sparklineDeclarations: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 19],
  // Jamais affiché (contrat legacy conservé pour compatibilité) — vérifié explicitement absent ci-dessous.
  barresNettes: [{ company: 'XXX-LEGACY', net: 999 }],
  indicateursDePlace: {
    declarationsDuMois: 104,
    tauxAppariementPct: 62,
    enAttenteAppariement: 32,
    tauxHorsIdaPct: 4,
    delaiMoyenAppariementJours: 1.3,
    recoursForclos: 4,
    compensationNetteT3: 1_270_000,
    penalitesDeRetard: 1_230_000,
    expertsActifs: 17,
    expertsSuspendus: 2,
    adherentsActifs: 5,
    adherentsSuspendus: 0,
  },
  positionsNettesQuarter: {
    quarter: '2026-Q4',
    positions: [
      { code: 'CASH', net: 1_070_000 },
      { code: 'SAA', net: -650_000 },
    ],
    grossTotal: 5_650_000,
    reductionPct: 78,
  },
  monthlyDeclarations: [
    { month: '2026-09', declarations: 80 },
    { month: '2026-10', declarations: 104 },
  ],
  topWilayas: [
    { code: '16', name: 'Alger', declarations: 50 },
    { code: '23', name: 'Annaba', declarations: 30 },
    { code: '25', name: 'Constantine', declarations: 20 },
  ],
  cycleConventionnel: {
    period: '2026-10',
    quarter: '2026-Q4',
    steps: [
      { key: 'saisie', label: 'Saisie mensuelle', article: 'Art. 16', done: true, detail: 'Échéance 2026-10-05 (jour calendaire)' },
      { key: 'synthese_annexe7', label: 'Synthèse Annexe 7', article: 'Art. 16', done: true, detail: '2 paire(s) créancier/débiteur' },
      { key: 'cloture_trimestre', label: 'Compensation trimestrielle', article: 'Art. 17', done: false, detail: 'Non clôturé' },
    ],
  },
  alertesConventionnelles: [
    { id: 'recours-rec-1', from: 'CASH', to: 'SAA', description: 'Délai de réponse Art.10 dépassé', article: 'Art. 10', detectedAt: '2026-10-10T00:00:00.000Z' },
    {
      id: 'commission-com-1',
      from: 'CAAT',
      to: 'CASH',
      description: 'Conciliation par la Commission — dépassement du délai Art.24',
      article: 'Art. 24',
      detectedAt: '2026-10-12T00:00:00.000Z',
    },
  ],
  commissionOverdue15dCount: 1,
  updatedAt: new Date('2026-10-18T09:00:00.000Z').toISOString(),
};

function mockApis(summary: CockpitSummary): void {
  mockFetchRouter((pathname) => {
    if (pathname === '/api/v1/me') return ME;
    if (pathname === '/api/v1/cockpit/summary') return summary;
    if (pathname === '/api/v1/referential/calendar') return CALENDAR;
    return undefined;
  });
}

describe('Écran Cockpit de place (/cockpit)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('affiche les 6 KPIs principaux renvoyés par GET /cockpit/summary, sans recalcul côté front', async () => {
    mockApis(SUMMARY);
    renderWithProviders(<CockpitPage />);

    await waitFor(() => expect(screen.getByText('Recours en cours')).toBeInTheDocument());
    // `.closest('.kpi')` partout ici : les valeurs brutes (ex. "6", "19") collisionnent sinon avec les
    // numéros de jour affichés par la bande calendrier du cycle conventionnel (même écran, même SUMMARY).
    expect(screen.getByText('Recours en cours').closest('.kpi')).toHaveTextContent('53');
    expect(screen.getByText('Délais dépassés').closest('.kpi')).toHaveTextContent('6');
    expect(screen.getByText('Déclarations reçues (24 h)').closest('.kpi')).toHaveTextContent('19');
    expect(screen.getByText('Appariement automatique').closest('.kpi')).toHaveTextContent('62 %');
    expect(screen.getByText('Volume brut trimestriel').closest('.kpi')).toHaveTextContent(/5\s?650\s?000/);
    expect(screen.getByText('Réduction par netting').closest('.kpi')).toHaveTextContent('78 %');
  });

  it("rend un repère « non disponible », jamais NaN/null, quand appariementAutoPct est null", async () => {
    mockApis({ ...SUMMARY, kpis: { ...SUMMARY.kpis, appariementAutoPct: null } });
    renderWithProviders(<CockpitPage />);

    await waitFor(() => expect(screen.getByText('Appariement automatique').closest('.kpi')).toHaveTextContent('Aucune donnée.'));
    expect(screen.queryByText('NaN %')).not.toBeInTheDocument();
    expect(screen.queryByText('null %')).not.toBeInTheDocument();
  });

  it('affiche les 10 tuiles "Indicateurs de place" (§6.8-6.10)', async () => {
    mockApis(SUMMARY);
    renderWithProviders(<CockpitPage />);

    await waitFor(() => expect(screen.getByText('Indicateurs de place')).toBeInTheDocument());
    expect(screen.getByText('Déclarations du mois').closest('.kpi')).toHaveTextContent('104');
    expect(screen.getByText("Taux d'appariement").closest('.kpi')).toHaveTextContent('62 %');
    expect(screen.getByText("En attente d'appariement").closest('.kpi')).toHaveTextContent('32');
    expect(screen.getByText('Taux hors-IDA').closest('.kpi')).toHaveTextContent('4 %');
    expect(screen.getByText("Délai moyen d'appariement").closest('.kpi')).toHaveTextContent('1.3 j');
    expect(screen.getByText('Recours forclos').closest('.kpi')).toHaveTextContent('4');
    expect(screen.getByText('Compensation nette trimestrielle').closest('.kpi')).toHaveTextContent(/1\s?270\s?000/);
    expect(screen.getByText('Pénalités de retard').closest('.kpi')).toHaveTextContent(/1\s?230\s?000/);
    expect(screen.getByText('Experts actifs / suspendus').closest('.kpi')).toHaveTextContent('17 / 2');
    expect(screen.getByText('Adhérents actifs / suspendus').closest('.kpi')).toHaveTextContent('5 / 0');
  });

  it('le graphe "Positions nettes" utilise positionsNettesQuarter (pas barresNettes) et distingue positif/négatif', async () => {
    mockApis(SUMMARY);
    const { container } = renderWithProviders(<CockpitPage />);

    await waitFor(() => expect(screen.getByText(/Positions nettes par compagnie — T4/)).toBeInTheDocument());
    expect(screen.queryByText('XXX-LEGACY')).not.toBeInTheDocument();
    const rows = container.querySelectorAll('.net-bar-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('CASH');
    expect(rows[1]).toHaveTextContent('SAA');

    const fills = container.querySelectorAll('.net-bar-fill');
    expect(fills).toHaveLength(2);
    expect((fills[0] as HTMLElement).style.background).toContain('var(--k-pri-2)'); // CASH, +1 070 000 — positif
    expect((fills[1] as HTMLElement).style.background).toContain('var(--ko)'); // SAA, -650 000 — négatif
  });

  it('le suivi du cycle conventionnel affiche exactement 3 étapes réelles (jamais 5)', async () => {
    mockApis(SUMMARY);
    const { container } = renderWithProviders(<CockpitPage />);

    await waitFor(() => expect(screen.getByText(/Cycle conventionnel en cours/)).toBeInTheDocument());
    const steps = container.querySelectorAll('.cycle-step');
    expect(steps).toHaveLength(3);
    expect(screen.getByText('Saisie mensuelle')).toBeInTheDocument();
    expect(screen.getByText('Synthèse Annexe 7')).toBeInTheDocument();
    expect(screen.getByText('Compensation trimestrielle')).toBeInTheDocument();
    // Jamais les 2 étapes non suivies (pas de donnée source) comme VRAIES étapes du tracker — seule la note
    // muette en dessous a le droit de les mentionner (le texte explicatif les nomme justement pour dire
    // qu'elles sont absentes), donc on vérifie l'absence à l'intérieur des `.cycle-step` seulement.
    for (const step of steps) {
      expect(step.textContent).not.toMatch(/Réunion UAR/);
      expect(step.textContent).not.toMatch(/Règlements sous 8/);
    }
    expect(screen.getByText(/non suivis/)).toBeInTheDocument();
  });

  it('la liste des alertes conventionnelles affiche les chips compagnies et le badge article', async () => {
    mockApis(SUMMARY);
    renderWithProviders(<CockpitPage />);

    await waitFor(() => expect(screen.getByText(/Alertes conventionnelles/)).toBeInTheDocument());
    expect(screen.getByText('Alertes conventionnelles (2)')).toBeInTheDocument();
    expect(screen.getByText('Délai de réponse Art.10 dépassé', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Art. 10')).toBeInTheDocument();
    expect(screen.getByText('Art. 24')).toBeInTheDocument();
    expect(screen.getAllByText('CASH').length).toBeGreaterThan(0);
    expect(screen.getAllByText('CAAT').length).toBeGreaterThan(0);
  });

  it('le flux temps réel ajoute un événement reçu et le bouton Pause stoppe les ajouts suivants', async () => {
    mockApis(SUMMARY);
    renderWithProviders(<CockpitPage />);
    await waitFor(() => expect(screen.getByText('Flux temps réel')).toBeInTheDocument());

    expect(screen.getByText('Aucun événement reçu pour le moment.')).toBeInTheDocument();

    act(() => {
      triggerRealtimeEvent('claim.ingested', { fileName: 'import-oct.csv', totalRows: 10, eligibleCount: 8, ineligibleCount: 2, importedAt: '2026-10-18T09:00:00.000Z' });
    });

    expect(screen.getByText('Ingestion')).toBeInTheDocument();
    expect(screen.getByText(/import-oct\.csv — 8\/10 éligibles/)).toBeInTheDocument();

    const pauseButton = screen.getByRole('button', { name: 'Pause' });
    act(() => {
      pauseButton.click();
    });
    expect(screen.getByRole('button', { name: 'Reprendre' })).toBeInTheDocument();

    act(() => {
      triggerRealtimeEvent('claim.ingested', { fileName: 'import-nov.csv', totalRows: 5, eligibleCount: 5, ineligibleCount: 0, importedAt: '2026-11-01T09:00:00.000Z' });
    });

    expect(screen.queryByText(/import-nov\.csv/)).not.toBeInTheDocument();
    expect(screen.getByText(/import-oct\.csv/)).toBeInTheDocument();
  });

  it("affiche un état d'erreur avec action de nouvelle tentative si l'API échoue", async () => {
    mockFetchRouter((pathname) => {
      if (pathname === '/api/v1/me') return ME;
      if (pathname === '/api/v1/referential/calendar') return CALENDAR;
      return undefined; // /cockpit/summary non mocké => 404
    });

    renderWithProviders(<CockpitPage />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /réessayer|retry/i })).toBeInTheDocument();
  });
});
