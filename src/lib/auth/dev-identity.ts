/**
 * ⚠️ DÉVELOPPEMENT UNIQUEMENT — identité simulée envoyée au DevAuthProvider
 * du backend (`AUTH_PROVIDER=dev`, refusé par le backend en production).
 *
 * Ce module n'est référencé QUE dans des branches gardées par
 * `process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_AUTH_MODE === 'dev'`,
 * condition que Next.js remplace par `false` dans un build de production :
 * le code et ses chaînes (`x-dev-user`, rôle par défaut) disparaissent du
 * bundle (vérifié par la CI : grep sur `.next/`).
 */
import { chosenDevRole } from './dev-role';

export const DEV_USER_HEADER = 'x-dev-user';

/**
 * Rôle simulé : celui choisi dans l'en-tête (session du navigateur), sinon
 * `NEXT_PUBLIC_DEV_USER` (nom de rôle ou JSON DevUserPayload), sinon
 * opérateur de place.
 */
export function devUser(): string {
  return chosenDevRole() || process.env.NEXT_PUBLIC_DEV_USER || 'OPERATEUR_PLACE';
}
