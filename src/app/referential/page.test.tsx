import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mockFetchRouter, renderWithProviders } from '@/test/render';
import { CompanyView, MeResponse } from '@/lib/types';
import ReferentialPage from './page';

function company(i: number): CompanyView {
  return {
    id: `c-${i}`,
    code: `C${String(i).padStart(3, '0')}`,
    name: `Compagnie ${i}`,
    color: '#112233',
    kind: 'INSURER',
    feedMode: 'API',
    status: 'ACTIF',
    apiKeyMasked: 'sk_live_•••••0000',
  };
}

const ME_OPERATEUR: MeResponse = {
  user: { id: 'dev-op', name: 'Opérateur Place (dev)', email: 'operateur@finlab.dz' },
  role: 'OPERATEUR_PLACE',
  privileges: ['admin', 'refedit'],
};

describe('Écran Référentiel de place (/referential)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('affiche la pagination 7 lignes/page et la respecte (A.5)', async () => {
    const allCompanies = Array.from({ length: 9 }, (_, i) => company(i + 1));
    mockFetchRouter((pathname, url) => {
      if (pathname === '/api/v1/me') return ME_OPERATEUR;
      if (pathname === '/api/v1/referential/companies') {
        const page = Number(url.searchParams.get('page') ?? '1');
        const pageSize = Number(url.searchParams.get('pageSize') ?? '7');
        const start = (page - 1) * pageSize;
        return { page, total: allCompanies.length, items: allCompanies.slice(start, start + pageSize) };
      }
      if (pathname === '/api/v1/referential/agencies') return { page: 1, total: 0, items: [] };
      if (pathname === '/api/v1/referential/experts') return { page: 1, total: 0, items: [] };
      return undefined;
    });

    renderWithProviders(<ReferentialPage />);

    // Page 1 : exactement 7 lignes (sur 9 compagnies au total).
    await waitFor(() => expect(screen.getByText('Compagnie 1')).toBeInTheDocument());
    expect(screen.getByText('Compagnie 7')).toBeInTheDocument();
    expect(screen.queryByText('Compagnie 8')).not.toBeInTheDocument();

    const rows = screen.getAllByRole('row'); // 1 ligne d'en-tête + 7 lignes de données
    expect(rows).toHaveLength(8);

    // Navigation vers la page 2 : les 2 compagnies restantes.
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /suivant|next/i }));

    await waitFor(() => expect(screen.getByText('Compagnie 8')).toBeInTheDocument());
    expect(screen.getByText('Compagnie 9')).toBeInTheDocument();
    expect(screen.queryByText('Compagnie 1')).not.toBeInTheDocument();
  });

  it('ne restitue jamais la clé API en clair, seulement apiKeyMasked', async () => {
    mockFetchRouter((pathname) => {
      if (pathname === '/api/v1/me') return ME_OPERATEUR;
      if (pathname === '/api/v1/referential/companies') return { page: 1, total: 1, items: [company(1)] };
      if (pathname === '/api/v1/referential/agencies') return { page: 1, total: 0, items: [] };
      if (pathname === '/api/v1/referential/experts') return { page: 1, total: 0, items: [] };
      return undefined;
    });

    renderWithProviders(<ReferentialPage />);
    await waitFor(() => expect(screen.getByText('Compagnie 1')).toBeInTheDocument());
    expect(screen.queryByText(/sk_live_(?!•)/)).not.toBeInTheDocument();
  });

  it('bascule entre les onglets Compagnies/Agences/Experts (role=tablist / role=tab, A.5 accessibilité)', async () => {
    mockFetchRouter((pathname) => {
      if (pathname === '/api/v1/me') return ME_OPERATEUR;
      if (pathname === '/api/v1/referential/companies') return { page: 1, total: 1, items: [company(1)] };
      if (pathname === '/api/v1/referential/agencies') return { page: 1, total: 0, items: [] };
      if (pathname === '/api/v1/referential/experts') return { page: 1, total: 0, items: [] };
      return undefined;
    });

    renderWithProviders(<ReferentialPage />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /experts/i }));
    expect(screen.getByRole('tab', { name: /experts/i })).toHaveAttribute('aria-selected', 'true');
  });
});
