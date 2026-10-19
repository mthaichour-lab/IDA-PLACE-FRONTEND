/**
 * Page de retour OIDC (`redirect_uri` du client Keycloak `ida-place-web`).
 * Le traitement (échange du code + vérification PKCE/state) est fait par
 * `AuthProvider` (`src/lib/auth-context.tsx`), qui affiche « Connexion en
 * cours… » puis redirige vers la page demandée avant la connexion.
 */
export default function AuthCallbackPage() {
  return null;
}
