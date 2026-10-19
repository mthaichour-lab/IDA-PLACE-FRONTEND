import { ClaimColumnDef, LedgerEntry } from './types';

/**
 * Exports CSV côté client — SEC-39.
 *
 * - Échappement RFC 4180 : un champ contenant le séparateur, une virgule,
 *   un guillemet, CR ou LF est entouré de guillemets, les guillemets
 *   internes sont doublés ; lignes séparées par CRLF.
 * - Neutralisation des formules (injection CSV / DDE) : toute cellule
 *   TEXTE commençant par `=`, `+`, `-`, `@`, une tabulation ou un retour
 *   chariot est préfixée d'une apostrophe, pour qu'Excel/LibreOffice
 *   l'affichent comme du texte au lieu de l'évaluer. Les nombres ne sont pas
 *   concernés (un `-12` numérique reste un nombre).
 * - Séparateur `;` (Excel en paramètres régionaux français) et BOM UTF-8
 *   au téléchargement pour les accents.
 */
export const CSV_SEPARATOR = ';';
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

export function csvCell(value: unknown, separator: string = CSV_SEPARATOR): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value !== 'number' && typeof value !== 'bigint' && FORMULA_TRIGGER.test(text)) {
    text = `'${text}`;
  }
  const mustQuote = text.includes(separator) || /[",\r\n]/.test(text);
  return mustQuote ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCsv(header: readonly string[], rows: readonly (readonly unknown[])[], separator: string = CSV_SEPARATOR): string {
  return [header, ...rows].map((row) => row.map((cell) => csvCell(cell, separator)).join(separator)).join('\r\n');
}

/** Export du journal scellé (écran 13) — placeholder documenté : l'API n'expose pas d'endpoint d'export. */
export function buildLedgerCsv(entries: readonly LedgerEntry[]): string {
  return buildCsv(
    ['id', 'at', 'type', 'ref', 'actor', 'summary', 'hash', 'prevHash'],
    entries.map((e) => [e.id, e.at, e.type, e.ref, e.actor, e.summary, e.hash, e.prevHash ?? '']),
  );
}

/** Modèle de colonnes d'import (v1 ou v2) — pas un classeur Excel mis en forme. */
export function buildColumnsCsv(columns: readonly ClaimColumnDef[]): string {
  return buildCsv(
    ['index', 'key', 'label', 'group', 'type', 'enumValues'],
    columns.map((c) => [c.index, c.key, c.label, c.group, c.type, c.enumValues?.join('|') ?? '']),
  );
}

/** Déclenche le téléchargement d'un CSV (BOM UTF-8 pour Excel). */
export function downloadCsv(fileName: string, content: string): void {
  const blob = new Blob(['﻿', content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
