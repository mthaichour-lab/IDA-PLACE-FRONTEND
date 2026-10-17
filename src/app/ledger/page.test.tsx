import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mockFetchJson, renderWithProviders } from '@/test/render';
import { LedgerEntry, LedgerVerifyResult, MeResponse } from '@/lib/types';
import LedgerPage from './page';

const ME: MeResponse = {
  user: { id: 'dev-auditeur', name: 'Auditeur CSA (dev)', email: 'auditeur@csa.dz' },
  role: 'AUDITEUR_CSA',
  privileges: [],
};

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: 'le-1',
    type: 'RECOURS_TRANSITION',
    ref: 'r-1',
    actor: 'dev-op',
    summary: 'Transition recours',
    at: new Date().toISOString(),
    hash: '11112222333344445555666677778888',
    prevHash: null,
    ...overrides,
  };
}

/**
 * Écran Journal scellé (/ledger, écran 13, Module XI) — chaînage SHA-256
 * append-only, vérification d'intégrité affichée dans l'en-tête, export CSV
 * côté front (placeholder documenté, aucun endpoint d'export côté API).
 */
describe('Écran Journal scellé (/ledger)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('affiche les entrées du journal avec leur empreinte tronquée', async () => {
    mockFetchJson({ '/api/v1/me': ME, '/api/v1/ledger': [entry()], '/api/v1/ledger/verify': { valid: true } as LedgerVerifyResult });

    renderWithProviders(<LedgerPage />);

    await waitFor(() => expect(screen.getByText('r-1')).toBeInTheDocument());
    expect(screen.getByText('11112222…77778888')).toBeInTheDocument();
  });

  it("affiche l'état d'intégrité du chaînage (chaîne intègre)", async () => {
    mockFetchJson({ '/api/v1/me': ME, '/api/v1/ledger': [entry()], '/api/v1/ledger/verify': { valid: true } as LedgerVerifyResult });

    renderWithProviders(<LedgerPage />);

    await waitFor(() => expect(screen.getByText('Chaîne intègre')).toBeInTheDocument());
  });

  it("signale une chaîne rompue avec sa référence quand l'API le rapporte", async () => {
    mockFetchJson({ '/api/v1/me': ME, '/api/v1/ledger': [entry()], '/api/v1/ledger/verify': { valid: false, brokenAt: 'le-7' } as LedgerVerifyResult });

    renderWithProviders(<LedgerPage />);

    await waitFor(() => expect(screen.getByText(/Chaîne rompue \(le-7\)/)).toBeInTheDocument());
  });

  it("désactive l'export quand le journal est vide", async () => {
    mockFetchJson({ '/api/v1/me': ME, '/api/v1/ledger': [], '/api/v1/ledger/verify': { valid: true } as LedgerVerifyResult });

    renderWithProviders(<LedgerPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Exporter le journal' })).toBeDisabled());
  });
});
