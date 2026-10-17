# HANDOFF — pour l'agent Frontend

Le socle (coque, tokens, composants transverses, i18n, auth scaffold,
client HTTP) est posé et **ne devrait pas avoir besoin d'être réécrit** —
seulement étendu.

**Les 14 écrans sont maintenant tous réellement implémentés et branchés
sur l'API réelle** (sprint 3, en plus des 4 déjà livrés au sprint 2 :
`/cockpit`, `/matching`, `/import`, `/referential`) :
`/exchanges`, `/monthly`, `/quarter`, `/commission`, `/ledger`,
`/monitoring`, `/fraude`, `/metering`, `/stats`, `/params`.

## Sprint 3 en bref (deux agents Frontend en parallèle, worktrees séparés)

- **Agent 1** : `/exchanges`, `/monthly`, `/quarter`, `/commission`,
  `/ledger`.
- **Agent 2** : `/monitoring`, `/fraude`, `/metering`, `/stats`,
  `/params`.
- **Fusion + revue croisée** (Testeur + Product Owner) : les deux agents
  Frontend ont construit contre les contrats backend **devinés par
  lecture de code**, sans voir le travail simultané des deux agents
  Backend (eux-mêmes dans des worktrees séparés). Résultat : plusieurs
  écrans crashaient au runtime (forme de DTO différente de ce qui avait
  été lu/deviné). **Tout a été corrigé par le Tech Lead** avant ce
  commit — voir le détail ci-dessous, pas la peine de re-corriger.

### Corrigé après la revue croisée (sprint 3)

Tous ces bugs venaient d'un décalage entre la forme supposée par le front
et la forme réelle renvoyée par le back (les deux ont été développés en
parallèle sans se voir) — **aucun bug de logique front en soi**, mais à
garder en tête : toujours vérifier la forme exacte contre le contrôleur
backend avant de consommer une route nouvellement réelle.

1. **`/commission`, `/fraude` (cases + actions), `/params` (users)** :
   crash total (`X.slice is not a function`). Ces endpoints renvoient
   `{page, total, items}` (paginé serveur, comme `/matching`/`/import`),
   pas un tableau brut. Corrigé : pagination serveur avec `page`/
   `pageSize` en query, lecture de `.items`/`.total`.
2. **`/monitoring`** : crash (`Objects are not valid as a React child`).
   Chaque composante de `details` est `{value, dataSource, sampleSize}`
   (`value` peut être `null` si `dataSource: 'NON_DISPONIBLE'`), pas un
   simple nombre. Corrigé : `renderScore()` gère le cas `null` (affiche
   "Aucune donnée" plutôt que de planter `ScoreBar`).
3. **`/fraude`** : le type front supposait un champ `signals: string[]`
   par cas ; l'API renvoie en réalité `type` (un seul type par cas,
   enum `DOUBLON`/`ECONSTAT_REUTILISE`/`RECURRENCE_VEHICULE`/
   `MONTANT_CALIBRE`/`INCOHERENCE_AB`) + `score` + `details: Record<string,
   unknown>` + `claimIds`. Corrigé : colonnes et modale de détail
   réécrites sur la forme réelle.
4. **`/exchanges`** : le bouton "Appliquer" appelait un endpoint
   `POST /recours/:id/transition` qui n'existe pas côté back (qui expose
   `opposer`/`contester`/`settle`, chacun avec son propre contrat).
   Corrigé : panneau d'action réécrit avec un formulaire contextuel selon
   l'état du recours (opposition avec motif si `EN_ATTENTE`, contestation
   avec motif si `OPPOSITION`, règlement sans montant si
   `ACCEPTE_TACITE`/`COMMISSION`). Le champ d'échéance était aussi mal
   nommé (`conventionalDeadlineAt` au lieu de `currentDeadlineAt`, et
   absent pour les états sans timer actif — `OPPOSITION`, `COMMISSION`,
   états finaux) — corrigé avec un repli "—" propre.
5. **`/monthly`, `/quarter`** : champs de type incorrects
   (`MonthlyCompanySynthesis.code`→`company`, `claimsCount`/`totalAmount`
   → `claimsSettledCount`/`claimsPendingCount`/`totalSettledAmount`/
   `totalPendingAmount` ; `QuarterNet.code`→`company`). Corrigé, types et
   rendus alignés sur `SettlementCompanyLineDto`/`NetPositionDto` réels.
6. **Connexion temps réel (`src/lib/realtime.ts`)** : envoyait
   l'identité dev via un en-tête, qu'un navigateur ne peut pas poser sur
   un WebSocket brut — la connexion était donc **toujours refusée** en
   conditions réelles (contrairement à ce qu'indiquait le HANDOFF du
   sprint 2, probablement testé hors navigateur). Corrigé : transmise via
   `auth: { devUser }` du client Socket.IO (`DEV_USER` exporté depuis
   `api-client.ts` pour réutilisation). Vérifié dans un vrai navigateur.

## Ce qui est déjà prêt à réutiliser

- **Coque** : `src/components/shell/{Rail,Topbar,MobileBar,AppShell}.tsx`
  + `nav-items.ts` (les 14 routes, badge "CM"/"CY" désormais distincts —
  collision corrigée sprint 3).
- **Composants transverses** : `Kpi/KpiRow`, `Tag`, `Tabs`, `Table`
  (pagination 6/p), `Modal`, `Toast/useToast`, `CoChip`, `ScoreBar`,
  `BarChart/Sparkline`, `TileGrid`, et nouveaux ce sprint :
  `CountdownBar` (timers conventionnels, écran 4),
  `CompanyPeriodPicker`/`PriceGridEditor` (`src/components/metering/`,
  partagés entre `/metering` et `/params`).
- **i18n** : `useI18n()` (`t`, `locale`, `setLocale`, `dir`). FR complet
  (y compris les 14 écrans désormais), AR/EN toujours des placeholders.
- **Thème** : `useTheme()` (`theme`, `toggle`).
- **Auth** : `useAuth()`, `RequirePrivilege`.
- **Client HTTP** : `apiGet`/`apiPost`/`apiPut`/`apiPostForm` + `ApiError`
  typée. `DEV_USER` désormais exporté (réutilisé par `realtime.ts`).
- **Temps réel** : `useRealtime(events, onEvent)` — fonctionne désormais
  réellement dans un navigateur (voir correctif 6 ci-dessus). **Toujours**
  combiner avec un `refetchInterval` TanStack de repli.

## Dette / limites connues (déjà documentées dans le code, pas des bugs)

- **Pas de persistance pour certaines actions d'admin** : `/params`
  (onglet Utilisateurs) ne peut pas éditer actif/suspendu ni les
  dérogations de privilèges (`PUT /admin/users/:id` existe mais n'est pas
  câblé à ce formulaire — l'API ne l'expose que pour `active`/dérogations
  de façon minimale, voir le code pour le détail exact).
- **Pas d'agrégat cross-compagnie** pour les coûts (`/params`, onglet
  Coûts) ni pour les KPIs `/fraude`/`/monitoring` — dérivés côté front
  d'une liste complète (pageSize large), documenté dans le code.
- **Exports CSV placeholder** (`/monthly`, `/quarter`, `/ledger`) : l'API
  n'expose pas d'endpoint de génération de bordereau/export — export CSV
  généré côté front à partir des données déjà chargées, documenté dans
  le code et les libellés d'écran.
- **Journal des pénalités/PV `/commission`** : pas d'historique exposé
  par l'API, tenu en mémoire pour la session courante (même limite que
  le journal `/import`).

## Scripts

| Script | Rôle |
|---|---|
| `npm run dev` | Démarrage en développement (Turbopack) |
| `npm run build` | Build de production |
| `npm run start` | Démarrage du build de production |
| `npm run lint` | `tsc --noEmit` |
