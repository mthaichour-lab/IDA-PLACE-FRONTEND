import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeResponse, RecoursItem } from '@/lib/types';
import { FetchRequest, mockFetchRequests, renderWithProviders } from '@/test/render';
import { NewRecoursDialog } from './NewRecoursDialog';

/**
 * Ouverture d'un recours — Annexe 2 (`POST /recours`). Seuls les dossiers
 * recevables de la compagnie demanderesse sont proposés ; le montant est
 * pré-rempli et plafonné au montant du dossier.
 */

const ME: MeResponse = { user: { id: 'u-cash', name: 'Correspondant CASH', email: 'c@cash.dz' }, role: 'CORRESPONDANT_IDA', privileges: ['insert', 'exchange'], company: 'CASH' };

const ELIGIBLE = { id: 'clm-ok', numEconstat: 'EC-2026-781201', company: 'CASH', counterpartyCompany: 'CAAR', accidentDate: '2026-10-20', estimatedAmount: 190_000, expertAmount: 187_500, eligibilityVerdict: 'ELIGIBLE_IDA' };
const HORS_IDA = { ...ELIGIBLE, id: 'clm-hors', numEconstat: 'EC-HORS-IDA', eligibilityVerdict: 'HORS_IDA' };
const ALREADY_CLAIMED = { ...ELIGIBLE, id: 'clm-deja', numEconstat: 'EC-DEJA-RECOURS' };
const NO_COUNTERPARTY = { ...ELIGIBLE, id: 'clm-seul', numEconstat: 'EC-SANS-TIERS', counterpartyCompany: undefined };

const EXISTING: RecoursItem = {
  id: 'r-old',
  reference: 'REC-2026-00001',
  claimId: 'clm-deja',
  from: 'CASH',
  to: 'CAAR',
  state: 'EN_ATTENTE',
  requestSentAt: '2026-10-01T00:00:00.000Z',
  amount: 10_000,
  createdAt: '2026-10-01T00:00:00.000Z',
  timer: { timerType: 'AUCUN', remainingDays: 0, expired: false },
};

function mockApi() {
  const writes: FetchRequest[] = [];
  mockFetchRequests((req) => {
    if (req.method === 'POST' && req.pathname === '/api/v1/recours') {
      writes.push(req);
      return { body: { ...EXISTING, id: 'r-new', reference: 'REC-2026-00075', claimId: 'clm-ok', amount: 187_500 } };
    }
    if (req.pathname === '/api/v1/me') return { body: ME };
    if (req.pathname === '/api/v1/claims') return { body: { page: 1, total: 4, items: [ELIGIBLE, HORS_IDA, ALREADY_CLAIMED, NO_COUNTERPARTY] } };
    if (req.pathname === '/api/v1/recours') return { body: { page: 1, total: 1, items: [EXISTING] } };
    if (req.pathname === '/api/v1/referential/companies') return { body: { page: 1, total: 0, items: [] } };
    return undefined;
  });
  return writes;
}

describe('NewRecoursDialog — Annexe 2', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ne propose que les dossiers recevables et envoie la demande contre la partie tierce', async () => {
    const writes = mockApi();
    const onCreated = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(<NewRecoursDialog open onClose={onClose} onCreated={onCreated} companies={[]} />);
    const user = userEvent.setup();

    const select = await screen.findByLabelText('Dossier');
    await waitFor(() => expect(screen.getByRole('option', { name: /EC-2026-781201/ })).toBeInTheDocument());
    expect(screen.queryByRole('option', { name: /EC-HORS-IDA/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /EC-DEJA-RECOURS/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /EC-SANS-TIERS/ })).not.toBeInTheDocument();

    await user.selectOptions(select, 'clm-ok');
    const amount = screen.getByLabelText('Montant réclamé (DA)') as HTMLInputElement;
    // Montant expertisé prioritaire sur l'estimé (même règle que le back).
    expect(amount.value).toBe('187500');

    const submit = screen.getByRole('button', { name: 'Envoyer la demande' });
    await user.clear(amount);
    await user.type(amount, '200000');
    expect(submit).toBeDisabled();

    await user.clear(amount);
    await user.type(amount, '187500');
    await user.click(submit);

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toEqual({ claimId: 'clm-ok', from: 'CASH', to: 'CAAR', amount: 187_500 });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ reference: 'REC-2026-00075' })));
    expect(onClose).toHaveBeenCalled();
  });
});
