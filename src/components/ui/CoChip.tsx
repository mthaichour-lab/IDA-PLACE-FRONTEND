import { safeColor } from '@/lib/safe-values';

/**
 * Composant transverse `coChip(code)` (A.3) : logo compagnie en vignette
 * colorée. SEC-50 : la couleur vient de l'API (référentiel compagnies) et
 * n'est appliquée que si elle respecte `#RRGGBB`.
 */
export function CoChip({ code, color }: { code: string; color?: string }) {
  return (
    <span className="co-chip" style={{ background: safeColor(color) }}>
      {code}
    </span>
  );
}
