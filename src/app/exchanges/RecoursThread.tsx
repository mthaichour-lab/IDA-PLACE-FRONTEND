import { Check, Paperclip } from 'lucide-react';
import type { ExchangeEvent } from '@/components/shared/ExchangeThread';
import { CoChip } from '@/components/ui/CoChip';

/**
 * Rendu « messagerie » du fil Annexes 2/3/4 propre à l'écran Échanges
 * (maquette écran 4) : pastille de date, auteur au-dessus de la bulle,
 * vignette compagnie et heure sous la bulle. Consomme EXACTEMENT les
 * `ExchangeEvent` produits par `buildRecoursExchangeEvents` (même contrat
 * que le composant partagé `ExchangeThread`, toujours utilisé par
 * `/commission`) : purement présentationnel, aucun évènement, auteur ni
 * camp n'est reconstruit ici — `side`/`tone` viennent de l'appelant
 * (`sideToneFor`, SEC-17/SEC-25 : un visiteur place voit des bulles
 * neutres, jamais un camp inventé).
 */

function dayKey(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}

function formatSize(bytes?: number): string | undefined {
  if (bytes === undefined) return undefined;
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export function RecoursThread({
  events,
  locale,
  emptyLabel,
  companyName,
}: {
  events: ExchangeEvent[];
  locale: string;
  emptyLabel: string;
  /** Nom réel d'une compagnie (référentiel) — repli sur le code si inconnu. */
  companyName: (code: string) => string | undefined;
}) {
  if (events.length === 0) return <p className="ex-thread-empty">{emptyLabel}</p>;

  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at));
  const days: { key: string; events: ExchangeEvent[] }[] = [];
  for (const ev of sorted) {
    const key = dayKey(ev.at);
    const last = days[days.length - 1];
    if (last && last.key === key) last.events.push(ev);
    else days.push({ key, events: [ev] });
  }

  const time = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="ex-thread">
      {days.map((day) => (
        <div key={day.key} className="ex-day">
          <div className="ex-day-pill">{new Date(day.events[0].at).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}</div>
          {day.events.map((ev) => {
            if (ev.side === 'center') {
              return (
                <div key={ev.key} className="ex-sys">
                  <Check size={14} strokeWidth={2} aria-hidden="true" />
                  <span>
                    <strong>{ev.label}</strong>
                    {ev.body ? ` — ${ev.body}` : ''}
                  </span>
                  <span className="mono">{time(ev.at)}</span>
                </div>
              );
            }
            const author = ev.authorLabel ?? (ev.companyCode ? companyName(ev.companyCode) ?? ev.companyCode : undefined);
            return (
              <div key={ev.key} className={`ex-msg ${ev.side} ${ev.tone}`}>
                {author ? <div className="ex-msg-author">{author}</div> : null}
                <div className="ex-bubble">
                  <strong className="ex-bubble-title">{ev.label}</strong>
                  {ev.body ? <p className="ex-bubble-body">{ev.body}</p> : null}
                  {ev.meta ? <span className="ex-bubble-meta mono">{ev.meta}</span> : null}
                  {ev.attachments && ev.attachments.length > 0 ? (
                    <div className="ex-bubble-files">
                      {ev.attachments.map((a) => (
                        <span key={a.id} className="ex-bubble-file mono">
                          <Paperclip size={12} strokeWidth={2} aria-hidden="true" /> {a.filename}
                          {formatSize(a.sizeBytes) ? ` · ${formatSize(a.sizeBytes)}` : ''}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="ex-msg-foot">
                  {ev.companyCode ? <CoChip code={ev.companyCode} color={ev.companyColor} /> : null}
                  <span className="mono">{time(ev.at)}</span>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
