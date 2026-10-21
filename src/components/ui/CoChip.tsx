'use client';

import { useCompanyEntry } from '@/lib/company-directory';
import { safeColor } from '@/lib/safe-values';

/**
 * Logos réels des compagnies adhérentes, fournis par l'opérateur de place
 * (fichiers statiques sous `public/brand-logos/`, jamais de dépendance
 * externe). Clé = code compagnie en MAJUSCULES, comme le référentiel.
 * Une compagnie sans fichier ici (test/démo : GAM, GOVE, NEW2, QAT1, WDR1…)
 * retombe sur la vignette texte ci-dessous.
 */
const BRAND_LOGOS: Record<string, string> = {
  CAAR: '/brand-logos/CAAR.png',
  CAAT: '/brand-logos/CAAT.webp',
  '2A': '/brand-logos/2A.jpg',
  SAA: '/brand-logos/SAA.png',
  CASH: '/brand-logos/CASH.png',
};

/**
 * Composant transverse `coChip(code)` (A.3) : vignette « logo » de la
 * compagnie, comme la maquette — cartouche blanc bordé. Affiche le vrai
 * logo de la compagnie quand il est disponible (`BRAND_LOGOS`) ; sinon,
 * repli sur le code dans sa couleur de marque (`color`, passée par
 * l'appelant ou lue dans l'annuaire chargé par la coque). SEC-50 : dans le
 * repli, la couleur n'est appliquée que si elle respecte `#RRGGBB`.
 */
export function CoChip({ code, color, name, withName = false }: { code: string; color?: string; name?: string; withName?: boolean }) {
  const entry = useCompanyEntry(code);
  const label = name ?? entry?.name;
  const logo = BRAND_LOGOS[code.toUpperCase()];
  return (
    <span className="co-chip-wrap" title={label ?? code}>
      {logo ? (
        <span className="co-chip co-chip-img">
          <img src={logo} alt={label ?? code} />
        </span>
      ) : (
        <span className="co-chip" style={{ color: safeColor(color ?? entry?.color, 'var(--ink-2)') }}>
          {code}
        </span>
      )}
      {withName && label ? <span className="co-chip-name">{label}</span> : null}
    </span>
  );
}
