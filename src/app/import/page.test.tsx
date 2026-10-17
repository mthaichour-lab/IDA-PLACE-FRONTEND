import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mockFetchRouter, renderWithProviders } from '@/test/render';
import { ClaimColumnDef, MeResponse } from '@/lib/types';
import ImportPage from './page';

const COLUMNS: ClaimColumnDef[] = [{ index: 1, key: 'numEconstat', label: "N° e-constat", group: 'IDENTIFICATION', type: 'string' }];

const ME_WITH_IMPORT: MeResponse = {
  user: { id: 'dev-op', name: 'Opérateur Place (dev)', email: 'operateur@finlab.dz' },
  role: 'OPERATEUR_PLACE',
  privileges: ['import'],
};

const ME_WITHOUT_IMPORT: MeResponse = {
  user: { id: 'dev-tresorier', name: 'Trésorier (dev)', email: 'tresorier@compagnie.dz' },
  role: 'TRESORIER',
  privileges: ['pay', 'bill', 'synth'],
  company: 'COMP-0001',
};

/**
 * Écran Import des dossiers (/import, écran 3) — conformité C.1/C.2.6 :
 * "zéro règle métier côté front" se traduit ici par un affichage
 * conditionnel piloté PAR L'API (`privileges[]` renvoyé par `GET /me`),
 * jamais par une règle d'autorisation recodée dans le composant.
 */
describe('Écran Import des dossiers (/import) — affichage conditionnel par privilège', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("masque la zone de dépôt et affiche le message d'accès réservé sans le privilège 'import'", async () => {
    mockFetchRouter((pathname) => {
      if (pathname === '/api/v1/me') return ME_WITHOUT_IMPORT;
      if (pathname === '/api/v1/claims/import/columns') return COLUMNS;
      return undefined;
    });

    renderWithProviders(<ImportPage />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /choisir le fichier/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/déposez votre fichier/i)).not.toBeInTheDocument();
  });

  it("affiche la zone de dépôt (drag-drop + bouton) avec le privilège 'import'", async () => {
    mockFetchRouter((pathname) => {
      if (pathname === '/api/v1/me') return ME_WITH_IMPORT;
      if (pathname === '/api/v1/claims/import/columns') return COLUMNS;
      return undefined;
    });

    renderWithProviders(<ImportPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: /choisir le fichier/i })).toBeInTheDocument());
    expect(screen.getByLabelText(/déposez votre fichier/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('la zone de dépôt est accessible au clavier (role=button + tabIndex, A.5)', async () => {
    mockFetchRouter((pathname) => {
      if (pathname === '/api/v1/me') return ME_WITH_IMPORT;
      if (pathname === '/api/v1/claims/import/columns') return COLUMNS;
      return undefined;
    });

    renderWithProviders(<ImportPage />);
    const dropzone = await screen.findByLabelText(/déposez votre fichier/i);
    expect(dropzone).toHaveAttribute('tabindex', '0');
    expect(dropzone).toHaveAttribute('role', 'button');
  });

  it('le journal est vide tant qu\'aucun import n\'a été effectué dans la session', async () => {
    mockFetchRouter((pathname) => {
      if (pathname === '/api/v1/me') return ME_WITH_IMPORT;
      if (pathname === '/api/v1/claims/import/columns') return COLUMNS;
      return undefined;
    });

    renderWithProviders(<ImportPage />);
    await waitFor(() => expect(screen.getByText(/aucun import effectué/i)).toBeInTheDocument());
  });
});
