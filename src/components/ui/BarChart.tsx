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

/**
 * Courbe à points nommés (cockpit, écran 1, "Statistiques de la place") —
 * même esprit SVG natif que `Sparkline` ci-dessus (A.1 : pas de dépendance
 * graphique lourde), avec des repères (cercles) par point. `label` de
 * chaque point est affiché sous le graphe (ligne HTML séparée), pas dans le
 * SVG, pour éviter le chevauchement de texte à l'échelle `preserveAspectRatio="none"`.
 */
export function LineChart({ points, height = 120 }: { points: { label: string; value: number }[]; height?: number }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const stepX = points.length > 1 ? 100 / (points.length - 1) : 0;
  const coords = points.map((p, i) => [i * stepX, height - 8 - (p.value / max) * (height - 16)] as const);
  const polyline = coords.map(([x, y]) => `${x},${y}`).join(' ');

  return (
    <div>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ width: '100%', height }} role="img" aria-label="Déclarations par mois">
        <polyline points={polyline} fill="none" stroke="var(--k-pri-2)" strokeWidth={2} />
        {coords.map(([x, y], i) => (
          <circle key={points[i].label} cx={x} cy={y} r={1.6} fill="var(--k-pri)" />
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        {points.map((p) => (
          <span key={p.label} className="mono" style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)' }}>
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}
