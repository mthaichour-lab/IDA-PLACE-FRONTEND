/**
 * Sélecteur de rôle de démonstration de l'en-tête — DÉVELOPPEMENT UNIQUEMENT
 * (mode `dev`). Séparé de `dev-identity.ts` pour que l'en-tête n'importe
 * jamais l'en-tête d'identité simulée : ce module ne contient que la liste
 * des rôles et la mémorisation du choix en session du navigateur. En mode
 * Keycloak, il n'est jamais appelé (l'en-tête affiche le rôle du jeton).
 */
const DEV_ROLE_STORAGE_KEY = 'ida-place.dev-role';

/** Rôles proposés (mêmes rôles que le DevAuthProvider du backend). */
export const DEV_ROLES = ['OPERATEUR_PLACE', 'ADMIN_UAR', 'MEMBRE_COMMISSION', 'AUDITEUR_CSA', 'CORRESPONDANT_IDA', 'TRESORIER'] as const;

/** Rôle choisi dans l'en-tête pour cette session du navigateur, s'il y en a un. */
export function chosenDevRole(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const chosen = window.sessionStorage.getItem(DEV_ROLE_STORAGE_KEY);
    return chosen && (DEV_ROLES as readonly string[]).includes(chosen) ? chosen : undefined;
  } catch {
    return undefined;
  }
}

/** Mémorise le rôle de démonstration choisi (session du navigateur uniquement). */
export function setDevRole(role: string): void {
  if (!(DEV_ROLES as readonly string[]).includes(role)) return;
  try {
    window.sessionStorage.setItem(DEV_ROLE_STORAGE_KEY, role);
  } catch {
    // stockage indisponible : le changement ne survivra pas au rechargement.
  }
}

/** Oublie le rôle de démonstration choisi (retour au rôle configuré par `NEXT_PUBLIC_DEV_USER`). */
export function clearDevRole(): void {
  try {
    window.sessionStorage.removeItem(DEV_ROLE_STORAGE_KEY);
  } catch {
    // stockage indisponible : rien à oublier.
  }
}
