import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mockFetchRouter, renderWithProviders } from '@/test/render';
import { MeResponse, SettlementMonthly, SettlementMonthlyAnnexe7, SettlementMonthlyCompany, SettlementMonthlySummary } from '@/lib/types';
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

    await waitFor(() => expect(screen.getAllByText('CAAT').length).toBeGreaterThan(0));
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

    await waitFor(() => expect(screen.getByRole('button', { name: 'Générer le bordereau' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Générer le bordereau' }));

    await waitFor(() => expect(screen.getByText('Bordereau généré.')).toBeInTheDocument());
  });

  it('affiche les KPI de synthèse mensuelle (recours intégrés, montant, exclus, échéance)', async () => {
    mockMonthlyApi(ME_WITH_SYNTH, [company()]);
    renderWithProviders(<MonthlyPage />);

    await waitFor(() => expect(screen.getByText('16')).toBeInTheDocument());
    expect(screen.getByText(/1\s?622\s?300/)).toBeInTheDocument();
    expect(screen.getByText('17')).toBeInTheDocument();
  });

  it("affiche la synthèse Annexe 7 par paire créancier/débiteur, sans netting", async () => {
    mockMonthlyApi(ME_WITH_SYNTH, [company()]);
    renderWithProviders(<MonthlyPage />);

    await waitFor(() => expect(screen.getAllByText('CASH').length).toBeGreaterThan(0));
    expect(screen.getAllByText('SAA').length).toBeGreaterThan(0);
    expect(screen.getByText(/311\s?550/)).toBeInTheDocument();
  });
});
