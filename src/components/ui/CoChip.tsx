/** Composant transverse `coChip(code)` (A.3) : logo compagnie en vignette colorée. */
export function CoChip({ code, color = '#6A6E6D' }: { code: string; color?: string }) {
  return (
    <span className="co-chip" style={{ background: color }}>
      {code}
    </span>
  );
}
