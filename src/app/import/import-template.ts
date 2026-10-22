import { buildCsv } from '@/lib/csv';
import { ClaimColumnDef } from '@/lib/types';

/**
 * Modèle d'import À REMPLIR : une seule ligne d'en-tête portant les
 * LIBELLÉS des colonnes (`GET /claims/import/columns[/v2]`), dans l'ordre de
 * leur position, séparateur `;`. Le parseur du backend (`claim-parser.ts`)
 * lit les colonnes par POSITION (ligne 1 = en-tête, ignorée hormis le
 * contrôle « au moins 47 cellules non vides »), détecte `;` ou `,` sur
 * l'en-tête et tolère le BOM UTF-8 ajouté par `downloadCsv` pour Excel.
 * Une ligne par dossier sous l'en-tête.
 */
export function buildImportTemplateCsv(columns: readonly ClaimColumnDef[]): string {
  const labels = [...columns].sort((a, b) => a.index - b.index).map((c) => c.label);
  return `${buildCsv(labels, [])}\r\n`;
}

export function importTemplateFileName(version: 'v1' | 'v2', columnCount: number): string {
  return version === 'v1' ? `modele-${columnCount}-colonnes-IDA.csv` : `modele-v2-${columnCount}-colonnes-IDA.csv`;
}

export function importDictionaryFileName(columnCount: number): string {
  return `dictionnaire-${columnCount}-colonnes-IDA.csv`;
}
