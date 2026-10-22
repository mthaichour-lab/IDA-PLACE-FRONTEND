import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaimColumnDef, ClaimImportReport, MeResponse } from '@/lib/types';
import { mockFetchRequests, renderWithProviders } from '@/test/render';
import ImportPage from './page';

/**
 * Écran 3 — modèles v1 (47 colonnes) / v2 (colonnes 48-53 du barème Art. 14)
 * et avertissements d'import, distincts des motifs d'inéligibilité (décision PO §5).
 */

const ME: MeResponse = { user: { id: 'u-op', name: 'Opérateur', email: 'op@uar.dz' }, role: 'OPERATEUR_PLACE', privileges: ['import'] };

const V1: ClaimColumnDef[] = Array.from({ length: 47 }, (_, i) => ({ index: i + 1, key: `col${i + 1}`, label: `Colonne ${i + 1}`, group: 'IDENTIFICATION', type: 'string' }));
const V2: ClaimColumnDef[] = [
  ...V1,
  { index: 48, key: 'circonstancesA', label: 'Circonstances A (cases 1 à 17 séparées par |)', group: 'BAREME_ART14', type: 'circonstances' },
  { index: 49, key: 'circonstancesB', label: 'Circonstances B (cases 1 à 17 séparées par |)', group: 'BAREME_ART14', type: 'circonstances' },
  { index: 50, key: 'baremeVersion', label: 'Version du barème (libellé ou id)', group: 'BAREME_ART14', type: 'string' },
  { index: 51, key: 'baremeCode', label: 'Code barème Art. 14', group: 'BAREME_ART14', type: 'string' },
  { index: 52, key: 'vehicleCategoryA', label: 'Catégorie véhicule A', group: 'BAREME_ART14', type: 'string' },
  { index: 53, key: 'vehicleCategoryB', label: 'Catégorie véhicule B', group: 'BAREME_ART14', type: 'string' },
];

const COMPANIES = { page: 1, total: 2, items: [
  { id: '00000000-0000-4000-8000-000000000001', code: 'CAAT', name: 'CAAT', color: '#123456', kind: 'INSURER', status: 'ACTIF' },
  { id: '00000000-0000-4000-8000-000000000002', code: 'SAA', name: 'SAA', color: '#654321', kind: 'INSURER', status: 'ACTIF' },
] };

const REPORT: ClaimImportReport = {
  fileName: 'lot.csv',
  importedAt: '2026-10-19T08:00:00.000Z',
  totalRows: 2,
  eligibleCount: 1,
  ineligibleCount: 1,
  rejectedCount: 0,
  company: 'CAAT',
  rows: [
    { rowNumber: 1, verdict: 'ELIGIBLE_IDA', reasons: [], data: {} },
    { rowNumber: 2, verdict: 'HORS_IDA', reasons: ['Dommages corporels déclarés'], data: {} },
  ],
  warnings: [{ rowNumber: 1, column: 51, columnKey: 'baremeCode', code: 'BAREME_NON_PUBLIE', message: 'Barème non publié : code « Z9 » absent de toute version VALIDE_UAR — valeur ignorée.' }],
};

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });
}

function mockApi(report: ClaimImportReport = REPORT) {
  mockFetchRequests((req) => {
    if (req.pathname === '/api/v1/me') return { body: ME };
    if (req.pathname === '/api/v1/claims/import/columns') return { body: V1 };
    if (req.pathname === '/api/v1/claims/import/columns/v2') return { body: V2 };
    if (req.pathname === '/api/v1/referential/companies') return { body: COMPANIES };
    if (req.method === 'POST' && req.pathname === '/api/v1/claims/import') return { body: report };
    return undefined;
  });
}

describe('Écran 3 — modèles v1/v2 et avertissements (décision PO §5)', () => {
  const downloads: { name: string; blob: Blob }[] = [];

  beforeEach(() => {
    downloads.length = 0;
    let pending: Blob | null = null;
    URL.createObjectURL = (b: Blob) => ((pending = b), 'blob:x');
    URL.revokeObjectURL = () => undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push({ name: this.download, blob: pending! });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('propose les deux modèles avec leur nombre de colonnes et télécharge celui choisi', async () => {
    mockApi();
    renderWithProviders(<ImportPage />);
    const user = userEvent.setup();

    const v1 = await screen.findByRole('button', { name: 'Modèle v1 (.csv)' });
    const v2 = await screen.findByRole('button', { name: 'Modèle v2 (.csv)' });
    // Le nombre RÉEL de colonnes (API) est porté par l'infobulle des boutons compacts.
    await waitFor(() => expect(v1).toHaveAttribute('title', expect.stringContaining('47 colonnes')));
    await waitFor(() => expect(v2).toHaveAttribute('title', expect.stringContaining('53 colonnes')));

    await user.click(v2);
    await user.click(v1);

    expect(downloads.map((d) => d.name)).toEqual(['modele-v2-53-colonnes-IDA.csv', 'modele-47-colonnes-IDA.csv']);
    const [v2Csv, v1Csv] = await Promise.all(downloads.map((d) => readBlob(d.blob)));
    // Modèle À REMPLIR : une seule ligne d'en-tête, les LIBELLÉS des colonnes de l'API dans l'ordre, séparateur `;`.
    const v2Lines = v2Csv.replace(/^﻿/, '').split('\r\n').filter(Boolean);
    const v1Lines = v1Csv.replace(/^﻿/, '').split('\r\n').filter(Boolean);
    expect(v2Lines).toEqual([V2.map((c) => c.label).join(';')]);
    expect(v1Lines).toEqual([V1.map((c) => c.label).join(';')]);
    expect(v2Lines[0].split(';')).toHaveLength(53);
    expect(v1Lines[0].split(';')).toHaveLength(47);
    // Plus le dictionnaire (index;key;label;…) à la place du modèle.
    expect(v2Csv).not.toContain('index;key;label');
    expect(v2Csv).not.toContain('BAREME_ART14');
  });

  it('le modèle est préfixé du BOM UTF-8 (accents lisibles dans Excel)', async () => {
    mockApi();
    renderWithProviders(<ImportPage />);
    const user = userEvent.setup();
    const v2 = await screen.findByRole('button', { name: 'Modèle v2 (.csv)' });
    await waitFor(() => expect(v2).not.toBeDisabled());
    await user.click(v2);
    const bytes = await new Promise<Uint8Array>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.readAsArrayBuffer(downloads[0].blob);
    });
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('le dictionnaire des colonnes reste téléchargeable par un lien distinct', async () => {
    mockApi();
    renderWithProviders(<ImportPage />);
    const user = userEvent.setup();
    const dictionary = await screen.findByRole('button', { name: 'Dictionnaire des colonnes' });
    await waitFor(() => expect(dictionary).not.toBeDisabled());
    await user.click(dictionary);

    expect(downloads.map((d) => d.name)).toEqual(['dictionnaire-53-colonnes-IDA.csv']);
    const csv = (await readBlob(downloads[0].blob)).replace(/^﻿/, '');
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('index;key;label;group;type;enumValues');
    expect(lines).toHaveLength(54);
    expect(csv).toContain('53;vehicleCategoryB;Catégorie véhicule B;BAREME_ART14');
  });

  it('affiche les avertissements (ligne, colonne, message) à part des motifs d’inéligibilité', async () => {
    mockApi();
    const { container } = renderWithProviders(<ImportPage />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Modèle v2 (.csv)' })).toHaveAttribute('title', expect.stringContaining('53 colonnes')));
    await user.selectOptions(await screen.findByLabelText('Compagnie déclarante'), await screen.findByRole('option', { name: 'CAAT — CAAT' }));
    await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, new File(['x'], 'lot.csv', { type: 'text/csv' }));

    const warnings = await screen.findByRole('region', { name: 'Avertissements' });
    expect(within(warnings).getByText('Avertissements (1)')).toBeInTheDocument();
    const row = within(warnings).getByText(/code « Z9 » absent/).closest('tr')!;
    expect(row).toHaveTextContent('1');
    expect(row).toHaveTextContent('51 · Code barème Art. 14');
    expect(within(warnings).queryByText('Dommages corporels déclarés')).not.toBeInTheDocument();
    expect(screen.getByText('Dommages corporels déclarés')).toBeInTheDocument();
  });

  it('aucune section d’avertissements quand le rapport n’en contient pas', async () => {
    mockApi({ ...REPORT, warnings: [] });
    const { container } = renderWithProviders(<ImportPage />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Modèle v1 (.csv)' })).toHaveAttribute('title', expect.stringContaining('47 colonnes')));
    await user.selectOptions(await screen.findByLabelText('Compagnie déclarante'), await screen.findByRole('option', { name: 'CAAT — CAAT' }));
    await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, new File(['x'], 'lot.csv', { type: 'text/csv' }));

    await waitFor(() => expect(screen.getByText('Dommages corporels déclarés')).toBeInTheDocument());
    expect(screen.queryByRole('region', { name: 'Avertissements' })).not.toBeInTheDocument();
  });
});
