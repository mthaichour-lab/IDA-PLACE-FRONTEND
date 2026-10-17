import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mockFetchRouter, renderWithProviders } from '@/test/render';
import { CommissionCase, CommissionPenaltyResult, MeResponse } from '@/lib/types';
import CommissionPage from './page';

const ME_WITH_BOTH: MeResponse = {
  user: { id: 'dev-commission', name: 'Membre Commission (dev)', email: 'commission@uar.dz' },
  role: 'MEMBRE_COMMISSION',
  privileges: ['penaltyOrder', 'pvSign'],
};

const ME_WITHOUT_PENALTY: MeResponse = {
  user: { id: 'dev-auditeur', name: 'Auditeur CSA (dev)', email: 'auditeur@csa.dz' },
  role: 'AUDITEUR_CSA',
  privileges: [],
};

function commissionCase(overrides: Partial<CommissionCase> = {}): CommissionCase {
  return {
    id: 'cc-1',
    recoursId: 'r-1',
    claimId: 'c-1',
    companyA: 'CAAT',
    companyB: 'SAA',
    amount: 300_000,
    motif: 'Désaccord sur la responsabilité',
    status: 'EN_DELIBERE',
    scheduledAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function mockCommissionApi(me: MeResponse, cases: CommissionCase[], onPenalty?: (id: string) => CommissionPenaltyResult) {
  mockFetchRouter((pathname) => {
    if (pathname === '/api/v1/me') return me;
    if (pathname === '/api/v1/commission/cases') return { page: 1, total: cases.length, items: cases };
    const penaltyMatch = /^\/api\/v1\/commission\/cases\/(.+)\/penalty$/.exec(pathname);
    if (penaltyMatch && onPenalty) return onPenalty(penaltyMatch[1]);
    const pvMatch = /^\/api\/v1\/commission\/cases\/(.+)\/pv-sign$/.exec(pathname);
    if (pvMatch) return { ...cases.find((c) => c.id === pvMatch[1])!, pv: { signedBy: 'dev-commission', signedAt: new Date().toISOString(), ref: 'PV-2026-1' } };
    return undefined;
  });
}

/**
 * Écran Commission (/commission, écran 7, Module E §6.7) — prononcé de
 * pénalité (privilège `penaltyOrder`) et signature du PV (privilège
 * `pvSign`), tous deux refusables indépendamment (B.7).
 */
describe('Écran Commission (/commission)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('affiche la file des dossiers en commission avec leur statut', async () => {
    mockCommissionApi(ME_WITH_BOTH, [commissionCase()]);
    renderWithProviders(<CommissionPage />);

    await waitFor(() => expect(screen.getByText('r-1')).toBeInTheDocument());
    expect(screen.getByText('En délibéré')).toBeInTheDocument();
  });

  it("refuse le prononcé d'une pénalité et la signature du PV pour AUDITEUR_CSA (lecture seule, B.7)", async () => {
    mockCommissionApi(ME_WITHOUT_PENALTY, [commissionCase()]);
    renderWithProviders(<CommissionPage />);

    await waitFor(() => expect(screen.getByText('r-1')).toBeInTheDocument());
    fireEvent.click(screen.getByText('r-1').closest('tr')!);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Prononcer' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Signer le PV' })).toBeDisabled();
    expect(screen.getByText(/n'avez pas le privilège requis \(penaltyOrder\)/)).toBeInTheDocument();
  });

  it('prononce une pénalité et affiche le toast de confirmation', async () => {
    mockCommissionApi(ME_WITH_BOTH, [commissionCase()], (id) => ({ id: 'pen-1', commissionCaseId: id, companyCode: 'CAAT', type: 'FINANCIERE', amount: 50_000, reason: 'Retard', orderedAt: new Date().toISOString(), orderedBy: 'dev-commission' }));
    renderWithProviders(<CommissionPage />);

    await waitFor(() => expect(screen.getByText('r-1')).toBeInTheDocument());
    fireEvent.click(screen.getByText('r-1').closest('tr')!);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Prononcer' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Montant (DA)'), { target: { value: '50000' } });
    fireEvent.change(screen.getByLabelText('Motif'), { target: { value: 'Retard' } });
    fireEvent.click(screen.getByRole('button', { name: 'Prononcer' }));

    await waitFor(() => expect(screen.getByText('Pénalité prononcée.')).toBeInTheDocument());
  });
});
