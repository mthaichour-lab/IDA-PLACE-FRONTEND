# IDA Place — Frontend (Next.js)

Socle front-end de la plateforme de place **IDA Place**, plus l'écran de
référence `/referential` (Module X) entièrement implémenté et branché sur
l'API réelle. Référence unique :
`/home/user/docs/IDA_Place_Dossier_Technique.md` (Partie A = charte +
écrans, contraignante ; Partie C = répartition des tâches).

Voir `HANDOFF.md` pour la liste précise des écrans restants et leurs
endpoints back-end.

## Stack

Next.js 16 (App Router) · TypeScript strict · TanStack Query ·
i18n par contexte React (FR complet, AR/EN placeholders) · SVG natif pour
les graphiques (pas de librairie lourde imposée, A.1).

## Installation

```bash
npm install
cp .env.example .env.local
```

`NEXT_PUBLIC_API_URL` doit pointer vers le back-end NestJS (voir
`ida-place-backend`, par défaut `http://localhost:3001`).

## Lancement en développement

```bash
npm run dev
```

Ouvrir `http://localhost:3000` (redirige vers `/cockpit`).

⚠️ Le back-end doit tourner pour que `/referential` affiche des données
(sinon le back répond en mode dégradé mémoire — voir son README — mais
répond quand même ; en revanche si le back est complètement arrêté,
`/referential` affichera l'état d'erreur `common.error` avec un bouton
"Réessayer", ce qui est le comportement attendu, pas un bug).

## Authentification (SEC-01)

Deux modes, choisis au build par `NEXT_PUBLIC_AUTH_MODE` :

- **`keycloak`** (seul mode possible en production) : flux OIDC
  Authorization Code + PKCE (`oidc-client-ts`, `src/lib/auth/keycloak.ts`)
  avec le client public `ida-place-web`. Jetons conservés en mémoire
  uniquement (un rechargement relance la connexion, transparente tant que la
  session SSO Keycloak est active), renouvelés par le jeton de
  rafraîchissement, déconnexion via le bouton « Se déconnecter » de la
  topbar. Le client HTTP envoie `Authorization: Bearer <jeton>` ; un 401
  relance la connexion. Pages techniques : `/auth/callback` (retour de
  connexion) et `/auth/logged-out` (retour de déconnexion).
- **`dev`** (développement local uniquement) : en-tête `x-dev-user` (valeur
  `NEXT_PUBLIC_DEV_USER`, défaut `OPERATEUR_PLACE`, nom de rôle ou JSON
  `{"role":"TRESORIER","companyId":"CAAT"}`) lu par le `DevAuthProvider` du
  backend, qui le refuse en production.

Garde de build (`config/build-env.ts`, appelée par `next.config.ts`) :
`next build` **échoue** si `NEXT_PUBLIC_AUTH_MODE` n'est pas `keycloak`, si
`NEXT_PUBLIC_DEV_USER` est défini, ou si `NEXT_PUBLIC_API_URL` /
`NEXT_PUBLIC_KEYCLOAK_URL` ne sont pas en `https://`. Le code du mode dev
est retiré du bundle de production (contrôle CI : aucune occurrence de
`x-dev-user` dans `.next/`). Variables de production :
`.env.production.example`.

Le rôle, la compagnie et les privilèges affichés viennent de `GET /me`,
construit par le backend à partir des claims du jeton vérifié.

### Configuration Keycloak attendue (realm `ida-place`)

- Client `ida-place-web` : *public* (Client authentication = Off), *Standard
  flow* activé, *Direct access grants* et *Implicit flow* désactivés,
  PKCE obligatoire (`pkce.code.challenge.method = S256`).
- *Valid redirect URIs* : `https://<frontend>/auth/callback`
  (+ `http://localhost:3000/auth/callback` en développement).
- *Valid post logout redirect URIs* : `https://<frontend>/auth/logged-out`.
- *Web origins* : `https://<frontend>` (CORS des appels au point de
  terminaison des jetons).
- Mappers : rôle applicatif (`ida_place_role` ou rôles de realm portant les
  noms des 6 rôles) et attribut utilisateur `company_id` pour les rôles
  compagnie (voir `KeycloakStrategy` côté backend) ; audience du jeton
  acceptée par l'API (`azp = ida-place-web`).
- Durées : jeton d'accès court (5 min), rotation des jetons de
  rafraîchissement (*Revoke refresh token* activé).

## Design tokens & thème

Déclarés dans `src/styles/tokens.css` (valeurs EXACTES de la Partie A.2).
Bascule sombre via `@media (prefers-color-scheme: dark)` (gardée par
`:root:not([data-theme="light"])`) **et** `:root[data-theme="dark"]`
(forcé par le bouton thème, `src/components/theme-provider.tsx`).

## i18n

Choix : contexte React simple (`src/i18n/provider.tsx` +
`src/i18n/translations.ts`) plutôt que `next-intl`, pour rester dans
l'arborescence de routes fixée par A.4 sans middleware de routing i18n.
FR est complet ; AR et EN sont des placeholders (préfixés `[AR]`/`[EN]`)
à traduire. `dir` (RTL en arabe) est piloté automatiquement sur
`<html>`. Voir le commentaire en tête de `translations.ts` pour le détail
du choix et comment migrer vers `next-intl` si besoin plus tard.

## Conventions pour la suite (agent Frontend)

- **Pagination** : toujours 7 lignes/page (A.5). Le composant générique
  `src/components/ui/Table.tsx` l'impose déjà par défaut.
- **Aucune règle métier côté front** (C.1) : tout verdict, score, barème,
  tarif vient de l'API. Le front affiche, il ne calcule jamais.
- **Composants transverses déjà disponibles** (`src/components/ui/`) :
  `Kpi`/`KpiRow`, `Tag`, `Tabs`, `Table`, `Modal`, `Toast`/`useToast`,
  `CoChip`, `ScoreBar`, `BarChart`/`Sparkline`, `TileGrid`. Les réutiliser
  plutôt que recréer des variantes.
- **Auth** : `useAuth()` (`src/lib/auth-context.tsx`) expose `me`,
  `hasPrivilege(privilege)` et le composant `RequirePrivilege`. Toujours
  piloter l'affichage conditionnel par privilège de cette façon (jamais de
  logique de rôle recodée en dur).
- **Client HTTP** : toujours via `apiGet`/`apiPost`/`apiPut`/`apiPostForm`
  (ce dernier pour l'upload multipart, ex: `/claims/import`)
  (`src/lib/api-client.ts`), jamais de `fetch` direct dans une page — ça
  centralise l'authentification (Bearer / en-tête dev), le préfixe `/api/v1` et la normalisation
  d'erreur (`ApiError`, forme `{code,message,details}`).
- **Temps réel** : `useRealtime(events, onEvent)` (`src/lib/realtime.ts`,
  Socket.IO) pour s'abonner au `RealtimeModule` back — toujours combiné à
  un `refetchInterval` TanStack de repli, jamais comme seul mécanisme de
  rafraîchissement (voir `/cockpit`).

## Scripts

| Script | Rôle |
|---|---|
| `npm run dev` | Démarrage en développement (Turbopack) |
| `npm run build` | Build de production |
| `npm run start` | Démarrage du build de production |
| `npm run lint` | `tsc --noEmit` |
