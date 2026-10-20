import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaimImportReport, MeResponse } from '@/lib/types';
import { FetchRequest, mockFetchRequests, renderWithProviders } from '@/test/render';
import ImportPage from './page';

/**
 * SEC-02 / SEC-12 / SEC-39 — import au nom d'une compagnie désignée :
 * sélecteur obligatoire pour un rôle place (`?company=`), compagnie du jeton
 * pour un rôle compagnie ; rapport enrichi (`company`, `rejectedCount`,
 * `rows[].rejected`, avertissements FORMULE_NEUTRALISEE/DECLARATION_CORRIGEE)
 * et erreurs 400 traduites.
 */

const OPERATEUR: MeResponse = { user: { id: 'u-op', name: 'Opérateur', email: 'op@uar.dz' }, role: 'OPERATEUR_PLACE', privileges: ['import'] };
const CORRESPONDANT: MeResponse = {
  user: { id: 'u-corr', name: 'Correspondant', email: 'c@caat.dz' },
  role: 'CORRESPONDANT_IDA',
  privileges: ['import', 'insert'],
  company: 'CAAT',
};

const COMPANIES = {
  page: 1,
  total: 3,
  items: [
    { id: '00000000-0000-4000-8000-000000000001', code: 'CAAT', name: 'Compagnie CAAT', color: '#123456', kind: 'INSURER', status: 'ACTIF' },
    { id: '00000000-0000-4000-8000-000000000002', code: 'SAA', name: 'Compagnie SAA', color: '#654321', kind: 'INSURER', status: 'ACTIF' },
    { id: '00000000-0000-4000-8000-000000000003', code: 'OLD', name: 'Compagnie suspendue', color: '#222222', kind: 'INSURER', status: 'SUSPENDU' },
  ],
};

const REPORT: ClaimImportReport = {
  fileName: 'lot.csv',
  importedAt: '2026-10-19T08:00:00.000Z',
  totalRows: 3,
  eligibleCount: 1,
  ineligibleCount: 2,
  rejectedCount: 1,
  company: 'SAA',
  rows: [
    { rowNumber: 1, verdict: 'ELIGIBLE_IDA', reasons: [], data: {} },
    { rowNumber: 2, verdict: 'HORS_IDA', reasons: ['Dommages corporels déclarés'], data: {} },
    { rowNumber: 3, verdict: 'HORS_IDA', reasons: ['Compagnie A différente de la compagnie déclarante'], data: {}, rejected: true },
  ],
  warnings: [
    { rowNumber: 1, column: 12, columnKey: 'nomAssure', code: 'FORMULE_NEUTRALISEE', message: 'Formule neutralisée : la cellule commençait par « = ».' },
    { rowNumber: 2, column: 32, columnKey: 'responsabiliteDeclareeA', code: 'DECLARATION_CORRIGEE', message: 'Responsabilité déclarée corrigée.' },
  ],
};

function mockApi(me: MeResponse, onImport: (req: FetchRequest) => { status?: number; body: unknown } = () => ({ body: REPORT })) {
  return mockFetchRequests((req) => {
    if (req.pathname === '/api/v1/me') return { body: me };
    if (req.pathname === '/api/v1/claims/import/columns') return { body: [] };
    if (req.pathname === '/api/v1/claims/import/columns/v2') return { body: [] };
    if (req.pathname === '/api/v1/referential/companies') return { body: COMPANIES };
    if (req.method === 'POST' && req.pathname === '/api/v1/claims/import') return onImport(req);
    return undefined;
  });
}

function fileInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[type="file"]') as HTMLInputElement;
}

describe('Écran 3 — import au nom d’une compagnie désignée (SEC-02)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rôle place : sélecteur obligatoire (compagnies actives), dépôt inactif avant choix, puis POST ?company=', async () => {
    const fetchMock = mockApi(OPERATEUR);
    const { container } = renderWithProviders(<ImportPage />);
    const user = userEvent.setup();

    const select = await screen.findByLabelText('Compagnie déclarante');
    await screen.findByRole('option', { name: 'SAA — Compagnie SAA' });
    expect(screen.queryByRole('option', { name: /OLD/ })).not.toBeInTheDocument();
    // Bandeau "Compagnies admises" (capture, écran 3) — liste RÉELLE des compagnies ACTIVES
    // uniquement (SUSPENDU exclu, même filtre que le sélecteur), jamais une liste figée en dur.
    const notice = await screen.findByRole('note');
    expect(notice).toHaveTextContent('Compagnies admises : CAAT · SAA');
    expect(notice).not.toHaveTextContent('OLD');
    expect(screen.getByRole('button', { name: 'Choisir un fichier' })).toBeDisabled();
    expect(screen.getByText('Choisissez d’abord la compagnie déclarante.')).toBeInTheDocument();

    // Fichier déposé sans compagnie : aucun appel.
    await user.upload(fileInput(container), new File(['x'], 'lot.csv', { type: 'text/csv' }));
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/claims/import?') || String(input).endsWith('/claims/import'))).toBe(false);

    await user.selectOptions(select, 'SAA');
    expect(screen.getByRole('button', { name: 'Choisir un fichier' })).toBeEnabled();
    await user.upload(fileInput(container), new File(['x'], 'lot.csv', { type: 'text/csv' }));

    await screen.findByText('Refusée — aucun dossier créé');
    const importCall = fetchMock.mock.calls.find(([input, init]) => init?.method === 'POST' && String(input).includes('/claims/import'));
    expect(new URL(String(importCall![0])).searchParams.get('company')).toBe('SAA');
  });

  it('rapport : compagnie, lignes refusées, avertissements FORMULE_NEUTRALISEE et DECLARATION_CORRIGEE', async () => {
    mockApi(OPERATEUR);
    const { container } = renderWithProviders(<ImportPage />);
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText('Compagnie déclarante'), await screen.findByRole('option', { name: 'SAA — Compagnie SAA' }));
    await user.upload(fileInput(container), new File(['x'], 'lot.csv', { type: 'text/csv' }));

    const report = await screen.findByText("Aperçu des lignes importées");
    const sheet = report.closest('.sheet') as HTMLElement;
    await waitFor(() => expect(within(sheet).getByText('Refusées')).toBeInTheDocument());
    expect(within(sheet).getByText('Refusées').nextElementSibling).toHaveTextContent('1');
    expect(within(sheet).getAllByText('Compagnie déclarante')[0].nextElementSibling).toHaveTextContent('SAA');
    expect(screen.getByRole('status')).toHaveTextContent(/refusées sans création de dossier/);

    const warnings = screen.getByRole('region', { name: 'Avertissements' });
    expect(within(warnings).getByText('Formule neutralisée')).toBeInTheDocument();
    expect(within(warnings).getByText('Déclaration corrigée')).toBeInTheDocument();
  });

  it('rôle compagnie : pas de sélecteur, compagnie du jeton affichée, POST sans paramètre company', async () => {
    const fetchMock = mockApi(CORRESPONDANT, () => ({ body: { ...REPORT, company: 'CAAT', rejectedCount: 0, rows: REPORT.rows.slice(0, 2) } }));
    const { container } = renderWithProviders(<ImportPage />);
    const user = userEvent.setup();

    await screen.findByText('Import au nom de votre compagnie :');
    expect(screen.getByText('CAAT')).toBeInTheDocument();
    expect(screen.queryByLabelText('Compagnie déclarante')).not.toBeInTheDocument();
    // Pas de bandeau "Compagnies admises" pour un rôle compagnie (même périmètre que le
    // sélecteur, SEC-07/21 : aucune lecture de `/referential/companies` pour ce rôle).
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/referential/companies'))).toBe(false);

    await user.upload(fileInput(container), new File(['x'], 'lot.csv', { type: 'text/csv' }));
    await screen.findByText('Dommages corporels déclarés');
    const importCall = fetchMock.mock.calls.find(([input, init]) => init?.method === 'POST' && String(input).includes('/claims/import'));
    expect(new URL(String(importCall![0])).search).toBe('');
  });

  it.each([
    ['COMPAGNIE_REQUISE', 'Choisissez la compagnie déclarante avant d’importer le fichier.'],
    ['FORMAT_XLS_NON_PRIS_EN_CHARGE', 'Le format Excel 97-2003 (.xls) n’est pas pris en charge : enregistrez le fichier en .xlsx ou en .csv.'],
    ['FORMAT_INVALIDE', 'Le contenu du fichier ne correspond pas à son extension. Formats acceptés : .csv et .xlsx.'],
    ['ARCHIVE_REFUSEE', 'Classeur .xlsx refusé : archive invalide ou trop volumineuse une fois décompressée.'],
    ['IMPORT_TROP_DE_LIGNES', 'Le fichier contient trop de lignes pour un seul import : découpez-le en plusieurs fichiers.'],
  ])('erreur 400 %s : message traduit affiché sous la zone de dépôt', async (code, message) => {
    mockApi(CORRESPONDANT, () => ({ status: 400, body: { code, message: 'texte serveur' } }));
    const { container } = renderWithProviders(<ImportPage />);
    const user = userEvent.setup();

    await screen.findByText('Import au nom de votre compagnie :');
    await user.upload(fileInput(container), new File(['x'], 'lot.xls', { type: 'application/vnd.ms-excel' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(message);
  });
});
