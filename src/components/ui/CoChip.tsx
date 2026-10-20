'use client';

import { useCompanyEntry } from '@/lib/company-directory';
import { safeColor } from '@/lib/safe-values';

/**
 * Composant transverse `coChip(code)` (A.3) : vignette « logo » de la
 * compagnie, comme la maquette — cartouche blanc bordé portant le code de
 * la compagnie dans sa couleur de marque. Aucun logo propriétaire n'est
 * embarqué : la couleur est celle du référentiel (`color`, passée par
 * l'appelant ou lue dans l'annuaire chargé par la coque). SEC-50 : la
 * couleur n'est appliquée que si elle respecte `#RRGGBB`.
 */
export function CoChip({ code, color, name, withName = false }: { code: string; color?: string; name?: string; withName?: boolean }) {
  const entry = useCompanyEntry(code);
  const brand = safeColor(color ?? entry?.color, 'var(--ink-2)');
  const label = name ?? entry?.name;
  return (
    <span className="co-chip-wrap" title={label ?? code}>
      <span className="co-chip" style={{ color: brand }}>
        {code}
      </span>
      {withName && label ? <span className="co-chip-name">{label}</span> : null}
    </span>
  );
}
