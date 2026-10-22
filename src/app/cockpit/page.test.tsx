import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mockFetchRouter, renderWithProviders } from '@/test/render';
import { triggerRealtimeEvent } from '../../../vitest.setup';
import { CockpitSummary, MeResponse, PlaceCalendar, QuarterlyPipeline } from '@/lib/types';
import CockpitPage from './page';

const ME: MeResponse = {
  user: { id: 'dev-op', name: 'Opérateur Place (dev)', email: 'operateur@finlab.dz' },
  role: 'OPERATEUR_PLACE',
  privileges: ['admin'],
};

const CALENDAR: PlaceCalendar = {
  weekendDays: ['FRIDAY', 'SATURDAY'],
  fixedHolidays: [{ date: '2026-11-01', label: 'Anniversaire du déclenchement de la guerre de libération nationale' }],
  holidays: [],
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
    { id: 'recours-rec-1', reference: 'REC-2026-00284', from: 'CASH', to: 'SAA', description: 'Délai de réponse Art.10 dépassé', article: 'Art. 10', detectedAt: '2026-10-10T00:00:00.000Z' },
    {
      id: 'commission-com-1',
      reference: 'CSC-2026-014',
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

/**
 * Les 5 étapes réelles du lot trimestriel, même forme que
 * `GET /settlement/quarter/:q/pipeline` consommée par `/quarter` — ce sont
 * les 2 étapes (`SYNTHESE_GLOBALE_REUNION`/`PV_REGLEMENT`) qu'un repli
 * antérieur de cet écran croyait à tort sans donnée source.
 */
const PIPELINE: QuarterlyPipeline = {
  quarter: '2026-Q3',
  steps: [
    { step: 'SAISIE', label: 'Saisie et validation des recours sur la plateforme', article: 'Art. 16', status: 'DONE', dueDate: '2027-01-07', overdue: false },
    { step: 'SYNTHESE_ANNEXE_7', label: 'Synthèse mensuelle automatisée (Annexe n°7)', article: 'Art. 16', status: 'DONE', dueDate: '2027-01-10', overdue: false },
    {
      step: 'TRANSMISSION_ANNEXE_8',
      label: 'Insertion des informations de règlement (Annexe n°8) et transmission aux parties tierces, copie à la Commission',
      article: 'Art. 16-17',
      status: 'EN_COURS',
      dueDate: '2027-01-31',
      overdue: false,
    },
    { step: 'SYNTHESE_GLOBALE_REUNION', label: "Synthèse globale trimestrielle et réunion au siège de l'UAR", article: 'Art. 17-18', status: 'A_VENIR', dueDate: '2027-01-31', overdue: false },
    { step: 'PV_REGLEMENT', label: 'Signature du PV trimestriel (Annexe n°9) et règlement sous 8 jours', article: 'Art. 18', status: 'A_VENIR', dueDate: '2027-02-08', overdue: false },
  ],
};

function mockApis(summary: CockpitSummary, pipeline: QuarterlyPipeline = PIPELINE): void {
  mockFetchRouter((pathname) => {
    if (pathname === '/api/v1/me') return ME;
    if (pathname === '/api/v1/cockpit/summary') return summary;
    if (pathname === '/api/v1/referential/calendar') return CALENDAR;
    // Lot en cours de règlement = trimestre précédant `cycleConventionnel.quarter` (2026-Q4 → 2026-Q3).
    if (pathname === '/api/v1/settlement/quarter/2026-Q3/pipeline') return pipeline;
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
    // Notation compacte (fidélité capture écran 1) : "5,65 M DA", jamais le groupement complet "5 650 000".
    expect(screen.getByText('Volume brut trimestriel').closest('.kpi')).toHaveTextContent(/5,65\s?M\s?DA/);
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
    expect(screen.getByText("Délai moyen d'appariement").closest('.kpi')).toHaveTextContent('1,3 j');
    expect(screen.getByText('Recours forclos').closest('.kpi')).toHaveTextContent('4');
    // Notation compacte (fidélité capture écran 1) : "1,27 M DA" / "1,23 M DA", jamais le groupement complet.
    expect(screen.getByText('Compensation nette bilatérale (trimestre)').closest('.kpi')).toHaveTextContent(/1,27\s?M\s?DA/);
    expect(screen.getByText('Pénalités de retard').closest('.kpi')).toHaveTextContent(/1,23\s?M\s?DA/);
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
    expect((fills[0] as HTMLElement).style.background).toContain('var(--k-pri)'); // CASH, +1 070 000 — positif
    expect((fills[1] as HTMLElement).style.background).toContain('var(--ko)'); // SAA, -650 000 — négatif

    // Notation compacte (fidélité capture écran 1) : "+1,07 M" / "−650 k", jamais le groupement complet.
    expect(rows[0]).toHaveTextContent('+1,07 M');
    expect(rows[1]).toHaveTextContent('−650 k');
  });

  it("le suivi du cycle conventionnel affiche les 5 étapes RÉELLES du lot trimestriel (`/settlement/quarter/:q/pipeline`, même donnée que « Avancement du lot » sur /quarter)", async () => {
    mockApis(SUMMARY);
    const { container } = renderWithProviders(<CockpitPage />);

    await waitFor(() => expect(screen.getByText(/Cycle conventionnel en cours/)).toBeInTheDocument());
    // Les 2 étapes qu'un repli antérieur de cet écran croyait sans donnée
    // source existent réellement (SettlementModule) : elles apparaissent une
    // fois le lot trimestriel chargé, avec sa propre échéance réelle.
    // Libellé court affiché (capture), libellé conventionnel complet en infobulle.
    await waitFor(() => expect(screen.getByText('Réunion UAR · synthèse globale')).toBeInTheDocument());
    expect(screen.getByTitle(/Synthèse globale trimestrielle et réunion au siège de l.UAR/)).toBeInTheDocument();
    expect(screen.getByText('Saisie septembre 2026')).toBeInTheDocument();
    const steps = container.querySelectorAll('.cycle-step');
    expect(steps).toHaveLength(5);
    expect(screen.getByTitle(/Signature du PV trimestriel/)).toBeInTheDocument();
    expect(screen.getByText('Art. 16-18')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Voir le détail de l.avancement du lot/ })).toHaveAttribute('href', '/quarter');
  });

  it('le badge d\'articles du cycle est dérivé des étapes réellement affichées ("Art. 16-17" pendant le chargement, "Art. 16-18" une fois le lot trimestriel chargé)', async () => {
    mockApis(SUMMARY);
    renderWithProviders(<CockpitPage />);

    await waitFor(() => expect(screen.getByText(/Cycle conventionnel en cours/)).toBeInTheDocument());
    expect(screen.getByText('Art. 16-17')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Art. 16-18')).toBeInTheDocument());
    expect(screen.queryByText('Art. 16-17')).not.toBeInTheDocument();
  });

  it('la liste des alertes conventionnelles affiche la référence métier, les chips compagnies et le badge article', async () => {
    mockApis(SUMMARY);
    renderWithProviders(<CockpitPage />);

    await waitFor(() => expect(screen.getByText(/Alertes conventionnelles/)).toBeInTheDocument());
    expect(screen.getByText('Alertes conventionnelles').closest('.head-with-count')?.querySelector('.count-badge')).toHaveTextContent('2');
    expect(screen.getByText('Délai de réponse Art.10 dépassé', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Art. 10')).toBeInTheDocument();
    expect(screen.getByText('Art. 24')).toBeInTheDocument();
    expect(screen.getAllByText('CASH').length).toBeGreaterThan(0);
    expect(screen.getByText('REC-2026-00284')).toHaveAttribute('title', 'recours-rec-1');
    // Dossier de commission (CSC-…) : pas de paire compagnie (maquette, écran 1).
    expect(screen.getByText('CSC-2026-014')).toHaveAttribute('title', 'commission-com-1');
    expect(screen.getByText('CSC-2026-014').closest('.alert-text')).not.toHaveTextContent('CAAT');
  });

  it('le flux temps réel ajoute un événement reçu et le bouton Pause stoppe les ajouts suivants', async () => {
    mockApis(SUMMARY);
    renderWithProviders(<CockpitPage />);
    await waitFor(() => expect(screen.getByText('Flux temps réel')).toBeInTheDocument());

    expect(screen.getByText('Aucun événement reçu pour le moment.')).toBeInTheDocument();

    act(() => {
      triggerRealtimeEvent('match.updated', { id: 'MATCH-0042', state: 'CONFIRME' });
    });

    expect(screen.getByText(/^Matching/)).toBeInTheDocument();
    expect(screen.getByText('MATCH-0042')).toBeInTheDocument();
    expect(screen.getByText('CONFIRME')).toBeInTheDocument();

    const pauseButton = screen.getByRole('button', { name: 'Pause' });
    act(() => {
      pauseButton.click();
    });
    expect(screen.getByRole('button', { name: 'Reprendre' })).toBeInTheDocument();

    act(() => {
      triggerRealtimeEvent('match.updated', { id: 'MATCH-0043', state: 'REJETE' });
    });

    expect(screen.queryByText(/MATCH-0043/)).not.toBeInTheDocument();
    expect(screen.getByText(/MATCH-0042/)).toBeInTheDocument();
  });

  it('le flux temps réel affiche la référence métier diffusée, l’identifiant restant en infobulle', async () => {
    mockApis(SUMMARY);
    renderWithProviders(<CockpitPage />);
    await waitFor(() => expect(screen.getByText('Flux temps réel')).toBeInTheDocument());

    act(() => {
      triggerRealtimeEvent('match.updated', { id: '7d0c1a2b-0000-4000-8000-000000000005', reference: 'MAT-261013-005', status: 'AUTO_CONFIRME' });
    });

    expect(screen.getByText('MAT-261013-005')).toHaveAttribute('title', '7d0c1a2b-0000-4000-8000-000000000005');
    expect(screen.queryByText('7d0c1a2b-0000-4000-8000-000000000005')).not.toBeInTheDocument();
  });

  it('SEC-07 : aucune donnée métier du payload n’est affichée, et le résumé est rechargé par l’API', async () => {
    mockApis(SUMMARY);
    const fetchFn = vi.mocked(fetch);
    renderWithProviders(<CockpitPage />);
    await waitFor(() => expect(screen.getByText('Flux temps réel')).toBeInTheDocument());
    const summaryCalls = () => fetchFn.mock.calls.filter(([input]) => String(input).includes('/cockpit/summary')).length;
    const before = summaryCalls();

    act(() => {
      // Payload « historique » trop bavard : seuls id/état doivent survivre.
      triggerRealtimeEvent('claim.ingested', { id: 'IMP-7', state: 'TERMINE', fileName: 'assures-saa.csv', policyNumber: 'POL-123', decidedBy: 'agent.x' });
    });

    expect(screen.getByText('IMP-7')).toBeInTheDocument();
    expect(screen.getByText('TERMINE')).toBeInTheDocument();
    expect(screen.queryByText(/assures-saa|POL-123|agent\.x/)).not.toBeInTheDocument();
    await waitFor(() => expect(summaryCalls()).toBeGreaterThan(before));
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
