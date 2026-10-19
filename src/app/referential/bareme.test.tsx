import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DICTIONARIES } from '@/i18n/translations';
import { BaremeVersion, MeResponse, VehicleCategory } from '@/lib/types';
import { FetchRequest, mockFetchRequests, renderWithProviders } from '@/test/render';
import ReferentialPage from './page';

/**
 * Écran 12 — « Barème Art. 14 » (décision PO §5) : rien de pré-rempli, versions
 * BROUILLON → VALIDE_UAR → ARCHIVE, parts A + B = 100, saisie `params`,
 * validation et archivage `validateRef`.
 */

const ME_READER: MeResponse = { user: { id: 'u-audit', name: 'Auditeur', email: 'a@csa.dz' }, role: 'AUDITEUR_CSA', privileges: [] };
const ME_OPERATOR: MeResponse = { user: { id: 'u-op', name: 'Opérateur', email: 'op@uar.dz' }, role: 'OPERATEUR_PLACE', privileges: ['refedit', 'params'] };
const ME_ADMIN_UAR: MeResponse = { user: { id: 'u-admin', name: 'Admin UAR', email: 'admin@uar.dz' }, role: 'ADMIN_UAR', privileges: ['refedit', 'params', 'validateRef'] };

function version(overrides: Partial<BaremeVersion> = {}): BaremeVersion {
  return { id: 'v-1', label: 'Barème UAR 2026', status: 'BROUILLON', createdBy: 'u-op', createdAt: '2026-10-19T08:00:00.000Z', cases: [], ...overrides };
}

const CASE = { code: 'X1', label: 'Choc arrière', partA: 0, partB: 100, createdBy: 'u-op', createdAt: '2026-10-19T08:00:00.000Z' };

function category(overrides: Partial<VehicleCategory> = {}): VehicleCategory {
  return { code: 'VL', label: 'Véhicule léger', status: 'SAISI', createdBy: 'u-op', createdAt: '2026-10-19T08:00:00.000Z', ...overrides };
}

function mockApi(state: { me: MeResponse; versions?: BaremeVersion[]; categories?: VehicleCategory[]; writeResponses?: Record<string, { status: number; body: unknown }> }) {
  const writes: FetchRequest[] = [];
  mockFetchRequests((req) => {
    if (req.method !== 'GET') {
      writes.push(req);
      const forced = state.writeResponses?.[`${req.method} ${req.pathname}`];
      if (forced) return forced;
      return { body: req.pathname.includes('bareme-versions') ? version({ id: 'v-new' }) : category() };
    }
    switch (req.pathname) {
      case '/api/v1/me':
        return { body: state.me };
      case '/api/v1/referential/companies':
      case '/api/v1/referential/agencies':
      case '/api/v1/referential/experts':
        return { body: { page: 1, total: 0, items: [] } };
      case '/api/v1/referential/convention':
        return { body: { version: 'v1', silenceDays: 10, oppositionDays: 15, forclusionMonths: 6, maxAmountDA: 500_000 } };
      case '/api/v1/referential/motifs':
        return { body: [] };
      case '/api/v1/referential/bareme-versions':
        return { body: state.versions ?? [] };
      case '/api/v1/referential/vehicle-categories':
        return { body: state.categories ?? [] };
      default:
        return undefined;
    }
  });
  return writes;
}

async function openBareme() {
  renderWithProviders(<ReferentialPage />);
  const nav = await screen.findByRole('navigation', { name: /référentiel de place/i });
  const user = userEvent.setup();
  await user.click(within(nav).getByText('Barème Art. 14'));
  return user;
}

describe('Écran 12 — Barème Art. 14 (décision PO §5)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('état vide explicite, sans aucune valeur proposée par défaut', async () => {
    mockApi({ me: ME_READER });
    await openBareme();

    expect(await screen.findByText('Barème non publié — en attente UAR')).toBeInTheDocument();
    expect(await screen.findByText('Aucune catégorie de véhicule saisie — en attente UAR.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nouvelle version' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bB(0[1-9]|1[01])\b/);
    for (const dictionary of Object.values(DICTIONARIES)) {
      expect(Object.values(dictionary).some((v) => /\bB(0[1-9]|1[01])\b/.test(v))).toBe(false);
    }
  });

  it('reste « non publié » tant qu’aucune version n’est validée UAR', async () => {
    mockApi({ me: ME_READER, versions: [version({ cases: [CASE] })] });
    await openBareme();

    expect(await screen.findByText('Barème non publié — en attente UAR')).toBeInTheDocument();
    expect(screen.getByText('Brouillon')).toBeInTheDocument();
  });

  it('params : crée une version, puis un cas dont les champs sont vides au départ', async () => {
    const writes = mockApi({ me: ME_OPERATOR, versions: [version()] });
    const user = await openBareme();

    await user.click(await screen.findByRole('button', { name: 'Nouvelle version' }));
    let dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Libellé de la version'), 'Barème UAR 2027');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ method: 'POST', pathname: '/api/v1/referential/bareme-versions', body: { label: 'Barème UAR 2027' } });

    await user.click(within(screen.getByRole('region', { name: 'Cas de la version' })).getByRole('button', { name: 'Ajouter un cas' }));
    dialog = screen.getByRole('dialog');
    for (const label of ['Code (majuscules, chiffres, _ et -)', 'Libellé', 'Part A (%)', 'Part B (%)']) {
      expect(within(dialog).getByLabelText(label)).toHaveValue(label.startsWith('Part') ? null : '');
    }
  });

  it('bloque A + B ≠ 100 côté client, puis envoie le cas une fois corrigé', async () => {
    const writes = mockApi({ me: ME_OPERATOR, versions: [version()] });
    const user = await openBareme();

    await user.click(await screen.findByRole('button', { name: 'Ajouter un cas' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Code (majuscules, chiffres, _ et -)'), 'x7');
    await user.type(within(dialog).getByLabelText('Libellé'), 'Changement de file');
    await user.type(within(dialog).getByLabelText('Part A (%)'), '60');
    await user.type(within(dialog).getByLabelText('Part B (%)'), '30');

    expect(within(dialog).getByRole('alert')).toHaveTextContent('Part A + part B doit valoir 100.');
    const save = within(dialog).getByRole('button', { name: 'Enregistrer' });
    expect(save).toBeDisabled();
    await user.click(save);
    expect(writes).toHaveLength(0);

    await user.clear(within(dialog).getByLabelText('Part B (%)'));
    await user.type(within(dialog).getByLabelText('Part B (%)'), '40');
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
    await user.click(save);

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({
      method: 'POST',
      pathname: '/api/v1/referential/bareme-versions/v-1/cases',
      body: { code: 'X7', label: 'Changement de file', partA: 60, partB: 40 },
    });
  });

  it('params seul : renommage et édition des cas en BROUILLON, ni validation ni archivage', async () => {
    mockApi({ me: ME_OPERATOR, versions: [version({ cases: [CASE] })] });
    await openBareme();

    const versions = await screen.findByRole('region', { name: 'Versions du barème' });
    expect(await within(versions).findByRole('button', { name: 'Renommer' })).toBeInTheDocument();
    expect(within(versions).queryByRole('button', { name: 'Valider (UAR)' })).not.toBeInTheDocument();
    expect(within(versions).queryByRole('button', { name: 'Archiver' })).not.toBeInTheDocument();
    const cases = screen.getByRole('region', { name: 'Cas de la version' });
    expect(within(cases).getByRole('button', { name: 'Modifier' })).toBeInTheDocument();
    expect(within(cases).getByRole('button', { name: 'Supprimer' })).toBeInTheDocument();
  });

  it('une version validée est immuable : ni renommage ni édition de ses cas', async () => {
    mockApi({ me: ME_ADMIN_UAR, versions: [version({ status: 'VALIDE_UAR', validatedBy: 'u-admin', cases: [CASE] })] });
    await openBareme();

    const cases = await screen.findByRole('region', { name: 'Cas de la version' });
    expect(within(cases).getByText('Choc arrière')).toBeInTheDocument();
    expect(within(cases).queryByRole('button', { name: 'Ajouter un cas' })).not.toBeInTheDocument();
    expect(within(cases).queryByRole('button', { name: 'Modifier' })).not.toBeInTheDocument();
    expect(within(cases).getByText(/elle ne se modifie plus/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Renommer' })).not.toBeInTheDocument();
    expect(screen.queryByText('Barème non publié — en attente UAR')).not.toBeInTheDocument();
  });

  it('validateRef : valide un brouillon, archive une version validée, et le 409 « quatre yeux » s’affiche en toast', async () => {
    const fourEyes = 'Règle des quatre yeux : le validateur a saisi la version ou l’un de ses cas.';
    const writes = mockApi({
      me: ME_ADMIN_UAR,
      versions: [version({ cases: [CASE] }), version({ id: 'v-2', label: 'Barème UAR 2025', status: 'VALIDE_UAR', cases: [CASE] })],
      writeResponses: { 'POST /api/v1/referential/bareme-versions/v-1/validate': { status: 409, body: { code: 'FOUR_EYES', message: fourEyes } } },
    });
    const user = await openBareme();

    const draftRow = (await screen.findByText('Barème UAR 2026')).closest('tr')!;
    await user.click(within(draftRow).getByRole('button', { name: 'Valider (UAR)' }));
    expect(await screen.findByText(fourEyes)).toBeInTheDocument();

    const validRow = screen.getByText('Barème UAR 2025').closest('tr')!;
    expect(within(validRow).queryByRole('button', { name: 'Valider (UAR)' })).not.toBeInTheDocument();
    await user.click(within(validRow).getByRole('button', { name: 'Archiver' }));

    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes.map((w) => `${w.method} ${w.pathname}`)).toEqual([
      'POST /api/v1/referential/bareme-versions/v-1/validate',
      'POST /api/v1/referential/bareme-versions/v-2/archive',
    ]);
  });

  it('catégories : saisie (params) et validation UAR (validateRef) d’une catégorie saisie', async () => {
    const writes = mockApi({ me: ME_ADMIN_UAR, categories: [category(), category({ code: 'PL', label: 'Poids lourd', status: 'VALIDE_UAR' })] });
    const user = await openBareme();

    const block = await screen.findByRole('region', { name: 'Catégories de véhicule' });
    await within(block).findByText('Véhicule léger');
    expect(within(screen.getByText('Poids lourd').closest('tr')!).queryByRole('button', { name: 'Valider (UAR)' })).not.toBeInTheDocument();
    // Décision PO (2026-10-19) : une catégorie validée est figée.
    expect(within(screen.getByText('Poids lourd').closest('tr')!).queryByRole('button', { name: 'Modifier' })).not.toBeInTheDocument();
    expect(within(screen.getByText('Véhicule léger').closest('tr')!).getByRole('button', { name: 'Modifier' })).toBeInTheDocument();
    await user.click(within(screen.getByText('Véhicule léger').closest('tr')!).getByRole('button', { name: 'Valider (UAR)' }));

    await user.click(within(block).getByRole('button', { name: 'Nouvelle catégorie' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Code (majuscules, chiffres, _ et -)'), 'moto');
    await user.type(within(dialog).getByLabelText('Libellé'), 'Motocycle');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[0]).toMatchObject({ method: 'POST', pathname: '/api/v1/referential/vehicle-categories/VL/validate' });
    expect(writes[1]).toMatchObject({ method: 'POST', pathname: '/api/v1/referential/vehicle-categories', body: { code: 'MOTO', label: 'Motocycle' } });
  });
});
