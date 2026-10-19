import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildColumnsCsv, buildCsv, buildLedgerCsv, csvCell, downloadCsv } from './csv';
import { LedgerEntry } from './types';

describe('csvCell — RFC 4180 et neutralisation des formules (SEC-39)', () => {
  it.each([
    ['=1+1', "'=1+1"],
    ['+33 6 00', "'+33 6 00"],
    ['-2+3', "'-2+3"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\tcache', "'\tcache"],
  ])('neutralise %j', (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it('neutralise un retour chariot initial puis met le champ entre guillemets', () => {
    expect(csvCell('\r=cmd')).toBe('"\'\r=cmd"');
  });

  it('neutralise =HYPERLINK et échappe ses guillemets et séparateurs', () => {
    expect(csvCell('=HYPERLINK("http://evil.example";"clic")')).toBe('"\'=HYPERLINK(""http://evil.example"";""clic"")"');
  });

  it('entoure de guillemets les champs avec séparateur, virgule, guillemet ou saut de ligne', () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('dit "bonjour"')).toBe('"dit ""bonjour"""');
    expect(csvCell('ligne1\nligne2')).toBe('"ligne1\nligne2"');
  });

  it('laisse intacts textes ordinaires et nombres (y compris négatifs)', () => {
    expect(csvCell('Choc arrière')).toBe('Choc arrière');
    expect(csvCell(-12)).toBe('-12');
    expect(csvCell(0)).toBe('0');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });
});

describe('exports', () => {
  const entry: LedgerEntry = {
    id: 'L-1',
    at: '2026-10-19T08:00:00.000Z',
    type: 'RECOURS',
    ref: 'R-1',
    actor: '@admin',
    summary: '=HYPERLINK("http://evil.example";"Voir")',
    hash: 'abc',
    prevHash: null,
  };

  it('buildLedgerCsv : en-tête, CRLF, cellules neutralisées et échappées', () => {
    const csv = buildLedgerCsv([entry]);
    const [header, line] = csv.split('\r\n');
    expect(header).toBe('id;at;type;ref;actor;summary;hash;prevHash');
    expect(line).toBe('L-1;2026-10-19T08:00:00.000Z;RECOURS;R-1;\'@admin;"\'=HYPERLINK(""http://evil.example"";""Voir"")";abc;');
  });

  it('buildColumnsCsv : valeurs énumérées et libellés sûrs', () => {
    const csv = buildColumnsCsv([{ index: 1, key: 'k', label: '+ montant', group: 'IDENTIFICATION', type: 'enum', enumValues: ['A', 'B'] }]);
    expect(csv.split('\r\n')[1]).toBe("1;k;'+ montant;IDENTIFICATION;enum;A|B");
  });

  it('buildCsv : nombre de colonnes stable', () => {
    expect(buildCsv(['a', 'b'], [['x;y', 'z']])).toBe('a;b\r\n"x;y";z');
  });
});

describe('downloadCsv', () => {
  afterEach(() => vi.restoreAllMocks());

  it('télécharge un Blob CSV précédé du BOM UTF-8', async () => {
    let captured: Blob | undefined;
    URL.createObjectURL = vi.fn((b: Blob) => {
      captured = b;
      return 'blob:x';
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    downloadCsv('export.csv', 'a;b');

    expect(click).toHaveBeenCalled();
    expect(captured?.type).toBe('text/csv;charset=utf-8');
    const buffer = await new Promise<ArrayBuffer>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.readAsArrayBuffer(captured!);
    });
    const bytes = new Uint8Array(buffer);
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
  });
});
