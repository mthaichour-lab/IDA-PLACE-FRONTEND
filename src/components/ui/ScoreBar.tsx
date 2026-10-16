/** Composant transverse `scoreBar(score)` (A.3) — score 0-100 affiché par le back (B.5). */
export function ScoreBar({ score }: { score: number }) {
  const color = score >= 80 ? 'var(--ok)' : score >= 50 ? 'var(--warn)' : 'var(--ko)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
      <div className="score-bar-track">
        <div className="score-bar-fill" style={{ width: `${Math.max(0, Math.min(100, score))}%`, background: color }} />
      </div>
      <span className="mono" style={{ fontSize: 'var(--k-fs-xs)', color }}>
        {score}
      </span>
    </div>
  );
}
