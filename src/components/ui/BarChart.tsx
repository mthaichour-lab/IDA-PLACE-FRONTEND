/** Composant transverse `barChart` (A.3) — SVG natif, pas de dépendance graphique lourde (A.1). */
export function BarChart({ data, height = 120 }: { data: { label: string; value: number }[]; height?: number }) {
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  const barWidth = 100 / data.length;

  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ width: '100%', height }} role="img" aria-label="Diagramme en barres">
      {data.map((d, i) => {
        const h = (Math.abs(d.value) / max) * (height - 20);
        const x = i * barWidth + barWidth * 0.15;
        const w = barWidth * 0.7;
        const y = d.value >= 0 ? height - 20 - h : height - 20;
        return (
          <g key={d.label}>
            <rect x={x} y={y} width={w} height={Math.max(1, h)} fill={d.value >= 0 ? 'var(--k-pri-2)' : 'var(--ko)'} rx={1} />
          </g>
        );
      })}
      <line x1={0} y1={height - 20} x2={100} y2={height - 20} stroke="var(--rule-strong)" strokeWidth={0.5} />
    </svg>
  );
}

/** Mini sparkline (cockpit, écran 1) — même esprit SVG natif. */
export function Sparkline({ values, height = 40 }: { values: number[]; height?: number }) {
  const max = Math.max(1, ...values);
  const points = values
    .map((v, i) => `${(i / Math.max(1, values.length - 1)) * 100},${height - (v / max) * height}`)
    .join(' ');
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ width: '100%', height }} role="img" aria-label="Évolution récente">
      <polyline points={points} fill="none" stroke="var(--k-pri-2)" strokeWidth={2} />
    </svg>
  );
}
