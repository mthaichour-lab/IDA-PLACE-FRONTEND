import { CoChip } from '@/components/ui/CoChip';

/**
 * `ExchangeThread` — composant transverse (A.3) : fil d'échanges façon
 * messagerie, PARTAGÉ par `/exchanges` (écran 4, fil Annexe 2/3/4 d'un
 * recours) et `/commission` (écran 7, pièces échangées contradictoirement
 * d'un dossier de commission) — un seul rendu, deux alimentations
 * différentes (voir `buildRecoursExchangeEvents`, `src/lib/recours-timeline.ts`,
 * et la construction propre à `/commission` dans `commission/page.tsx`).
 *
 * Purement présentationnel (règle d'or C.1) : ce composant ne reconstruit
 * AUCUNE donnée — il reçoit des `ExchangeEvent` déjà résolus par l'appelant
 * (libellé traduit, texte réel, alignement) et se contente de les grouper
 * par jour et de les aligner en bulles.
 *
 * `side`/`tone` sont volontairement DISSOCIÉS de « nous »/« la partie
 * adverse » au niveau du composant : c'est l'appelant qui sait, selon le
 * rôle du visiteur (compagnie ou place, voir SEC-17/SEC-25), ce qui doit
 * être traité comme « notre » camp, « l'autre » camp, ou un évènement
 * neutre (place/système, ou pièce dont la compagnie déposante n'est pas
 * exposée par l'API — voir HANDOFF du composant).
 */
export type ExchangeSide = 'left' | 'right' | 'center';
export type ExchangeTone = 'self' | 'party' | 'neutral';

export interface ExchangeAttachment {
  id: string;
  filename: string;
  /** Absent si l'appelant n'a pas cette donnée sous la main (affichage dégradé, jamais une taille inventée). */
  sizeBytes?: number;
}

export interface ExchangeEvent {
  key: string;
  /** Horodatage réel (champ API) — aucun calcul, aucune valeur par défaut. */
  at: string;
  side: ExchangeSide;
  tone: ExchangeTone;
  /** Code compagnie réel (référentiel) associé à cet évènement — absent pour un évènement neutre/système. */
  companyCode?: string;
  /** Couleur réelle de la compagnie (`CompanyView.color`, SEC-50) — `CoChip` applique son propre repli si absente/invalide. */
  companyColor?: string;
  /**
   * Libellé d'auteur à afficher — SEC-17 : jamais un nom d'agent pour un
   * évènement qui n'en expose pas un réellement (ex. compagnie seule, ou
   * texte générique « Décision de la Commission »). Quand une pièce est
   * déposée (`DocumentView.uploadedBy`), ce champ porte ce nom réel.
   */
  authorLabel?: string;
  /** Libellé de l'évènement — déjà traduit par l'appelant (`t(...)`). */
  label: string;
  /** Texte réel associé (motif d'opposition/contestation, note de résolution...) — jamais fabriqué. */
  body?: string;
  /** Ligne secondaire courte optionnelle (ex. montant). */
  meta?: string;
  attachments?: ExchangeAttachment[];
}

function formatSize(bytes?: number): string | undefined {
  if (bytes === undefined) return undefined;
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}

function toneStyle(tone: ExchangeTone): React.CSSProperties {
  if (tone === 'self') return { background: 'var(--k-mint)', borderColor: 'var(--k-pri)' };
  if (tone === 'party') return { background: 'var(--ko-soft)', borderColor: 'var(--ko)' };
  return { background: 'var(--neutral-soft)', borderColor: 'var(--rule-strong)' };
}

export function ExchangeThread({ events, locale, emptyLabel }: { events: ExchangeEvent[]; locale: string; emptyLabel: string }) {
  if (events.length === 0) {
    return <p style={{ color: 'var(--ink-3)', fontSize: 'var(--k-fs-s)', margin: 0 }}>{emptyLabel}</p>;
  }

  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at));
  const days: { key: string; events: ExchangeEvent[] }[] = [];
  for (const ev of sorted) {
    const key = dayKey(ev.at);
    const last = days[days.length - 1];
    if (last && last.key === key) last.events.push(ev);
    else days.push({ key, events: [ev] });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' }}>
      {days.map((day) => (
        <div key={day.key} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}>
          <div style={{ textAlign: 'center', fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)' }}>
            {new Date(day.events[0].at).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
          {day.events.map((ev) => (
            <div
              key={ev.key}
              style={{
                display: 'flex',
                justifyContent: ev.side === 'right' ? 'flex-end' : ev.side === 'center' ? 'center' : 'flex-start',
              }}
            >
              <div
                style={{
                  maxWidth: ev.side === 'center' ? '85%' : '78%',
                  border: '1px solid',
                  borderRadius: 'var(--k-r-m)',
                  padding: 'var(--s-3)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  ...toneStyle(ev.tone),
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s-3)' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--k-fs-xs)', fontWeight: 600, color: 'var(--ink-2)' }}>
                    {ev.companyCode ? <CoChip code={ev.companyCode} color={ev.companyColor} /> : null}
                    {ev.authorLabel ?? ev.companyCode ?? ''}
                  </span>
                  <span className="mono" style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)' }}>
                    {new Date(ev.at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <strong style={{ fontSize: 'var(--k-fs-s)' }}>{ev.label}</strong>
                {ev.body ? <p style={{ margin: 0, fontSize: 'var(--k-fs-s)' }}>{ev.body}</p> : null}
                {ev.meta ? (
                  <span className="mono" style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)' }}>
                    {ev.meta}
                  </span>
                ) : null}
                {ev.attachments && ev.attachments.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                    {ev.attachments.map((a) => (
                      <span
                        key={a.id}
                        className="mono"
                        style={{
                          fontSize: 'var(--k-fs-xs)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          background: 'var(--paper)',
                          border: '1px solid var(--rule)',
                          borderRadius: 'var(--k-r-s)',
                          padding: '2px 8px',
                        }}
                      >
                        📎 {a.filename}
                        {formatSize(a.sizeBytes) ? ` · ${formatSize(a.sizeBytes)}` : ''}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
