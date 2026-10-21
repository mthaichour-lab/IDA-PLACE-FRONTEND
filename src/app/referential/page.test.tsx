import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mockFetchRouter, renderWithProviders } from '@/test/render';
import { CompanyView, ConstatCircumstance, ConventionParams, EligibilityMotif, MeResponse, OppositionMotif, PlaceCalendar } from '@/lib/types';
import ReferentialPage from './page';

function company(i: number, overrides: Partial<CompanyView> = {}): CompanyView {
  return {
    id: `c-${i}`,
    code: `C${String(i).padStart(3, '0')}`,
    name: `Compagnie ${i}`,
    color: '#112233',
    kind: 'INSURER',
    feedMode: 'API',
    status: 'ACTIF',
    apiKeyMasked: 'sk_live_•••••0000',
    createdAt: '2025-12-15T00:00:00.000Z',
    agencyCounts: { DG: 1, DR: 3, AG: 8 },
    ...overrides,
  };
}

const CONVENTION: ConventionParams = {
  version: '2025.12-v1',
  silenceDays: 10,
  oppositionDays: 15,
  forclusionMonths: 6,
  maxAmountDA: 500_000,
};

const YEAR = new Date().getUTCFullYear();

const CALENDAR: PlaceCalendar = {
  weekendDays: ['FRIDAY', 'SATURDAY'],
  fixedHolidays: [
    { date: `${YEAR}-01-01`, label: "Jour de l'an" },
    { date: `${YEAR}-05-01`, label: 'Fête du travail' },
  ],
  holidays: [
    { date: `${YEAR}-01-01`, label: "Jour de l'an", type: 'FIXE', status: 'LEGAL' },
    { date: `${YEAR}-05-01`, label: 'Fête du travail', type: 'FIXE', status: 'LEGAL' },
  ],
};

const MOTIFS: EligibilityMotif[] = [
  { article: 'Art. 4', label: 'Nombre de véhicules impliqués ≠ 2' },
  { article: 'Art. 3', label: 'Territoire hors Algérie' },
];

const CIRCUMSTANCES: ConstatCircumstance[] = Array.from({ length: 17 }, (_, i) => ({
  number: i + 1,
  labelFr: i === 0 ? "en stationnement / à l'arrêt" : `circonstance ${i + 1}`,
  status: 'STANDARD_A_CONFIRMER',
  createdBy: 'system:seed',
}));

const NON_DECLARATION: OppositionMotif = {
  code: 'NON_DECLARATION',
  label: 'Non-déclaration du sinistre',
  forbidden: true,
  sourceRef: 'Guide pédagogique UAR, diapo 10 (Art. 10)',
  status: 'SAISI',
  createdBy: 'system:seed',
  createdAt: '2026-10-18T00:00:00.000Z',
};

const OPPOSITION_MOTIFS: OppositionMotif[] = [NON_DECLARATION];

const ME_OPERATEUR: MeResponse = {
  user: { id: 'dev-op', name: 'Opérateur Place (dev)', email: 'operateur@finlab.dz' },
  role: 'OPERATEUR_PLACE',
  privileges: ['admin', 'refedit'],
};

function baseRouter(overrides: Partial<Record<string, unknown>> = {}) {
  return (pathname: string, url: URL) => {
    if (pathname === '/api/v1/me') return ME_OPERATEUR;
    if (pathname === '/api/v1/referential/companies') {
      const page = Number(url.searchParams.get('page') ?? '1');
      const pageSize = Number(url.searchParams.get('pageSize') ?? '6');
      const all = (overrides.companies as CompanyView[] | undefined) ?? [company(1)];
      const start = (page - 1) * pageSize;
      return { page, total: all.length, items: all.slice(start, start + pageSize) };
    }
    if (pathname === '/api/v1/referential/agencies') return overrides.agencies ?? { page: 1, total: 0, items: [] };
    if (pathname === '/api/v1/referential/experts') return overrides.experts ?? { page: 1, total: 0, items: [] };
    if (pathname === '/api/v1/referential/convention') return overrides.convention ?? CONVENTION;
    if (pathname === '/api/v1/referential/calendar') return overrides.calendar ?? CALENDAR;
    if (pathname === '/api/v1/referential/motifs') return overrides.motifs ?? MOTIFS;
    if (pathname === '/api/v1/referential/mobile-holidays') return overrides.mobileHolidays ?? [];
    if (pathname === '/api/v1/referential/constat-circumstances') return overrides.circumstances ?? CIRCUMSTANCES;
    if (pathname === '/api/v1/referential/opposition-motifs') return overrides.oppositionMotifs ?? OPPOSITION_MOTIFS;
    return undefined;
  };
}

describe('Écran Référentiel de place (/referential)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('affiche les 6 sections de navigation et bascule le contenu au clic (maître-détail)', async () => {
    mockFetchRouter(baseRouter());
    renderWithProviders(<ReferentialPage />);

    await waitFor(() => expect(screen.getByText('Compagnie 1')).toBeInTheDocument());

    const nav = screen.getByRole('navigation', { name: /référentiel de place/i });
    expect(within(nav).getByText('Compagnies adhérentes')).toBeInTheDocument();
    expect(within(nav).getByText('Agences')).toBeInTheDocument();
    expect(within(nav).getByText('Experts agréés')).toBeInTheDocument();
    expect(within(nav).getByText('Paramètres de la convention')).toBeInTheDocument();
    expect(within(nav).getByText('Calendrier ouvré')).toBeInTheDocument();
    expect(within(nav).getByText('Barème & motifs')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(within(nav).getByText('Paramètres de la convention'));
    await waitFor(() => expect(screen.getByText('2025.12-v1')).toBeInTheDocument());
    expect(screen.queryByText('Compagnie 1')).not.toBeInTheDocument();

    await user.click(within(nav).getByText('Calendrier ouvré'));
    await waitFor(() => expect(screen.getByText(/jour de l'an/i)).toBeInTheDocument());

    await user.click(within(nav).getByText('Barème & motifs'));
    await waitFor(() => expect(screen.getByText(/territoire hors algérie/i)).toBeInTheDocument());

    await user.click(within(nav).getByText('Compagnies adhérentes'));
    await waitFor(() => expect(screen.getByText('Compagnie 1')).toBeInTheDocument());
  });

  it('affiche la pagination 6 lignes/page sur les compagnies et la respecte (A.5)', async () => {
    const allCompanies = Array.from({ length: 9 }, (_, i) => company(i + 1));
    mockFetchRouter(baseRouter({ companies: allCompanies }));

    renderWithProviders(<ReferentialPage />);

    await waitFor(() => expect(screen.getByText('Compagnie 1')).toBeInTheDocument());
    expect(screen.getByText('Compagnie 6')).toBeInTheDocument();
    expect(screen.queryByText('Compagnie 7')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /suivant|next/i }));

    await waitFor(() => expect(screen.getByText('Compagnie 7')).toBeInTheDocument());
    expect(screen.getByText('Compagnie 9')).toBeInTheDocument();
    expect(screen.queryByText('Compagnie 1')).not.toBeInTheDocument();
  });

  it("affiche la date d'adhésion, la répartition DG/DR/AG et le correspondant quand il est renseigné", async () => {
    const withCorrespondent = company(1, { correspondentName: 'Amina Yahiaoui' });
    mockFetchRouter(baseRouter({ companies: [withCorrespondent] }));

    renderWithProviders(<ReferentialPage />);

    await waitFor(() => expect(screen.getByText('Compagnie 1')).toBeInTheDocument());
    const meta = screen.getByText(/adhérente depuis le/i);
    expect(meta).toHaveTextContent('adhérente depuis le');
    expect(meta).toHaveTextContent('1 DG');
    expect(meta).toHaveTextContent('3 DR');
    expect(meta).toHaveTextContent('8 agences');
    expect(meta).toHaveTextContent('correspondant Amina Yahiaoui');
  });

  it("n'affiche aucun fragment correspondant quand correspondentName est absent (regression)", async () => {
    const withoutCorrespondent = company(1);
    expect(withoutCorrespondent.correspondentName).toBeUndefined();
    mockFetchRouter(baseRouter({ companies: [withoutCorrespondent] }));

    renderWithProviders(<ReferentialPage />);

    await waitFor(() => expect(screen.getByText('Compagnie 1')).toBeInTheDocument());
    const meta = screen.getByText(/adhérente depuis le/i);
    expect(meta).not.toHaveTextContent(/correspondant/i);
    expect(screen.queryByText(/correspondant/i)).not.toBeInTheDocument();
  });

  it('ne restitue jamais la clé API en clair, seulement apiKeyMasked', async () => {
    mockFetchRouter(baseRouter({ companies: [company(1)] }));

    renderWithProviders(<ReferentialPage />);
    await waitFor(() => expect(screen.getByText('Compagnie 1')).toBeInTheDocument());
    expect(screen.queryByText(/sk_live_(?!•)/)).not.toBeInTheDocument();
  });

  it('affiche les paramètres réels de la convention (délais, plafond, version)', async () => {
    mockFetchRouter(baseRouter());
    renderWithProviders(<ReferentialPage />);

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('Compagnie 1')).toBeInTheDocument());
    await user.click(screen.getByText('Paramètres de la convention'));

    await waitFor(() => expect(screen.getByText('2025.12-v1')).toBeInTheDocument());
    expect(screen.getByText(/500 000|500,000/)).toBeInTheDocument();
    expect(screen.getByText('10 jours')).toBeInTheDocument();
    expect(screen.getByText('15 jours')).toBeInTheDocument();
    expect(screen.getByText('6 mois')).toBeInTheDocument();
  });

  it('affiche le calendrier ouvré réel (week-end, jours fériés fixes) et la note sur les jours mobiles', async () => {
    mockFetchRouter(baseRouter());
    renderWithProviders(<ReferentialPage />);

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('Compagnie 1')).toBeInTheDocument());
    await user.click(screen.getByText('Calendrier ouvré'));

    await waitFor(() => expect(screen.getByText(/jour de l'an/i)).toBeInTheDocument());
    expect(screen.getByText(/vendredi/i)).toBeInTheDocument();
    expect(screen.getByText(/samedi/i)).toBeInTheDocument();
    expect(screen.getByText('Fête du travail')).toBeInTheDocument();
    expect(screen.getByText(/aucune conversion hégirienne automatique/i)).toBeInTheDocument();
  });

  it("affiche le catalogue réel des motifs d'inéligibilité (sans code/compte inventé)", async () => {
    mockFetchRouter(baseRouter());
    renderWithProviders(<ReferentialPage />);

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('Compagnie 1')).toBeInTheDocument());
    await user.click(screen.getByText('Barème & motifs'));

    await waitFor(() => expect(screen.getByText(/territoire hors algérie/i)).toBeInTheDocument());
    expect(screen.getByText(/nombre de véhicules impliqués/i)).toBeInTheDocument();
    expect(screen.queryByText(/RG-01/)).not.toBeInTheDocument();
  });

  it("action « Agences » d'une compagnie : section Agences filtrée par companyId (filtre réel de l'API), filtre retirable", async () => {
    const companyIds: (string | null)[] = [];
    const router = baseRouter();
    mockFetchRouter((pathname, url) => {
      if (pathname === '/api/v1/referential/agencies' && url.searchParams.get('pageSize') !== '1') companyIds.push(url.searchParams.get('companyId'));
      return router(pathname, url);
    });
    const user = userEvent.setup();

    renderWithProviders(<ReferentialPage />);

    await user.click(await screen.findByRole('button', { name: 'Voir les agences de C001' }));
    await waitFor(() => expect(companyIds).toContain('c-1'));
    expect(screen.getByText('Agences', { selector: '.ref-nav-title' }).closest('button')).toHaveAttribute('aria-current', 'true');

    await user.click(screen.getByRole('button', { name: /Toutes les compagnies/ }));
    await waitFor(() => expect(companyIds.at(-1)).toBeNull());
  });
});
