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

### 4. Les 6 écrans restants (priorité normale)

Pour chacun, consulter `ida-place-backend/ARCHITECTURE.md` (tableau état
par module) et les routes déjà exposées (toutes documentées sur
`/api/docs`). Les DTO de ces modules sont encore des mocks "squelette
libre" côté back (pas de contrat figé) : coordonner avec l'agent Backend
avant de s'y brancher en profondeur, pour éviter de construire un écran
contre une forme qui va changer.

## Vague 2 — `/exchanges`, `/monthly`, `/quarter`, `/commission` (fait)

Les 4 écrans ciblés par cette vague sont maintenant réellement
implémentés et branchés sur l'API réelle (back démarré avec
`npm run start:dev`, `x-dev-user: OPERATEUR_PLACE`), en parallèle d'un
agent Backend qui travaille sur les mêmes modules
(`RecoursModule`/`SettlementModule`/`CommissionModule`, toujours
"squelette libre" côté mock au moment de cette vague — voir
`ida-place-backend/HANDOFF.md`). Tous les appels ont été vérifiés
manuellement via `curl` contre le back réel avant d'écrire l'écran
(formes exactes confirmées, voir détail par écran).

### 5. `/exchanges` (Module B · §6.4, écran 4) — FAIT

`src/app/exchanges/page.tsx`. Onglets `Tous/En attente/Opposition/
Contestation/Commission/Forclos` (`Tabs`), registre paginé 6/p
(`GET /recours?state&page&pageSize`), nouveau composant transverse
**`CountdownBar`** (`src/components/ui/CountdownBar.tsx`), fiche détail en
`Modal` (historique de transitions + actions), transitions
(`POST /recours/{id}/transition`) gérées par `hasPrivilege('exchange')`.

- **`CountdownBar`** est **purement présentationnel** (règle d'or C.1) :
  `RecoursController` ne renvoie que deux dates brutes
  (`requestSentAt`/`conventionalDeadlineAt`), pas un pourcentage/temps
  restant précalculé. Le composant ne fait qu'un calcul d'affichage (écart
  de dates, comme un "il y a 3 jours") pour positionner la barre et
  formater le libellé — **aucune règle Art. 10/12/19 n'est tranchée côté
  front** : l'état affiché (`Tag`) vient toujours de `state`, jamais déduit
  du timer. Idéalement l'API renverrait directement
  `remainingPercent`/`remainingLabel` précalculés une fois
  `RecoursModule` réel — à revoir avec l'agent Backend.
- **État `ENVOYE` sans onglet dédié** : l'inventaire d'écran A.4 ne liste
  que 5 onglets d'état (en attente/opposition/contestation/commission/
  forclos) + "Tous", alors que le mock back expose aussi `ENVOYE`
  (`i % 6` sur 6 états). Les dossiers `ENVOYE` restent donc visibles
  uniquement sous "Tous" — comportement documenté, pas un bug.
- **Pas de `GET /recours/counters`** (contrairement à
  `/matching/queue/counters`) : les compteurs par onglet sont obtenus en
  lisant `.total` de 6 requêtes paginées `pageSize=1` (une par filtre) —
  aucun calcul métier, juste une lecture de compteur déjà renvoyé par
  l'API, mais 6 requêtes réseau au lieu d'une (à remplacer par un vrai
  endpoint de compteurs si le Backend en ajoute un).
- **Transitions sans état-machine front** : `POST /recours/{id}/transition`
  accepte aujourd'hui n'importe quelle chaîne `toState` sans validation
  côté back (mock). Plutôt que de coder une logique de transitions valides
  (ce qui serait une règle métier Art. 10/12/19 côté front, interdit par
  C.1), l'écran propose les 6 états possibles comme boutons et laisse le
  back valider — donc **aucun retour d'erreur n'est à attendre tant que le
  mock accepte tout aveuglément** (limite connue, à retester une fois
  `RecoursModule` réel et validé).
- **Historique des transitions** affiché dans la fiche détail = journal
  **local, session courante uniquement** (même limite que le journal
  d'import de la vague précédente) : `RecoursController` n'expose aucun
  endpoint d'historique.
- Abonnement temps réel anticipé à `recours.timer` (`useRealtime`, voir
  `src/lib/realtime.ts`) + polling de repli (30 s) — l'événement n'est pas
  encore émis par `RealtimeModule` au moment de cette vague (même situation
  que `claim.ingested`/`match.updated` pour `/cockpit` à la vague
  précédente).

### 6. `/monthly` (Module C · §6.5, écran 5) — FAIT

`src/app/monthly/page.tsx`. Sélecteur de période (`<input type="month">`),
synthèse par compagnie (`GET /settlement/monthly/{period}`, `Table` 6/p),
état d'avancement (`Tag` Clôturé/En cours), action "Générer le bordereau"
gardée par `hasPrivilege('synth')`.

- **⚠️ Endpoint de génération ASSUMÉ, pas dans le contrat back actuel** :
  `SettlementController` (`src/settlement/settlement.module.ts` côté back)
  n'expose aujourd'hui que des `GET` (`monthly/:period`, `quarter/:q`),
  **aucune action de génération**. L'écran appelle par convention
  `POST /settlement/monthly/{period}/bordereau` (vérifié : répond
  actuellement `404 {"code":"NOT_FOUND",...}`) et **gère ce cas
  explicitement** — toast "génération indisponible" (pas une erreur
  générique) plutôt que de planter. À confirmer/ajuster avec l'agent
  Backend : si l'endpoint réel a une forme différente, seul l'unique appel
  `apiPost` de ce fichier doit changer.

### 7. `/quarter` (Module D · §6.6, écran 6) — FAIT

`src/app/quarter/page.tsx`. Sélecteur de trimestre (5 options, trimestre
courant + 4 précédents — simple formatage de date, pas une règle métier),
matrice des positions bilatérales compagnie × compagnie (`GET
/settlement/quarter/{q}`, tableau `.t` natif), compensation multilatérale
(net par compagnie, `Tag ok/ko` selon le signe déjà renvoyé par l'API —
positif = à recevoir, négatif = à payer, aucun calcul front), référence du
bordereau trimestriel (`data.bordereau`, affichage seul — pas de
téléchargement réel, `DocumentsModule` non branché), grille tarifaire
`TARIF-2026.01` (`GET /pricing/grid`, déjà réel côté `MeteringModule`).

### 8. `/commission` (Module E · §6.7, écran 7) — FAIT

`src/app/commission/page.tsx`. File de conciliation paginée 6/p côté
**front** (`GET /commission/cases`, `Table`), fiche détail en `Modal`,
pénalité (montant + motif, `POST /commission/{id}/penalty`, gardée par
`hasPrivilege('penaltyOrder')`), signature de PV
(`POST /commission/{id}/pv-sign`, gardée par `hasPrivilege('pvSign')`).

- **Pagination appliquée côté front** : `GET /commission/cases` ne
  supporte aucun paramètre de pagination côté back (contrairement à
  `/recours` et `/matching/queue`) — slice local 6/p sur la liste complète.
  À remplacer par une vraie pagination serveur si la liste grossit.
- **Privilège `sanction` non gardé par un endpoint dédié** : la matrice
  RBAC (`roles-privileges.ts`) liste bien `sanction` parmi les 17
  privilèges (accordé à `MEMBRE_COMMISSION`), mais
  `CommissionController` ne garde aujourd'hui que `penaltyOrder` (pénalité)
  et `pvSign` (signature PV) — aucune action "sanction" distincte
  n'existe. L'écran gate donc ses deux seuls boutons réels sur les
  privilèges effectivement vérifiés par le back (`penaltyOrder`/`pvSign`),
  pour ne jamais afficher une action que le serveur rejetterait quand même
  en 403. À revoir si un futur endpoint `sanction` est ajouté.
- **Décisions non persistées côté back** (mock sans état) : les deux POST
  répondent normalement mais ne modifient pas `cases()` côté back —
  l'écran garde donc la pénalité/signature en mémoire **session
  courante** pour l'affichage (même limite que le journal d'import), pas
  un oubli.
- **"Génération de PV"** (demandée par le dossier technique) est
  implémentée comme **signature du PV** (`POST /commission/{id}/pv-sign`,
  le seul endpoint existant) — pas de génération/téléchargement de document
  séparé (`DocumentsModule` non branché).

### Vérifications effectuées pour cette vague

- `npx tsc --noEmit` : **vert**, aucune erreur.
- `npm run build` (`next build`, Turbopack) : **vert**, les 15 routes
  compilent (dont les 4 de cette vague), aucune régression sur
  `/cockpit`/`/matching`/`/import`/`/referential`.
- `npm run test` (vitest) : **15/15 tests existants toujours verts**
  (aucune régression) — pas de nouveaux tests ajoutés pour cette vague par
  manque de temps ; à prioriser par le Testeur ou une vague suivante
  (voir modèle dans `page.test.tsx` de `/matching`/`/import`/`/cockpit`).
- Test manuel bout-en-bout avec le vrai back (`npm run start:dev`,
  `x-dev-user: OPERATEUR_PLACE`) : les 4 routes (`GET /recours`,
  `POST /recours/:id/transition`, `GET /settlement/monthly/:period`,
  `GET /settlement/quarter/:q`, `GET /pricing/grid`, `GET
  /commission/cases`, `POST /commission/:id/penalty`, `POST
  /commission/:id/pv-sign`) répondent avec exactement la forme attendue
  par les types `src/lib/types.ts` ; le 404 de l'endpoint "bordereau"
  assumé (`/monthly`) a été vérifié et est géré sans planter. Les 4 pages
  répondent 200 côté Next.js (SSR initial) sans erreur serveur.
- Types TypeScript ajoutés (`RecoursItem`, `SettlementMonthly`,
  `SettlementQuarter`, `PriceGrid`, `CommissionCase`, etc. dans
  `src/lib/types.ts`) toujours écrits à la main (pas générés depuis le
  schéma OpenAPI) — même limite que la vague précédente.
- i18n : toutes les nouvelles clés ajoutées en FR complet dans
  `src/i18n/translations.ts` ; AR/EN restent les placeholders automatiques
  (`[AR]`/`[EN]` + texte FR) générés par le mécanisme déjà en place — à
  traduire par une vague suivante. RTL non cassé par construction (aucune
  valeur `left/right` en dur dans les 4 écrans ; matrice compagnie × compagnie
  reste lisible en RTL car c'est un tableau natif `.t`, qui suit déjà
  `dir` comme le reste de l'appli).

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
