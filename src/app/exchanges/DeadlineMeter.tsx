/**
 * Jauge d'échéance conventionnelle propre à l'écran Échanges (maquette
 * écran 4) : libellé du délai + temps restant, barre, puis date de départ
 * et date d'échéance. Même calcul d'AFFICHAGE que `CountdownBar` (écart
 * entre deux dates déjà renvoyées par l'API — `requestSentAt` /
 * `timer.deadlineAt`) : aucune règle Art. 10/12/19 n'est tranchée ici,
 * l'état réel du recours vient toujours de `state` (règle d'or C.1).
 */
export function meterInfo(startAt: string, deadlineAt: string, now: Date = new Date()) {
  const start = new Date(startAt).getTime();
  const end = new Date(deadlineAt).getTime();
  const current = now.getTime();
  const span = Math.max(1, end - start);
  const elapsed = Math.min(span, Math.max(0, current - start));
  const percent = Math.round((elapsed / span) * 100);
  const remainingMs = end - current;
  const overdue = remainingMs <= 0;
  const remainingDays = Math.ceil(Math.abs(remainingMs) / (24 * 60 * 60 * 1000));
  const tone = overdue ? 'ko' : percent >= 75 ? 'warn' : 'ok';
  return { percent, overdue, remainingDays, tone };
}

function shortDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function DeadlineMeter({
  label,
  startAt,
  deadlineAt,
  locale,
  remainingLabel,
  dueOnLabel,
  compact = false,
}: {
  label: string;
  startAt: string;
  deadlineAt: string;
  locale: string;
  /** Libellé traduit du temps restant (« 12 j restants », « 3 j de retard »). */
  remainingLabel: (info: { remainingDays: number; overdue: boolean }) => string;
  dueOnLabel: string;
  compact?: boolean;
}) {
  const info = meterInfo(startAt, deadlineAt);
  const width = `${Math.max(0, Math.min(100, info.percent))}%`;

  if (compact) {
    return (
      <div className={`ex-meter compact ${info.tone}`}>
        <span className="ex-meter-label">{label}</span>
        <div className="ex-meter-track">
          <div className="ex-meter-fill" style={{ width }} />
        </div>
        <span className="ex-meter-left mono">{remainingLabel(info)}</span>
      </div>
    );
  }

  return (
    <div className={`ex-meter ${info.tone}`}>
      <div className="ex-meter-top">
        <span className="ex-meter-label">{label}</span>
        <span className="ex-meter-left mono">{remainingLabel(info)}</span>
      </div>
      <div className="ex-meter-track">
        <div className="ex-meter-fill" style={{ width }} />
      </div>
      <div className="ex-meter-dates mono">
        <span>{shortDate(startAt, locale)}</span>
        <span>
          {dueOnLabel} {shortDate(deadlineAt, locale)}
        </span>
      </div>
    </div>
  );
}
