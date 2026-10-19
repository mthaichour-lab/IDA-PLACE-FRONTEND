import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeResponse } from '@/lib/types';
import { renderWithProviders } from '@/test/render';
import LedgerPage from '../ledger/page';
import CockpitPage from './page';

/**
 * SEC-05 / SEC-21 — le cockpit et le journal scellé sont réservés aux rôles
 * de la place (403 pour un rôle compagnie) : l'écran l'explique au lieu
 * d'afficher une erreur « Réessayer », et n'appelle pas l'API.
 */

const CORRESPONDANT: MeResponse = { user: { id: 'u-c', name: 'Corr.', email: 'c@caat.dz' }, role: 'CORRESPONDANT_IDA', privileges: [], company: 'CAAT' };

function mockApi() {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      calls.push(url.pathname);
      if (url.pathname === '/api/v1/me') return new Response(JSON.stringify(CORRESPONDANT), { status: 200 });
      return new Response(JSON.stringify({ code: 'FORBIDDEN', message: 'Accès refusé.' }), { status: 403 });
    }),
  );
  return calls;
}

describe('Écrans réservés à la place — rôle compagnie', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['Cockpit', CockpitPage, 'Cockpit de place', ['/api/v1/cockpit/summary']],
    ['Journal scellé', LedgerPage, 'Journal scellé', ['/api/v1/ledger', '/api/v1/ledger/verify']],
  ] as const)('%s : notice « accès réservé », aucun appel à l’API de l’écran', async (_name, Page, title, routes) => {
    const calls = mockApi();
    renderWithProviders(<Page />);

    expect(await screen.findByText(/réservé aux rôles de la place/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    for (const route of routes) expect(calls).not.toContain(route);
  });
});
