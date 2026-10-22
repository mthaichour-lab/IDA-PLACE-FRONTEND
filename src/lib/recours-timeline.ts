import { ExchangeEvent, ExchangeSide, ExchangeTone } from '@/components/shared/ExchangeThread';
import { TranslationKey } from '@/i18n/translations';
import { RecoursItem } from './types';

/** Libellé d'affichage d'un `resolution.kind` (B.3 RecoursModule) — valeurs exactes, voir recours.rules.ts back. */
export const RESOLUTION_LABELS: Record<string, TranslationKey> = {
  ACCEPTATION_EXPRESSE: 'exchanges.detail.timeline.resolution.ACCEPTATION_EXPRESSE',
  ACCEPTATION_TACITE_ART10: 'exchanges.detail.timeline.resolution.ACCEPTATION_TACITE_ART10',
  OPPOSITION_LEVEE: 'exchanges.detail.timeline.resolution.OPPOSITION_LEVEE',
  OPPOSITION_FONDEE_ART12: 'exchanges.detail.timeline.resolution.OPPOSITION_FONDEE_ART12',
  DECISION_COMMISSION_FAVORABLE: 'exchanges.detail.timeline.resolution.DECISION_COMMISSION_FAVORABLE',
  DECISION_COMMISSION_DEFAVORABLE: 'exchanges.detail.timeline.resolution.DECISION_COMMISSION_DEFAVORABLE',
  FORCLUSION_ART19: 'exchanges.detail.timeline.resolution.FORCLUSION_ART19',
};

/**
 * Compagnies « automatiques/neutres » pour une résolution (silence Art.10,
 * opposition réputée fondée Art.12, forclusion Art.19) — déclenchées par un
 * délai conventionnel, par AUCUNE compagnie (`applyAutomaticTransitions`,
 * back `recours.rules.ts`) : jamais attribuées à une compagnie pour ne pas
 * fabriquer un auteur qui n'existe pas.
 */
const AUTOMATIC_RESOLUTION_KINDS = new Set(['ACCEPTATION_TACITE_ART10', 'OPPOSITION_FONDEE_ART12', 'FORCLUSION_ART19']);
/** Décisions de la Commission — acte de place (SEC-25), jamais d'une compagnie. */
const COMMISSION_RESOLUTION_KINDS = new Set(['DECISION_COMMISSION_FAVORABLE', 'DECISION_COMMISSION_DEFAVORABLE']);

/**
 * Détermine le côté (gauche/droite/centre) et la teinte (notre camp/camp
 * adverse/neutre) d'un évènement réel d'un recours, à l'identique pour
 * `/exchanges` (visiteur compagnie ou place) et pour le fil réutilisé par
 * `/commission` (visiteur quasi toujours place, SEC-25).
 *
 * - Visiteur compagnie (`meCompany` renseigné) : « nous » = notre propre
 *   compagnie (droite, vert — token `--k-mint`/`--k-pri`), l'autre partie au
 *   recours = camp adverse (gauche, rose/rouge clair — `--ko-soft`/`--ko`).
 * - Visiteur place (aucune compagnie, ex. Commission) : aucun « nous »
 *   possible — convention stable demandeur=gauche/débiteur=droite, teinte
 *   neutre pour les deux (`--neutral-soft`) : on ne invente pas un camp.
 */
export function sideToneFor(companyCode: string, r: Pick<RecoursItem, 'from' | 'to'>, meCompany: string | undefined): { side: ExchangeSide; tone: ExchangeTone } {
  if (meCompany) return companyCode === meCompany ? { side: 'right', tone: 'self' } : { side: 'left', tone: 'party' };
  return { side: companyCode === r.from ? 'left' : 'right', tone: 'neutral' };
}

/** Libellé « reason » d'une opposition : motif catalogué (si connu) + texte libre, exactement comme avant (tests). */
export function oppositionBody(opposition: { reasonCode?: string; reason?: string }, motifLabels: Map<string, string>): string | undefined {
  const codeLabel = opposition.reasonCode ? motifLabels.get(opposition.reasonCode) ?? opposition.reasonCode : undefined;
  const text = [codeLabel, opposition.reason].filter(Boolean).join(' — ');
  return text || undefined;
}

/**
 * Fil d'échanges RÉEL d'un recours — mêmes champs réellement persistés que
 * l'ancien `buildTimeline` (`requestSentAt`/`opposition`/`contestation`/
 * `commissionAt`/`resolution`), désormais partagé par `/exchanges` ET par
 * `/commission` (fil réutilisé pour le dossier lié, voir `commission/page.tsx`).
 * N'invente aucune étape qui n'a pas réellement eu lieu, et n'attribue une
 * compagnie à un évènement QUE lorsque les règles métier (`recours.rules.ts`)
 * la déterminent sans ambiguïté :
 *  - Annexe 2 (demande) : toujours `from` (compagnie demanderesse).
 *  - Annexe 3 (opposition) : toujours `to` (seule la compagnie débitrice peut s'opposer, Art.12).
 *  - Annexe 4 (contestation) : toujours `from` (seule la demanderesse conteste l'opposition reçue).
 *  - Transmission en Commission : `transmettre_commission` est ouverte à la
 *    place OU à l'une ou l'autre partie (`visibleRecoursActions`) — l'auteur
 *    réel n'est connu que de l'historique d'audit (SEC-17, place
 *    uniquement) : affiché neutre, sans compagnie attribuée.
 *  - Résolution automatique (silence/opposition réputée fondée/forclusion) :
 *    neutre (déclenchée par un délai, par aucune compagnie).
 *  - Décision de la Commission : acte de place (SEC-25), neutre.
 *  - Acceptation expresse / levée d'opposition : actes de la compagnie `to`.
 */
export function buildRecoursExchangeEvents(
  r: RecoursItem,
  opts: { t: (key: TranslationKey) => string; motifLabels: Map<string, string>; meCompany?: string; amountLabel?: string },
): ExchangeEvent[] {
  const { t, motifLabels, meCompany, amountLabel } = opts;
  const events: ExchangeEvent[] = [];

  {
    const { side, tone } = sideToneFor(r.from, r, meCompany);
    events.push({ key: 'annexe2', at: r.requestSentAt, side, tone, companyCode: r.from, label: t('exchanges.detail.timeline.annexe2'), meta: amountLabel });
  }

  if (r.opposition) {
    const { side, tone } = sideToneFor(r.to, r, meCompany);
    events.push({
      key: 'annexe3',
      at: r.opposition.raisedAt,
      side,
      tone,
      companyCode: r.to,
      label: t('exchanges.detail.timeline.annexe3'),
      body: oppositionBody(r.opposition, motifLabels),
    });
  }

  if (r.contestation) {
    const { side, tone } = sideToneFor(r.from, r, meCompany);
    events.push({ key: 'annexe4', at: r.contestation.raisedAt, side, tone, companyCode: r.from, label: t('exchanges.detail.timeline.annexe4'), body: r.contestation.reason });
  }

  if (r.commissionAt) {
    events.push({ key: 'commission', at: r.commissionAt, side: 'center', tone: 'neutral', label: t('exchanges.detail.timeline.commission') });
  }

  if (r.resolution) {
    const labelKey = RESOLUTION_LABELS[r.resolution.kind];
    if (labelKey) {
      const label = t(labelKey);
      if (AUTOMATIC_RESOLUTION_KINDS.has(r.resolution.kind) || COMMISSION_RESOLUTION_KINDS.has(r.resolution.kind)) {
        events.push({ key: 'resolution', at: r.resolution.at, side: 'center', tone: 'neutral', label, body: r.resolution.note });
      } else {
        // Acceptation expresse : acte du débiteur (`to`) ; opposition levée : acte du créancier (`from`, qui renonce).
        const actor = r.resolution.kind === 'OPPOSITION_LEVEE' ? r.from : r.to;
        const { side, tone } = sideToneFor(actor, r, meCompany);
        events.push({ key: 'resolution', at: r.resolution.at, side, tone, companyCode: actor, label, body: r.resolution.note });
      }
    }
  }

  return events.sort((a, b) => a.at.localeCompare(b.at));
}
