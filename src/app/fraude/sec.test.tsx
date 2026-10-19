import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FraudCase, FraudCasesPage, MeResponse } from '@/lib/types';
import { renderWithProviders } from '@/test/render';
import FraudePage from './page';

/**
 * SEC-21 / SEC-26 / SEC-36 — écran 9 : journal des actions suspectes réservé
 * aux rôles place (403 pour un rôle compagnie → onglet masqué, aucun appel),
 * parties adverses seulement dénombrées, analyse tronquée signalée.
 */

const CORRESPONDANT: MeResponse = { user: { id: 'u-c', name: 'Corr.', email: 'c@caat.dz' }, role: 'CORRESPONDANT_IDA', privileges: [], company: 'CAAT' };
const OPERATEUR: MeResponse = { user: { id: 'u-op', name: 'Op.', email: 'op@uar.dz' }, role: 'OPERATEUR_PLACE', privileges: [] };

const CASE: FraudCase = {
  id: 'fc-1',
  type: 'RECURRENCE_VEHICULE',
  score: 85,
  severity: 'ELEVEE',
  claimIds: ['c-own'],
  companiesInvolved: ['CAAT'],
  details: {},
  detectedAt: '2026-10-19T08:00:00.000Z',
  plateA: '16001-120-16',
  counterpartClaims: 2,
  counterpartCompanies: 1,
};

function mockApi(me: MeResponse, page: Partial<FraudCasesPage> = {}) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      calls.push(url.pathname);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (url.pathname === '/api/v1/me') return json(me);
      if (url.pathname === '/api/v1/fraud/cases') return json({ page: 1, total: 1, items: [CASE], analysis: { claimsAnalyzed: 0, truncated: false }, ...page });
      if (url.pathname === '/api/v1/fraud/actions') return me.company ? json({ code: 'FORBIDDEN', message: 'Réservé' }, 403) : json({ page: 1, total: 0, items: [] });
      if (url.pathname === '/api/v1/fraud/adherents/CAAT/signals') return json([]);
      return json({ code: 'NOT_FOUND', message: `Non mocké: ${url.pathname}` }, 404);
    }),
  );
  return calls;
}

describe('Écran 9 — rôles compagnie et couverture de l’analyse', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('SEC-21 : rôle compagnie — journal des actions masqué et jamais appelé', async () => {
    const calls = mockApi(CORRESPONDANT);
    renderWithProviders(<FraudePage />);

    await screen.findByText('16001-120-16');
    expect(screen.queryByText(/Journal des actions suspectes|Actions suspectes/)).not.toBeInTheDocument();
    expect(screen.queryByText('Adhérents concernés')).not.toBeInTheDocument();
    expect(calls).not.toContain('/api/v1/fraud/actions');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('SEC-26 : rôle compagnie — autres parties seulement dénombrées (colonne et panneau), signaux de SA compagnie', async () => {
    const calls = mockApi(CORRESPONDANT);
    renderWithProviders(<FraudePage />);

    expect(await screen.findByText('Autres parties')).toBeInTheDocument();
    expect(screen.getByText(/2 dossier\(s\) d’autres compagnies · 1 autre\(s\) compagnie\(s\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('16001-120-16'));
    expect(await screen.findByText(/Parties non publiées/)).toBeInTheDocument();
    await waitFor(() => expect(calls).toContain('/api/v1/fraud/adherents/CAAT/signals'));
  });

  it('rôle place : journal des actions affiché', async () => {
    const calls = mockApi(OPERATEUR);
    renderWithProviders(<FraudePage />);

    await screen.findByText('Actions suspectes');
    await waitFor(() => expect(calls).toContain('/api/v1/fraud/actions'));
    expect(screen.queryByText('Autres parties')).not.toBeInTheDocument();
  });

  it('SEC-36 : analysis.truncated → avertissement de couverture partielle', async () => {
    mockApi(OPERATEUR, { analysis: { claimsAnalyzed: 50000, truncated: true } });
    renderWithProviders(<FraudePage />);

    expect(await screen.findByText(/Analyse anti-fraude limitée aux dossiers les plus récents/)).toHaveTextContent('50000 dossiers analysés');
  });
});
