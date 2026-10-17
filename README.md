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

## Authentification en développement

Le client HTTP (`src/lib/api-client.ts`) envoie systématiquement l'en-tête
`x-dev-user` (valeur configurable via `NEXT_PUBLIC_DEV_USER`, défaut
`OPERATEUR_PLACE`) pour simuler un utilisateur authentifié côté back
(`DevAuthProvider`). Changer cette variable pour tester un autre rôle
(`CORRESPONDANT_IDA`, `AUDITEUR_CSA`, etc. — voir la liste des 6 rôles
dans le dossier technique §B.7).

⚠️ DEV ONLY. L'intégration OIDC Keycloak réelle reste à faire (voir
HANDOFF.md).

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
  centralise l'en-tête dev, le préfixe `/api/v1` et la normalisation
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
