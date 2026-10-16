# HANDOFF — pour l'agent Frontend

Le socle (coque, tokens, composants transverses, i18n, auth scaffold,
client HTTP) est posé et **ne devrait pas avoir besoin d'être réécrit** —
seulement étendu.

**Quatre écrans sont maintenant réellement implémentés et branchés sur
l'API réelle** : `/referential` (Module X, écran 12, livré précédemment)
et, livrés dans ce sprint, `/cockpit` (écran 1), `/matching` (écran 2) et
`/import` (écran 3). Les 10 autres restent des pages "en construction"
(`src/components/WipPage.tsx`) avec le bon badge/titre.

## Écrans livrés dans ce sprint

### 1. `/cockpit` (Module I, écran 1) — FAIT

`src/app/cockpit/page.tsx`. Branché sur `GET /api/v1/cockpit/summary`
(TanStack Query, `refetchInterval: 20s` de repli). Bandeau `KpiRow`/`Kpi`
(4 KPIs), `Sparkline` pour `sparklineDeclarations`, `BarChart` pour
`barresNettes` + légende montants `Intl.NumberFormat(…DZD)`, raccourcis
vers `/matching` et `/import`. Abonnement temps réel via
`src/lib/realtime.ts` (`useRealtime`, Socket.IO, namespace `/realtime`,
testé manuellement bout-en-bout : connexion OK, événement `metering.tick`
reçu et déclenche bien un `refetch()`) — voir limite ci-dessous.

### 2. `/matching` (Module A · §6.3, écran 2) — FAIT

`src/app/matching/page.tsx`. Onglets `Tous/Auto/À confirmer/Non appariés`
(`Tabs` + compteurs via `/matching/queue/counters`), tableau gauche paginé
6/p (`Table` + `CoChip` + plaque mono + `ScoreBar` + `Tag` d'état),
panneau droit "Appariement" : confrontation A/B, critères pondérés
(libellés + poids 35/15/15/10/10 **en dur côté front, affichage
uniquement** — le score final vient toujours de `row.score` renvoyé par
l'API, aucun recalcul), seuils auto/à confirmer via `/matching/thresholds`,
actions Confirmer/Rejeter/Complément (`POST /matching/{id}/decide`,
invalidation du cache TanStack + `Toast`), raccourcis clavier `C`/`R`/`↑`/`↓`
(désactivés quand le focus est sur un champ de saisie). Actions grisées
via `hasPrivilege('matchDecide')`.

### 3. `/import` (Module XII, écran 3) — FAIT

`src/app/import/page.tsx`. Zone de dépôt drag-drop + bouton "Choisir le
fichier" (visible uniquement si `hasPrivilege('import')` — sinon message
"Accès réservé", sans dupliquer de règle d'autorisation), upload réel via
`POST /claims/import` (nouveau helper `apiPostForm` dans
`src/lib/api-client.ts`, multipart/form-data). Modèle téléchargeable
construit côté front à partir de `GET /claims/import/columns` (47
colonnes) — **placeholder CSV**, pas un classeur Excel mis en forme (voir
limite ci-dessous). Aperçu ligne à ligne du rapport d'import paginé 6/p
avec `Tag` Éligible IDA/Hors IDA + motifs. Journal d'import limité à la
session courante (l'API n'exposant pas d'historique des imports — voir
limite ci-dessous).

### 4. Les 10 autres écrans (priorité normale)

Pour chacun, consulter `ida-place-backend/ARCHITECTURE.md` (tableau état
par module) et les routes déjà exposées (toutes documentées sur
`/api/docs`). Les DTO de ces modules sont encore des mocks "squelette
libre" côté back (pas de contrat figé) : coordonner avec l'agent Backend
avant de s'y brancher en profondeur, pour éviter de construire un écran
contre une forme qui va changer.

## Ce qui est déjà prêt à réutiliser

- **Coque** : `src/components/shell/{Rail,Topbar,MobileBar,AppShell}.tsx`
  + `nav-items.ts` (les 14 routes, avec les 4 items mobiles imposés par
  A.3 : Cockpit, Échanges, Compensation trimestrielle, Journal scellé).
- **Composants transverses** : voir liste dans README.md.
- **i18n** : `useI18n()` (`t`, `locale`, `setLocale`, `dir`). Ajouter des
  clés dans `src/i18n/translations.ts` (FR d'abord, puis AR/EN).
- **Thème** : `useTheme()` (`theme`, `toggle`).
- **Auth** : `useAuth()`, `RequirePrivilege`.
- **Client HTTP** : `apiGet`/`apiPost`/`apiPut`/`apiPostForm` (nouveau,
  multipart) + `ApiError` typée.
- **Temps réel** : `useRealtime(events, onEvent)` dans `src/lib/realtime.ts`
  (Socket.IO client, namespace `/realtime`) — nouveau dans ce sprint,
  réutilisable pour `/matching` (événement `match.updated`, déjà listé en
  argument sur l'écran matching bien qu'aucun rafraîchissement temps réel
  n'y soit branché pour l'instant — voir limite ci-dessous) et `/metering`
  (`metering.tick`, déjà émis par le back) le jour où ces écrans seront
  faits. **Toujours** combiner avec un `refetchInterval` TanStack de repli
  (voir `/cockpit`), jamais utiliser le WS comme unique mécanisme.

## Dette / limites connues (à signaler au Testeur)

- **Bug backend découvert en test manuel bout-en-bout** (reproduit
  plusieurs fois via `curl` direct sur `POST /api/v1/matching/{id}/decide`,
  back démarré avec `npm run start:dev`) : le champ `status` (et
  `rejectReason`) disparaît de la réponse de `GET /matching/queue` juste
  après une décision — `MatchDecisionDto.action`/`reason` n'ont aucun
  décorateur `class-validator` dans `matching.dto.ts`, et le
  `ValidationPipe` global (whitelist) semble donc les vider avant qu'ils
  n'atteignent `MatchingService.decide()` (`nextStatus[dto.action]`
  devient `undefined`, puis disparaît du JSON). Le POST réussit (200,
  `{id, decidedAt, decidedBy}`) et le front gère ce cas sans planter (le
  `Tag` d'état affiche juste un badge vide), mais **la décision n'est pas
  correctement persistée côté back**. C'est un défaut du dépôt backend
  (hors périmètre front) — à transmettre à l'agent Backend : ajouter
  `@IsIn(MATCH_DECISIONS)` sur `action` et `@IsOptional() @IsString()` sur
  `reason`/`linkDeclId` dans `MatchDecisionDto`.
- **Modèle 47 colonnes téléchargeable** (`/import`) : export **CSV**
  généré côté front depuis `GET /claims/import/columns`
  (`index;key;label;group;type;enumValues`), volontairement **pas** un
  classeur Excel mis en forme — placeholder documenté dans le code
  (`buildColumnsCsv`) et dans le sous-titre de l'écran. À remplacer par un
  vrai modèle `.xlsx` (généré côté back ou via une librairie front) si le
  Testeur ou le métier l'exige.
- **Journal d'import** (`/import`) : l'API n'exposant pas d'historique des
  imports, le journal n'est tenu qu'en mémoire côté client pour la session
  en cours (perdu au rechargement de la page) — comportement documenté
  dans le code et dans les libellés de l'écran, pas un oubli.
- **Temps réel `/cockpit`** : le back n'émet encore que `metering.tick`
  (démonstration périodique, 15s, voir `RealtimeModule` back) — testé
  manuellement, la connexion WS s'établit et l'événement est bien reçu
  côté front. Les événements `claim.ingested`/`match.updated` n'existent
  pas encore côté back ; l'écran cockpit s'y abonne déjà par anticipation
  (sans effet tant qu'ils ne sont pas émis) et reste fonctionnel grâce au
  polling de repli (20s) dans tous les cas.
- Les types TypeScript des réponses API (`src/lib/types.ts`) restent
  écrits à la main, pas générés depuis le schéma OpenAPI (voir A.1/HANDOFF
  précédent) — toujours vrai pour les types ajoutés dans ce sprint
  (`CockpitSummary`, `MatchQueueItem`, `ClaimImportReport`, etc.).
- Pas d'intégration OIDC Keycloak réelle (login/refresh) — toujours
  `x-dev-user` (voir `.env.example`), inchangé par ce sprint.
- `npm install`, `npx tsc --noEmit` et `npm run build` ont été vérifiés
  dans cet environnement (registre npm joignable, `socket.io-client`
  installé) : **tout est vert**. Test manuel bout-en-bout effectué avec
  le vrai back-end démarré (`npm run start:dev`, `x-dev-user:
  OPERATEUR_PLACE`) : `/cockpit`, `/matching`, `/import` répondent 200,
  affichent les données réelles de l'API et les 3 flux (résumé cockpit,
  file de matching + décision, import + rapport) ont été exercés via
  l'API réelle (voir détail des appels dans l'historique de ce sprint).
