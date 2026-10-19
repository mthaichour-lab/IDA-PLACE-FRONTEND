/**
 * Rôles « compagnie » (B.7, back `roles-privileges.ts`) : l'utilisateur agit
 * pour UNE compagnie adhérente, portée par le jeton (claim `company_id`,
 * renvoyée par `GET /me` dans `company`). Les autres rôles sont des rôles
 * « place » (opérateur, UAR, commission, auditeur).
 *
 * Sert uniquement à l'AFFICHAGE (SEC-38) : ne proposer à un rôle compagnie
 * que sa propre compagnie. Le backend reste seul juge des autorisations.
 */
export const COMPANY_ROLES = ['CORRESPONDANT_IDA', 'TRESORIER'] as const;

export function isCompanyRole(role: string | undefined): boolean {
  return !!role && (COMPANY_ROLES as readonly string[]).includes(role);
}
