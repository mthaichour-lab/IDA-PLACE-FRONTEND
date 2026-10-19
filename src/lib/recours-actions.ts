import { isCompanyRole } from './auth/roles';
import { MeResponse, RECOURS_ALLOWED_ACTIONS, RecoursAction, RecoursItem } from './types';

/** Utilisateur rattaché à une compagnie (rôle compagnie ou compagnie portée par le jeton) — jamais un acteur « place » (SEC-25). */
export function isCompanyActor(me: MeResponse | undefined): boolean {
  return !!me && (isCompanyRole(me.role) || !!me.company);
}

/**
 * Actions proposées pour un recours — miroir d'AFFICHAGE de
 * `assertActionAllowed` (back `recours.service.ts`), l'API reste seule juge :
 *  - accepter / opposer : la compagnie destinataire (`to`) seulement ;
 *  - lever l'opposition / contester : la compagnie demanderesse (`from`) seulement ;
 *    SEC-17 : ces quatre actes engagent une compagnie, un rôle place reçoit 403 ;
 *  - transmettre en commission : une partie ou un rôle place ;
 *  - clôturer en commission : rôle place uniquement (SEC-25).
 */
export function visibleRecoursActions(r: Pick<RecoursItem, 'state' | 'from' | 'to'>, me: MeResponse | undefined): RecoursAction[] {
  if (!me) return [];
  const company = isCompanyActor(me) ? me.company : undefined;
  const place = !isCompanyActor(me);
  return RECOURS_ALLOWED_ACTIONS[r.state].filter((action) => {
    switch (action) {
      case 'accepter':
      case 'opposer':
        return !place && company === r.to;
      case 'lever_opposition':
      case 'contester':
        return !place && company === r.from;
      case 'transmettre_commission':
        return place || company === r.from || company === r.to;
      case 'cloturer_commission_favorable':
      case 'cloturer_commission_defavorable':
        return place;
      default:
        return false;
    }
  });
}

