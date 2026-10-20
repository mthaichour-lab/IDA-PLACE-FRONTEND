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

/** Borne haute « ronde » de l'axe (1, 1,2, 1,5, 2, 2,5, 3, 4, 5, 6, 8 × 10ⁿ). */
function niceMax(value: number): number {
  const pow = 10 ** Math.floor(Math.log10(Math.max(1, value)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * pow >= value) return m * pow;
  return 10 * pow;
}

/**
 * Courbe à points nommés (cockpit, écran 1, "Statistiques de la place") —
 * SVG natif (A.1 : pas de dépendance graphique lourde) : grille et axe Y
 * gradué (0, ½, max), tracé à épaisseur constante (`non-scaling-stroke`),
 * repères ronds en HTML positionnés en % (jamais déformés par l'échelle
 * `preserveAspectRatio="none"`), libellés X en police mono.
 */
export function LineChart({ points, height = 150, ariaLabel = 'Déclarations par mois' }: { points: { label: string; value: number }[]; height?: number; ariaLabel?: string }) {
  const max = niceMax(Math.max(1, ...points.map((p) => p.value)));
  const ticks = [max, max / 2, 0];
  const n = points.length;
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * 100 : 50);
  const y = (v: number) => 100 - (v / max) * 100;
  const polyline = points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ');

  return (
    <div className="line-chart">
      <div className="line-chart-plot" style={{ height }}>
        <div className="line-chart-y" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} style={{ top: `${y(tick)}%` }}>
              {Number.isInteger(tick) ? tick : tick.toFixed(1)}
            </span>
          ))}
        </div>
        <div className="line-chart-area">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={ariaLabel}>
            {ticks.map((tick) => (
              <line key={tick} x1={0} x2={100} y1={y(tick)} y2={y(tick)} className={tick === 0 ? 'line-chart-base' : 'line-chart-grid'} vectorEffect="non-scaling-stroke" />
            ))}
            <polyline points={polyline} fill="none" stroke="var(--k-pri-2)" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>
          {points.map((p, i) => (
            <span key={p.label} className="line-chart-dot" style={{ left: `${x(i)}%`, top: `${y(p.value)}%` }} title={`${p.label} : ${p.value}`} />
          ))}
        </div>
      </div>
      <div className="line-chart-x" aria-hidden="true">
        {points.map((p, i) => (
          <span key={p.label} style={{ left: `${x(i)}%` }}>
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}
