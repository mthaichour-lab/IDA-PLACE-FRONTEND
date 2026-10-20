import type { ReactNode } from 'react';

/** Unités affichées en petit à droite de la valeur, comme la maquette. */
const UNIT = /^(.*\S)[\s\u00a0\u202f](DA|j|h|min)$/;

/**
 * Composant transverse `.kpi` (A.3) : valeur + libellé + extra optionnel.
 * Une valeur texte terminée par une unité connue (« 1 234 DA », « 12 j »)
 * est scindée pour afficher l'unité en petit, sans changer le texte lu.
 */
export function Kpi({ value, label, extra, title, unit }: { value: ReactNode; label: string; extra?: ReactNode; title?: string; unit?: string }) {
  let main: ReactNode = value;
  let suffix = unit;
  if (!suffix && typeof value === 'string') {
    const m = UNIT.exec(value);
    if (m) {
      main = m[1];
      suffix = m[2];
    }
  }
  return (
    <div className="kpi" title={title}>
      <div className="kpi-value">
        {main}
        {suffix ? <span className="kpi-unit"> {suffix}</span> : null}
      </div>
      <div className="kpi-label">{label}</div>
      {extra ? <div className="kpi-extra">{extra}</div> : null}
    </div>
  );
}

export function KpiRow({ children }: { children: ReactNode }) {
  return <div className="kpi-row">{children}</div>;
}
