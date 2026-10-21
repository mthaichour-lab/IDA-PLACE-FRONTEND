import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommissionCase, MeResponse, Sanction } from '@/lib/types';
import { FetchRequest, mockFetchRequests, renderWithProviders } from '@/test/render';
import CommissionPage from './page';

/**
 * SEC-32 — écran 7 : sanctions à deux signatures (statut A_CONTRESIGNER →
 * PRONONCEE, action « Contresigner »), PV signé par un autre membre que
 * l'auteur du prononcé (référence générée par le serveur), codes 409 traduits.
 */

const MEMBRE: MeResponse = { user: { id: 'u-m2', name: 'Membre 2', email: 'm2@uar.dz' }, role: 'MEMBRE_COMMISSION', privileges: ['sanction', 'penaltyOrder', 'pvSign', 'decide'] };
const CORRESPONDANT: MeResponse = { user: { id: 'u-c', name: 'Corr.', email: 'c@caat.dz' }, role: 'CORRESPONDANT_IDA', privileges: ['exchange'], company: 'CAAT' };

function kase(overrides: Partial<CommissionCase> = {}): CommissionCase {
  return {
    id: 'cc-1',
    reference: 'CSC-2026-011',
    recoursId: 'r-1',
    claimId: 'c-1',
    companyA: 'CAAT',
    companyB: 'SAA',
    amount: 300_000,
    motif: 'Désaccord',
    status: 'PRONONCE',
    scheduledAt: '2026-10-20T08:00:00.000Z',
    createdAt: '2026-10-01T08:00:00.000Z',
    ...overrides,
  };
}

const PENDING: Sanction = {
  id: 'san-1',
  commissionCaseId: 'cc-1',
  companyCode: 'SAA',
  type: 'PENALITE_FINANCIERE',
  amount: 25_000,
  reason: 'Retard de réponse',
  orderedAt: '2026-10-18T08:00:00.000Z',
  orderedBy: 'Membre 1',
  status: 'A_CONTRESIGNER',
};
const DONE: Sanction = { ...PENDING, id: 'san-2', reason: 'Avertissement', type: 'AVERTISSEMENT', amount: undefined, status: 'PRONONCEE', countersignedBy: 'Membre 3' };

function mockApi(me: MeResponse, cases: CommissionCase[], handlers: { countersign?: () => { status?: number; body: unknown }; pvSign?: () => { status?: number; body: unknown } } = {}) {
  const requests: FetchRequest[] = [];
  mockFetchRequests((req) => {
    requests.push(req);
    if (req.method === 'POST' && req.pathname === '/api/v1/commission/sanctions/san-1/countersign') return handlers.countersign ? handlers.countersign() : { body: { ...PENDING, status: 'PRONONCEE' } };
    if (req.method === 'POST' && req.pathname.startsWith('/api/v1/commission/cases/') && req.pathname.endsWith('/pv-sign')) return handlers.pvSign ? handlers.pvSign() : { body: { ...cases[0], pv: { signedBy: 'Membre 2', signedAt: '2026-10-19T08:00:00.000Z', ref: 'PV-cc-1' } } };
    switch (req.pathname) {
      case '/api/v1/me':
        return { body: me };
      case '/api/v1/commission/summary':
        return { body: { pendingCount: 0, overdue15dCount: 0, recoursFondesCount: 0, oppositionsFondeesCount: 0 } };
      case '/api/v1/commission/cases':
        return { body: { page: 1, total: cases.length, items: cases } };
      case '/api/v1/commission/sanctions':
        return { body: { page: 1, total: 2, items: [PENDING, DONE] } };
      case '/api/v1/documents':
        return { body: [] };
      default:
        return undefined;
    }
  });
  return requests;
}

describe('Écran 7 — contreseing des sanctions et PV à quatre yeux (SEC-32)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('onglet Sanctions : statut affiché, « Contresigner » sur les seules sanctions à contresigner', async () => {
    const requests = mockApi(MEMBRE, [kase()]);
    renderWithProviders(<CommissionPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('tab', { name: /Sanctions/ }));
    const pendingRow = (await screen.findByText('Retard de réponse')).closest('tr')!;
    const doneRow = screen.getByText('Avertissement').closest('tr')!;
    expect(within(pendingRow).getByText('À contresigner')).toBeInTheDocument();
    expect(within(doneRow).getByText('Prononcée')).toBeInTheDocument();
    expect(within(doneRow).getByText('Contresignée par Membre 3')).toBeInTheDocument();
    expect(within(doneRow).queryByRole('button', { name: 'Contresigner' })).not.toBeInTheDocument();

    await user.click(within(pendingRow).getByRole('button', { name: 'Contresigner' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'POST' && r.pathname.endsWith('/san-1/countersign'))).toBe(true));
    expect(await screen.findByText('Sanction contresignée : elle est prononcée.')).toBeInTheDocument();
  });

  it('409 FOUR_EYES au contreseing : message traduit', async () => {
    mockApi(MEMBRE, [kase()], { countersign: () => ({ status: 409, body: { code: 'FOUR_EYES', message: 'x' } }) });
    renderWithProviders(<CommissionPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('tab', { name: /Sanctions/ }));
    await user.click(await screen.findByRole('button', { name: 'Contresigner' }));
    expect(await screen.findByText('Règle des quatre yeux : cette action doit être accomplie par un autre membre que l’auteur.')).toBeInTheDocument();
  });

  it('rôle compagnie : aucune action de contreseing', async () => {
    mockApi(CORRESPONDANT, [kase()]);
    renderWithProviders(<CommissionPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('tab', { name: /Sanctions/ }));
    await screen.findByText('Retard de réponse');
    expect(screen.queryByRole('button', { name: 'Contresigner' })).not.toBeInTheDocument();
  });

  it('PV : désactivé avant le prononcé ; après, signature sans `ref` et 409 FOUR_EYES traduit', async () => {
    const requests = mockApi(MEMBRE, [kase({ status: 'EN_DELIBERE' }), kase({ id: 'cc-2', recoursId: 'r-2' })], {
      pvSign: () => ({ status: 409, body: { code: 'FOUR_EYES', message: 'x' } }),
    });
    renderWithProviders(<CommissionPage />);
    const user = userEvent.setup();

    await user.click((await screen.findByText('r-1')).closest('tr')!);
    expect(await screen.findByRole('button', { name: 'Signer le PV' })).toBeDisabled();
    expect(screen.getByText('Le PV ne peut être signé qu’après le prononcé de la décision.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prononcer' })).toBeDisabled();
    expect(screen.getByText('Une pénalité exige une décision prononcée dont le PV est signé.')).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click((await screen.findByText('r-2')).closest('tr')!);
    expect(await screen.findByText(/Le PV doit être signé par un autre membre que l’auteur du prononcé/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Signer le PV' }));
    expect(await screen.findByText('Règle des quatre yeux : cette action doit être accomplie par un autre membre que l’auteur.')).toBeInTheDocument();
    expect(requests.find((r) => r.method === 'POST' && r.pathname.endsWith('/pv-sign'))?.body).toEqual({});
  });
});
