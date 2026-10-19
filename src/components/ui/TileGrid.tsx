export interface Tile {
  key: string;
  code: string;
  label: string;
  value?: number;
  col: number;
  row: number;
  intensity?: number; // 0..1
  /** Infobulle complète, à la place de « code — libellé : valeur ». */
  title?: string;
  /** Donnée non disponible (ex. sans population de référence) : tuile hachurée, hors échelle de couleurs. */
  unavailable?: boolean;
  /** Texte affiché dans une tuile `unavailable` (ex. « n.d. »). */
  unavailableLabel?: string;
}

/** Hachure « donnée non disponible » — tokens uniquement, réutilisée par les légendes. */
export const UNAVAILABLE_BACKGROUND = 'repeating-linear-gradient(45deg, var(--paper) 0 3px, var(--rule-strong) 3px 5px)';

/**
 * Carte en tuiles générique (A.3) — grille `cols:13 × rows:8` (écran 11,
 * 69 wilayas), réutilisable pour d'autres cartes en tuiles futures.
 */
export function TileGrid({ tiles, cols = 13 }: { tiles: Tile[]; cols?: number }) {
  const byPos = new Map(tiles.map((t) => [`${t.col}:${t.row}`, t]));
  const maxRow = Math.max(0, ...tiles.map((t) => t.row));

  const cells: React.ReactNode[] = [];
  for (let r = 0; r <= maxRow; r++) {
    for (let c = 0; c < cols; c++) {
      const tile = byPos.get(`${c}:${r}`);
      if (!tile) {
        cells.push(<div key={`${c}:${r}`} style={{ visibility: 'hidden' }} />);
        continue;
      }
      const intensity = tile.intensity ?? 0;
      cells.push(
        <div
          key={tile.key}
          className="tile"
          data-unavailable={tile.unavailable ? 'true' : undefined}
          title={tile.title ?? `${tile.code} — ${tile.label}${tile.value !== undefined ? ` : ${tile.value}` : ''}`}
          style={
            tile.unavailable
              ? { background: UNAVAILABLE_BACKGROUND, color: 'var(--ink-3)' }
              : { background: `color-mix(in srgb, var(--k-pri-2) ${Math.round(intensity * 70)}%, var(--paper))` }
          }
        >
          <strong>{tile.code}</strong>
          {tile.unavailable ? <span>{tile.unavailableLabel}</span> : tile.value !== undefined ? <span>{tile.value}</span> : null}
        </div>,
      );
    }
  }

  return <div className="tile-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>{cells}</div>;
}
