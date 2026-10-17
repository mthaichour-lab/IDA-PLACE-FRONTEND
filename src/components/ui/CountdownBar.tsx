/**
 * Composant transverse `countdownBar(startAt, deadlineAt)` (écran 4, B.2/B.3)
 * — calqué sur le style de `ScoreBar` (même piste `.score-bar-track` /
 * `.score-bar-fill`). Affiche uniquement la proportion de temps écoulée
 * entre un point de départ et une échéance CONVENTIONNELLE fournie par
 * l'API (silence = acceptation Art. 10, opposition réputée fondée Art. 12,
 * forclusion Art. 19) : repère visuel pur, AUCUN verdict n'est calculé ici
 * (règle d'or C.1) — l'état réel (`state`/`status`) vient toujours de
 * l'API, ce composant ne fait qu'illustrer le temps restant/écoulé.
 */
export function CountdownBar({
  startAt,
  deadlineAt,
  now,
}: {
  startAt: string;
  deadlineAt: string;
  /** Injectable pour les tests ; par défaut l'heure courante. */
  now?: Date;
}) {
  const start = new Date(startAt).getTime();
  const end = new Date(deadlineAt).getTime();
  const current = (now ?? new Date()).getTime();

  const total = Math.max(1, end - start);
  const elapsed = Math.max(0, Math.min(total, current - start));
  const pct = Math.round((elapsed / total) * 100);

  const remainingMs = end - current;
  const remainingDays = Math.ceil(Math.abs(remainingMs) / 86_400_000);
  const overdue = remainingMs < 0;

  const color = overdue ? 'var(--ko)' : pct >= 80 ? 'var(--warn)' : 'var(--ok)';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 130 }}>
      <div className="score-bar-track">
        <div className="score-bar-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
      </div>
      <span className="mono" style={{ fontSize: 'var(--k-fs-xs)', color, whiteSpace: 'nowrap' }}>
        {overdue ? `J+${remainingDays}` : `J-${remainingDays}`}
      </span>
    </div>
  );
}
