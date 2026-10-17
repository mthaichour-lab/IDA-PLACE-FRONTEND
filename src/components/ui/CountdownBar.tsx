/**
 * Composant transverse `countdownBar` (A.4, écran 4 "Échanges Annexes
 * 2/3/4") : barre de progression + temps restant jusqu'à une échéance
 * conventionnelle (silence = acceptation Art. 10 ; opposition réputée
 * fondée Art. 12 ; forclusion Art. 19).
 *
 * **Purement présentationnel** (règle d'or C.1) : les deux dates
 * (`startAt`/`deadlineAt`) sont déjà renvoyées par l'API
 * (`Recours.requestSentAt`/`conventionalDeadlineAt`, B.3). Ce composant ne
 * fait qu'un calcul d'affichage — un écart de dates, comme un "il y a 3
 * jours" — pour positionner la barre et formater le libellé ; il ne
 * tranche AUCUNE règle métier Art. 10/12/19 : l'état réel du dossier
 * provient toujours de `state`, jamais déduit ici.
 *
 * Idéalement l'API renverrait directement un pourcentage/temps restant
 * précalculé (`remainingPercent`, `remainingLabel`) plutôt que les deux
 * dates brutes — voir HANDOFF.md « Vague 2 » pour cette limitation
 * documentée (RecoursModule reste un mock côté back au moment de cet
 * écran).
 */
export function CountdownBar({
  startAt,
  deadlineAt,
  now,
  renderLabel,
}: {
  startAt: string;
  deadlineAt: string;
  /** Horodatage de référence (tests/SSR) — défaut : l'instant du rendu. */
  now?: Date;
  /** Formatte le libellé (i18n) à partir du calcul d'affichage ci-dessus. */
  renderLabel: (info: { percent: number; remainingDays: number; overdue: boolean }) => string;
}) {
  const start = new Date(startAt).getTime();
  const end = new Date(deadlineAt).getTime();
  const current = (now ?? new Date()).getTime();

  const span = Math.max(1, end - start);
  const elapsed = Math.min(span, Math.max(0, current - start));
  const percent = Math.round((elapsed / span) * 100);

  const remainingMs = end - current;
  const overdue = remainingMs <= 0;
  const remainingDays = Math.ceil(Math.abs(remainingMs) / (24 * 60 * 60 * 1000));

  const color = overdue ? 'var(--ko)' : percent >= 75 ? 'var(--warn)' : 'var(--ok)';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 150 }}>
      <div className="score-bar-track" style={{ minWidth: 70 }}>
        <div
          className="score-bar-fill"
          style={{ width: `${Math.max(0, Math.min(100, percent))}%`, background: color }}
        />
      </div>
      <span className="mono" style={{ fontSize: 'var(--k-fs-xs)', color, whiteSpace: 'nowrap' }}>
        {renderLabel({ percent, remainingDays, overdue })}
      </span>
    </div>
  );
}
