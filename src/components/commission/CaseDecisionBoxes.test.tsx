import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommissionSeizure } from '@/app/exchanges/CommissionSeizure';
import { CommissionCase, MeResponse, RecoursItem } from '@/lib/types';
import { FetchRequest, mockFetchRequests, renderWithProviders } from '@/test/render';
import { DecisionBox, SanctionBox } from './CaseDecisionBoxes';

/**
 * Commission (Art. 24) : saisine depuis le recours, délibéré, prononcé et
 * proposition de sanction — chaque bouton n'appelle que la route réelle,
 * avec le corps attendu par le DTO back.
 */

const OPERATEUR: MeResponse = { user: { id: 'u-op', name: 'Opérateur', email: 'op@finlab.dz' }, role: 'OPERATEUR_PLACE', privileges: ['decide', 'sanction', 'exchange'] };
const CORRESPONDANT: MeResponse = { user: { id: 'u-cash', name: 'Correspondant CASH', email: 'c@cash.dz' }, role: 'CORRESPONDANT_IDA', privileges: ['exchange'], company: 'CASH' };

const CASE: CommissionCase = {
  id: 'case-1',
  reference: 'CSC-2026-013',
  recoursId: 'r-1',
  recoursReference: 'REC-2026-00075',
  claimId: 'clm-1',
  companyA: 'CASH',
  companyB: 'CAAR',
  amount: 187_500,
  motif: 'Litige sur la garantie',
  status: 'A_INSTRUIRE',
  scheduledAt: '2026-11-05T09:00:00.000Z',
  createdAt: '2026-10-22T08:00:00.000Z',
};

const RECOURS: RecoursItem = {
  id: 'r-1',
  reference: 'REC-2026-00075',
  claimId: 'clm-1',
  from: 'CASH',
  to: 'CAAR',
  state: 'COMMISSION',
  requestSentAt: '2026-10-22T07:49:00.000Z',
  amount: 187_500,
  createdAt: '2026-10-22T07:49:00.000Z',
  timer: { timerType: 'AUCUN', remainingDays: 0, expired: false },
};

function mockApi(me: MeResponse, cases: CommissionCase[] = []) {
  const writes: FetchRequest[] = [];
  mockFetchRequests((req) => {
    if (req.method === 'POST') {
      writes.push(req);
      if (req.pathname.endsWith('/deliberate')) return { body: { ...CASE, status: 'EN_DELIBERE' } };
      if (req.pathname.endsWith('/decide')) return { body: { ...CASE, status: 'PRONONCE', decision: { outcome: 'RECOURS_FONDE' } } };
      if (req.pathname.endsWith('/sanction')) return { body: { id: 's-1', companyCode: 'CAAR', type: 'AVERTISSEMENT', reason: 'x', orderedAt: '', orderedBy: 'Opérateur', status: 'A_CONTRESIGNER' } };
      return { body: CASE };
    }
    if (req.pathname === '/api/v1/me') return { body: me };
    if (req.pathname === '/api/v1/commission/cases') return { body: { page: 1, total: cases.length, items: cases } };
    return undefined;
  });
  return writes;
}

describe('Saisine de la Commission depuis le recours', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sans dossier existant : envoie `{recoursId, motif}` à POST /commission/cases', async () => {
    const writes = mockApi(CORRESPONDANT);
    renderWithProviders(<CommissionSeizure recours={RECOURS} />);
    const user = userEvent.setup();

    const submit = await screen.findByRole('button', { name: 'Saisir la Commission' });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText('Motif de la saisine'), 'Litige sur la garantie');
    await user.click(submit);

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].pathname).toBe('/api/v1/commission/cases');
    expect(writes[0].body).toEqual({ recoursId: 'r-1', motif: 'Litige sur la garantie' });
  });

  it('dossier déjà ouvert : affiche sa référence, sans formulaire', async () => {
    mockApi(CORRESPONDANT, [CASE]);
    renderWithProviders(<CommissionSeizure recours={RECOURS} />);
    expect(await screen.findByText('CSC-2026-013')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Saisir la Commission' })).not.toBeInTheDocument();
  });
});

describe('Délibéré et décision', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('A_INSTRUIRE : « Mettre en délibéré » appelle /deliberate', async () => {
    const writes = mockApi(OPERATEUR);
    const onUpdated = vi.fn();
    renderWithProviders(<DecisionBox commissionCase={CASE} onUpdated={onUpdated} />);
    const user = userEvent.setup();

    const btn = await screen.findByRole('button', { name: 'Mettre en délibéré' });
    await waitFor(() => expect(btn).toBeEnabled());
    await user.click(btn);
    await waitFor(() => expect(writes.map((w) => w.pathname)).toEqual(['/api/v1/commission/cases/case-1/deliberate']));
    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ status: 'EN_DELIBERE' })));
  });

  it('EN_DELIBERE : la décision exige un sens, puis envoie `{outcome, motif}`', async () => {
    const writes = mockApi(OPERATEUR);
    renderWithProviders(<DecisionBox commissionCase={{ ...CASE, status: 'EN_DELIBERE' }} onUpdated={vi.fn()} />);
    const user = userEvent.setup();

    const submit = await screen.findByRole('button', { name: 'Prononcer la décision' });
    expect(submit).toBeDisabled();
    await user.click(await screen.findByRole('radio', { name: 'Recours fondé' }));
    await user.type(screen.getByLabelText('Motivation (optionnelle)'), 'Garantie établie');
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].pathname).toBe('/api/v1/commission/cases/case-1/decide');
    expect(writes[0].body).toEqual({ outcome: 'RECOURS_FONDE', motif: 'Garantie établie' });
  });

  it('profil compagnie : actions désactivées et motif affiché', async () => {
    mockApi(CORRESPONDANT);
    renderWithProviders(<DecisionBox commissionCase={CASE} onUpdated={vi.fn()} />);
    expect(await screen.findByText(/privilège requis \(decide\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mettre en délibéré' })).toBeDisabled();
  });
});

describe('Proposition de sanction', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('exige un PV signé', async () => {
    mockApi(OPERATEUR);
    renderWithProviders(<SanctionBox commissionCase={{ ...CASE, status: 'PRONONCE' }} />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Motif'), 'Opposition non fondée');
    expect(screen.getByRole('button', { name: 'Proposer la sanction' })).toBeDisabled();
  });

  it('PV signé : envoie `{companyCode, type, reason}` à /sanction', async () => {
    const writes = mockApi(OPERATEUR);
    renderWithProviders(<SanctionBox commissionCase={{ ...CASE, status: 'PRONONCE', pv: { signedBy: 'Admin FinLab', signedAt: '2026-10-22T08:16:00.000Z', ref: 'PV-CSC-2026-013' } }} />);
    const user = userEvent.setup();

    const company = await screen.findByLabelText('Compagnie sanctionnée');
    await waitFor(() => expect(company).toBeEnabled());
    await user.selectOptions(company, 'B');
    await user.selectOptions(screen.getByLabelText('Mesure'), 'AVERTISSEMENT');
    await user.type(screen.getByLabelText('Motif'), 'Opposition non fondée');
    const submit = screen.getByRole('button', { name: 'Proposer la sanction' });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].pathname).toBe('/api/v1/commission/cases/case-1/sanction');
    expect(writes[0].body).toEqual({ companyCode: 'CAAR', type: 'AVERTISSEMENT', reason: 'Opposition non fondée' });
  });
});
