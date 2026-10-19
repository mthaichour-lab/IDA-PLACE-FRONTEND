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

const REPORT: ClaimImportReport = {
  fileName: 'lot.csv',
  importedAt: '2026-10-19T08:00:00.000Z',
  totalRows: 2,
  eligibleCount: 1,
  ineligibleCount: 1,
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

    const v1 = await screen.findByRole('button', { name: 'Modèle v1 (47 colonnes)' });
    const v2 = await screen.findByRole('button', { name: 'Modèle v2 — barème Art. 14 (53 colonnes)' });

    await user.click(v2);
    await user.click(v1);

    expect(downloads.map((d) => d.name)).toEqual(['modele-v2-53-colonnes-IDA.csv', 'modele-47-colonnes-IDA.csv']);
    const [v2Csv, v1Csv] = await Promise.all(downloads.map((d) => readBlob(d.blob)));
    expect(v2Csv).toContain('53;vehicleCategoryB;Catégorie véhicule B;BAREME_ART14');
    expect(v1Csv).not.toContain('BAREME_ART14');
  });

  it('affiche les avertissements (ligne, colonne, message) à part des motifs d’inéligibilité', async () => {
    mockApi();
    const { container } = renderWithProviders(<ImportPage />);
    const user = userEvent.setup();

    await screen.findByRole('button', { name: 'Modèle v2 — barème Art. 14 (53 colonnes)' });
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

    await screen.findByRole('button', { name: 'Modèle v1 (47 colonnes)' });
    await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, new File(['x'], 'lot.csv', { type: 'text/csv' }));

    await waitFor(() => expect(screen.getByText('Dommages corporels déclarés')).toBeInTheDocument());
    expect(screen.queryByRole('region', { name: 'Avertissements' })).not.toBeInTheDocument();
  });
});
