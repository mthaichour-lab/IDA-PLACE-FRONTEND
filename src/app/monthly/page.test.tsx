import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mockFetchRouter, renderWithProviders } from '@/test/render';
import { MeResponse, RecoursItem, SettlementMonthly, SettlementMonthlyAnnexe7, SettlementMonthlyCompany, SettlementMonthlySummary } from '@/lib/types';
import MonthlyPage from './page';

const ME_WITH_SYNTH: MeResponse = {
  user: { id: 'dev-op', name: 'Opérateur Place (dev)', email: 'operateur@finlab.dz' },
  role: 'OPERATEUR_PLACE',
  privileges: ['synth'],
};

const ME_WITHOUT_SYNTH: MeResponse = {
  user: { id: 'dev-auditeur', name: 'Auditeur CSA (dev)', email: 'auditeur@csa.dz' },
  role: 'AUDITEUR_CSA',
  privileges: [],
};

const SUMMARY: SettlementMonthlySummary = {
  period: '2026-10',
  settledCount: 16,
  totalAmount: 1_622_300,
  excludedOppositionCount: 17,
  insertionDeadline: '2026-11-05',
};

const ANNEXE7: SettlementMonthlyAnnexe7 = {
  period: '2026-10',
  pairs: [{ from: 'CASH', to: 'SAA', count: 3, totalAmount: 311_550 }],
};

function company(overrides: Partial<SettlementMonthlyCompany> = {}): SettlementMonthlyCompany {
  return { code: 'CAAT', claimsCount: 12, resolvedCount: 10, totalAmount: 800_000, status: 'EN_COURS', ...overrides };
}

function mockMonthlyApi(me: MeResponse, companies: SettlementMonthlyCompany[], onClose?: (period: string) => SettlementMonthly) {
  mockFetchRouter((pathname) => {
    if (pathname === '/api/v1/me') return me;
    if (/^\/api\/v1\/settlement\/monthly\/[\d-]+\/close$/.test(pathname)) {
      const period = pathname.split('/')[4];
      return onClose ? onClose(period) : undefined;
    }
    if (/^\/api\/v1\/settlement\/monthly\/[\d-]+\/summary$/.test(pathname)) return SUMMARY;
    if (/^\/api\/v1\/settlement\/monthly\/[\d-]+\/annexe7$/.test(pathname)) return ANNEXE7;
    if (/^\/api\/v1\/settlement\/monthly\/[\d-]+$/.test(pathname)) return { period: '2026-10', companies } as SettlementMonthly;
    return undefined;
  });
}

function recours(overrides: Partial<RecoursItem> = {}): RecoursItem {
  return {
    id: 'rec-0000-aaaa-bbbb',
    reference: 'REC-2026-00309',
    claimId: 'claim-1',
    from: 'CASH',
    to: 'SAA',
    state: 'REGLE',
    requestSentAt: '2026-10-01T08:00:00.000Z',
    createdAt: '2026-10-01T08:00:00.000Z',
    amount: 67_950,
    timer: { timerType: 'AUCUN', remainingDays: 0, expired: false },
    ...overrides,
  };
}

/**
 * Variante de `mockMonthlyApi` qui mocke aussi `GET /recours` (filtres
 * REGLE/OPPOSITION) — section additive "Recours du lot" (réutilise
 * RecoursModule plutôt qu'un nouvel endpoint, voir `monthly/page.tsx`).
 */
function mockMonthlyApiWithLot(me: MeResponse, companies: SettlementMonthlyCompany[], regle: RecoursItem[], opposition: RecoursItem[]) {
  mockFetchRouter((pathname, url) => {
    if (pathname === '/api/v1/me') return me;
    if (/^\/api\/v1\/settlement\/monthly\/[\d-]+\/summary$/.test(pathname)) return SUMMARY;
    if (/^\/api\/v1\/settlement\/monthly\/[\d-]+\/annexe7$/.test(pathname)) return ANNEXE7;
    if (/^\/api\/v1\/settlement\/monthly\/[\d-]+$/.test(pathname)) return { period: '2026-10', companies } as SettlementMonthly;
    if (pathname === '/api/v1/recours') {
      const filter = url.searchParams.get('filter');
      const items = filter === 'OPPOSITION' ? opposition : filter === 'REGLE' ? regle : [];
      return { page: 1, total: items.length, items };
    }
    return undefined;
  });
}

/**
 * Écran Cycle mensuel (/monthly, écran 5, Module C §6.5) — clôture PAR
 * COMPAGNIE (`POST /settlement/monthly/:period/close` avec `{company}`),
 * pas un bordereau global pour toute la place (voir HANDOFF.md).
 */
describe('Écran Cycle mensuel (/monthly)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('affiche la synthèse mensuelle par compagnie (dossiers, montant, avancement)', async () => {
    mockMonthlyApi(ME_WITH_SYNTH, [company({ code: 'CAAT', claimsCount: 12, totalAmount: 800_000 })]);
    renderWithProviders(<MonthlyPage />);

    await waitFor(() => expect(screen.getAllByAltText('CAAT').length).toBeGreaterThan(0));
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText(/800\s?000/)).toBeInTheDocument();
    expect(screen.getByText('En cours')).toBeInTheDocument();
  });

  it('affiche la référence du bordereau pour une compagnie déjà clôturée (pas de bouton de clôture)', async () => {
    mockMonthlyApi(ME_WITH_SYNTH, [company({ status: 'CLOTURE', bordereauRef: 'BORD-2026-10-CAAT' })]);
    renderWithProviders(<MonthlyPage />);

    await waitFor(() => expect(screen.getByText('Clôturé')).toBeInTheDocument());
    expect(screen.getByText('BORD-2026-10-CAAT')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Générer le bordereau' })).not.toBeInTheDocument();
  });

  it('désactive la clôture par compagnie pour un rôle sans le privilège synth (B.7)', async () => {
    mockMonthlyApi(ME_WITHOUT_SYNTH, [company({ status: 'EN_COURS' })]);
    renderWithProviders(<MonthlyPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Générer le bordereau' })).toBeDisabled());
  });

  it('clôture une compagnie et affiche le toast de confirmation', async () => {
    mockMonthlyApi(ME_WITH_SYNTH, [company({ code: 'CAAT', status: 'EN_COURS' })], () => ({
      period: '2026-10',
      companies: [company({ code: 'CAAT', status: 'CLOTURE', bordereauRef: 'BORD-2026-10-CAAT' })],
    }));
    renderWithProviders(<MonthlyPage />);

    // Mois en cours : non échu, la clôture n'est pas proposée (back : 409 PERIODE_NON_ECHUE).
    await waitFor(() => expect(screen.getByRole('button', { name: 'Générer le bordereau' })).toBeDisabled());
    // Mois échu : clôture possible.
    fireEvent.change(screen.getByLabelText('Période'), { target: { value: '2025-09' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Générer le bordereau' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Générer le bordereau' }));

    await waitFor(() => expect(screen.getByText('Bordereau généré.')).toBeInTheDocument());
  });

  it('affiche les KPI de synthèse mensuelle (recours intégrés, montant, exclus, échéance)', async () => {
    mockMonthlyApi(ME_WITH_SYNTH, [company()]);
    renderWithProviders(<MonthlyPage />);

    await waitFor(() => expect(screen.getByText('16')).toBeInTheDocument());
    // Montant en notation compacte (maquette « 1,62 M DA »), montant exact en infobulle.
    expect(screen.getByText(/1,62\s?M/)).toBeInTheDocument();
    expect(screen.getByTitle(/1\s?622\s?300\s?DA/)).toBeInTheDocument();
    expect(screen.getByText('17')).toBeInTheDocument();
  });

  it("affiche la synthèse Annexe 7 par paire créancier/débiteur, sans netting", async () => {
    mockMonthlyApi(ME_WITH_SYNTH, [company()]);
    renderWithProviders(<MonthlyPage />);

    await waitFor(() => expect(screen.getAllByAltText('CASH').length).toBeGreaterThan(0));
    expect(screen.getAllByAltText('SAA').length).toBeGreaterThan(0);
    expect(screen.getByText(/311\s?550/)).toBeInTheDocument();
  });

  /**
   * Section additive "Recours du lot" (fidélité à la capture écran 5) —
   * réutilise `GET /recours` (filtres REGLE/OPPOSITION) : un recours réglé
   * CE mois est « Intégré », un recours en opposition est « Exclu »,
   * jamais un ordre du jour ou une ratio fabriqués.
   */
  it('affiche « Recours du lot » : recours réglés du mois (intégrés) et recours en opposition (exclus)', async () => {
    const settled = [recours({ id: 'rec-regle-1', settledAt: '2026-10-05T10:00:00.000Z', amount: 67_950 })];
    const opposed = [recours({ id: 'rec-opp-1', from: 'CAAR', to: 'CASH', state: 'OPPOSITION', amount: 125_000 })];
    mockMonthlyApiWithLot(ME_WITH_SYNTH, [company()], settled, opposed);
    renderWithProviders(<MonthlyPage />);

    await waitFor(() => expect(screen.getByText('Intégré')).toBeInTheDocument());
    expect(screen.getByText('Exclu — opposition')).toBeInTheDocument();
    expect(screen.getByText(/67\s?950/)).toBeInTheDocument();
    expect(screen.getByText(/125\s?000/)).toBeInTheDocument();
  });

  it("n'intègre pas au lot un recours réglé hors de la période sélectionnée", async () => {
    const settledOtherMonth = [recours({ id: 'rec-aout', settledAt: '2026-08-05T10:00:00.000Z' })];
    mockMonthlyApiWithLot(ME_WITH_SYNTH, [company()], settledOtherMonth, []);
    renderWithProviders(<MonthlyPage />);

    await waitFor(() => expect(screen.getByText('Recours du lot — intégrés et exclus')).toBeInTheDocument());
    expect(screen.queryByText('Intégré')).not.toBeInTheDocument();
  });

  it('affiche l’avancement du cycle : échéance de saisie et clôture par compagnie (données réelles uniquement)', async () => {
    mockMonthlyApiWithLot(ME_WITH_SYNTH, [company({ code: 'CAAT', status: 'CLOTURE' }), company({ code: 'CAAR', status: 'EN_COURS' })], [], []);
    renderWithProviders(<MonthlyPage />);

    await waitFor(() => expect(screen.getByText('1/2 compagnie(s) clôturée(s)')).toBeInTheDocument());
    expect(screen.getByText('Saisie des recours réglés du mois (Art. 16)')).toBeInTheDocument();
  });
});
