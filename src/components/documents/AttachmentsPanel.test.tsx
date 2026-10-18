import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockFetchRouter, renderWithProviders } from '@/test/render';
import { DocumentView, MeResponse } from '@/lib/types';
import { AttachmentsPanel } from './AttachmentsPanel';

const ME_WITH_INSERT: MeResponse = {
  user: { id: 'dev-correspondant', name: 'Correspondant IDA (dev)', email: 'correspondant@compagnie.dz' },
  role: 'CORRESPONDANT_IDA',
  privileges: ['insert'],
};

const ME_WITHOUT_INSERT: MeResponse = {
  user: { id: 'dev-auditeur', name: 'Auditeur CSA (dev)', email: 'auditeur@csa.dz' },
  role: 'AUDITEUR_CSA',
  privileges: [],
};

function doc(overrides: Partial<DocumentView> = {}): DocumentView {
  return {
    id: 'd-1',
    filename: 'annexe2-recours-r-1.pdf',
    contentType: 'application/pdf',
    sizeBytes: 204_800,
    uploadedBy: 'correspondant@compagnie.dz',
    uploadedAt: new Date('2026-10-18T09:00:00.000Z').toISOString(),
    url: 'https://storage.example/documents/d-1?sig=abc',
    ...overrides,
  };
}

/**
 * Écran AttachmentsPanel — composant transverse (QUESTIONS_UAR.md §9, décision
 * Product Owner 2026-10-18) utilisé par `/exchanges` (écran 4) et
 * `/commission` (écran 7). Ces tests couvrent le composant isolément, avec
 * `recoursId` (le cas `commissionCaseId` suit exactement le même chemin
 * côté `GET /documents`, seul le nom du paramètre de requête change).
 */
describe('AttachmentsPanel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('affiche la liste des pièces jointes avec déposant et date', async () => {
    mockFetchRouter((pathname, url) => {
      if (pathname === '/api/v1/me') return ME_WITH_INSERT;
      if (pathname === '/api/v1/documents' && url.searchParams.get('recoursId') === 'r-1') return [doc()];
      return undefined;
    });
    renderWithProviders(<AttachmentsPanel recoursId="r-1" />);

    await waitFor(() => expect(screen.getByText('annexe2-recours-r-1.pdf')).toBeInTheDocument());
    expect(screen.getByText(/correspondant@compagnie\.dz/)).toBeInTheDocument();
    const link = screen.getByText('annexe2-recours-r-1.pdf').closest('a');
    expect(link).toHaveAttribute('href', 'https://storage.example/documents/d-1?sig=abc');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('affiche un état vide explicite quand aucune pièce jointe n’existe', async () => {
    mockFetchRouter((pathname) => {
      if (pathname === '/api/v1/me') return ME_WITH_INSERT;
      if (pathname === '/api/v1/documents') return [];
      return undefined;
    });
    renderWithProviders(<AttachmentsPanel recoursId="r-1" />);

    await waitFor(() => expect(screen.getByText('Aucune pièce jointe.')).toBeInTheDocument());
  });

  it("masque le contrôle de dépôt pour un utilisateur sans le privilège 'insert'", async () => {
    mockFetchRouter((pathname) => {
      if (pathname === '/api/v1/me') return ME_WITHOUT_INSERT;
      if (pathname === '/api/v1/documents') return [doc()];
      return undefined;
    });
    renderWithProviders(<AttachmentsPanel recoursId="r-1" />);

    await waitFor(() => expect(screen.getByText('annexe2-recours-r-1.pdf')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Déposer la pièce' })).not.toBeInTheDocument();
  });

  it('un dépôt réussi rafraîchit la liste avec la nouvelle pièce', async () => {
    let listCallCount = 0;
    const newDoc = doc({ id: 'd-2', filename: 'annexe3-opposition.pdf' });
    mockFetchRouter((pathname, url) => {
      if (pathname === '/api/v1/me') return ME_WITH_INSERT;
      if (pathname === '/api/v1/documents' && url.searchParams.get('recoursId') === 'r-1') {
        listCallCount += 1;
        return listCallCount === 1 ? [doc()] : [doc(), newDoc];
      }
      if (pathname === '/api/v1/documents/upload') return newDoc;
      return undefined;
    });
    renderWithProviders(<AttachmentsPanel recoursId="r-1" />);

    await waitFor(() => expect(screen.getByText('annexe2-recours-r-1.pdf')).toBeInTheDocument());

    const file = new File(['contenu'], 'annexe3-opposition.pdf', { type: 'application/pdf' });
    const input = screen.getByLabelText(/Ajouter une pièce/);
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Déposer la pièce' }));

    await waitFor(() => expect(screen.getByText('annexe3-opposition.pdf')).toBeInTheDocument());
  });

  it('une erreur 400/403 au dépôt affiche un toast d’erreur sans planter', async () => {
    mockFetchRouter((pathname, url) => {
      if (pathname === '/api/v1/me') return ME_WITH_INSERT;
      if (pathname === '/api/v1/documents' && url.searchParams.get('recoursId') === 'r-1') return [doc()];
      return undefined;
    });
    // Remplace le routeur par défaut pour simuler une 403 sur l'upload précisément.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === 'string' ? input : input.toString());
        if (url.pathname === '/api/v1/me') return new Response(JSON.stringify(ME_WITH_INSERT), { status: 200, headers: { 'Content-Type': 'application/json' } });
        if (url.pathname === '/api/v1/documents') return new Response(JSON.stringify([doc()]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        if (url.pathname === '/api/v1/documents/upload') {
          return new Response(JSON.stringify({ code: 'FORBIDDEN', message: "Vous n'êtes pas partie à ce dossier." }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'Non mocké' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    renderWithProviders(<AttachmentsPanel recoursId="r-1" />);

    await waitFor(() => expect(screen.getByText('annexe2-recours-r-1.pdf')).toBeInTheDocument());

    const file = new File(['contenu'], 'virus.exe', { type: 'application/octet-stream' });
    const input = screen.getByLabelText(/Ajouter une pièce/);
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Déposer la pièce' }));

    await waitFor(() => expect(screen.getByText("Vous n'êtes pas partie à ce dossier.")).toBeInTheDocument());
    // Toujours affichée, pas de plantage du composant après l'échec.
    expect(screen.getByText('annexe2-recours-r-1.pdf')).toBeInTheDocument();
  });
});
