/** Composant transverse `.kpi` (A.3) : valeur + libellé + extra optionnel. */
export function Kpi({ value, label, extra }: { value: string | number; label: string; extra?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
      {extra ? <div className="kpi-extra">{extra}</div> : null}
    </div>
  );
}

export function KpiRow({ children }: { children: React.ReactNode }) {
  return <div className="kpi-row">{children}</div>;
}
