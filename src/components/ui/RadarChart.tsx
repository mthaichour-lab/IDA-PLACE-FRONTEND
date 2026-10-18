export interface RadarAxis {
  key: string;
  label: string;
  /** Score normalisé 0-100 (sens "plus haut = meilleur") — `null` (composante `NON_DISPONIBLE`) tracé comme 0, jamais un crash. */
  value: number | null;
}

/**
 * Composant transverse `radarChart` (A.3, écran 8 "Monitoring assureurs") —
 * SVG natif, même esprit que `BarChart`/`Sparkline` (pas de dépendance
 * graphique lourde, A.1). N axes répartis en cercle, démarrant en haut et
 * tournant dans le sens horaire (`angle = -90° + i·360°/n`, le repère écran
 * ayant l'axe Y vers le bas).
 */
export function RadarChart({ axes, centerValue, size = 320 }: { axes: RadarAxis[]; centerValue?: number | null; size?: number }) {
  const n = axes.length;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 46; // marge pour les libellés d'axe
  const labelRadius = radius + 24;

  function angleFor(i: number): number {
    return (Math.PI * 2 * i) / n - Math.PI / 2;
  }

  function pointAt(i: number, r: number): [number, number] {
    const angle = angleFor(i);
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  }

  const RINGS = [0.25, 0.5, 0.75, 1];

  const polygonPoints = axes.map((a, i) => pointAt(i, (Math.max(0, Math.min(100, a.value ?? 0)) / 100) * radius).join(',')).join(' ');

  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: '100%', height: 'auto', maxWidth: size }} role="img" aria-label="Profil de conformité par critère (radar)">
      {RINGS.map((f) => (
        <polygon key={f} points={axes.map((_, i) => pointAt(i, f * radius).join(',')).join(' ')} fill="none" stroke="var(--rule)" strokeWidth={1} />
      ))}
      {axes.map((a, i) => {
        const [x, y] = pointAt(i, radius);
        return <line key={`axis-${a.key}`} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--rule)" strokeWidth={1} />;
      })}
      <polygon points={polygonPoints} fill="var(--k-acc-2)" fillOpacity={0.35} stroke="var(--k-pri)" strokeWidth={2} />
      {axes.map((a, i) => {
        const value = a.value ?? 0;
        const [x, y] = pointAt(i, (Math.max(0, Math.min(100, value)) / 100) * radius);
        return <circle key={`pt-${a.key}`} cx={x} cy={y} r={3} fill="var(--k-pri)" />;
      })}
      {axes.map((a, i) => {
        const [x, y] = pointAt(i, labelRadius);
        const cos = Math.cos(angleFor(i));
        const anchor = cos > 0.3 ? 'start' : cos < -0.3 ? 'end' : 'middle';
        return (
          <text key={`label-${a.key}`} x={x} y={y} textAnchor={anchor} dominantBaseline="middle" fontSize={12} fill="var(--ink-2)">
            {a.label}
          </text>
        );
      })}
      {centerValue !== null && centerValue !== undefined ? (
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" className="mono" fontSize={size / 8} fontWeight={700} fill="var(--k-pri)">
          {Math.round(centerValue)}
        </text>
      ) : null}
    </svg>
  );
}
