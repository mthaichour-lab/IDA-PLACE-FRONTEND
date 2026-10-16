# HANDOFF — pour l'agent Frontend

Le socle (coque, tokens, composants transverses, i18n, auth scaffold,
client HTTP) est posé et **ne devrait pas avoir besoin d'être réécrit** —
seulement étendu. Un seul écran est réellement implémenté :
`/referential` (Module X, écran 12). Les 13 autres sont des pages "en
construction" (`src/components/WipPage.tsx`) avec le bon badge/titre.

## Priorité des écrans restants (ordre suggéré)

### 1. `/cockpit` (Module I, écran 1) — priorité haute

Le back-end expose déjà un contrat **stable** :

```
GET /api/v1/cockpit/summary
```

Réponse (voir `ida-place-backend/src/cockpit/cockpit.module.ts`) :

```json
{
  "kpis": { "dossiersDuJour": 37, "aApparier": 14, "enRetard": 5, "compensationAVenir": 2840000 },
  "sparklineDeclarations": [12, 18, 15, ...],
  "barresNettes": [{ "company": "CAAT", "net": 120000 }, ...],
  "updatedAt": "2026-..."
}
```

À faire : bandeau `KpiRow`/`Kpi` (4 KPIs), `Sparkline` (déjà dans
`src/components/ui/BarChart.tsx`) pour `sparklineDeclarations`, `BarChart`
pour `barresNettes`, raccourcis vers `/matching` et `/import`. Rafraîchir
en temps réel : s'abonner au WebSocket `ws://<API>/realtime` (Socket.IO,
namespace `/realtime`) — le back émet pour l'instant un seul événement de
démonstration `metering.tick` toutes les 15s (voir
`ida-place-backend/src/realtime/realtime.module.ts`) ; les événements
`claim.ingested`/`match.updated` arriveront quand l'agent Backend les
branchera (ne pas bloquer l'écran dessus, juste s'abonner et rafraîchir
`refetch()` de la query TanStack quand un événement arrive).

### 2. `/matching` (Module A · §6.3, écran 2) — priorité haute

```
GET  /api/v1/matching/queue?filter=TOUS|AUTO|A_CONFIRMER|NON_APPARIES&page=&pageSize=
GET  /api/v1/matching/queue/counters
GET  /api/v1/matching/thresholds
POST /api/v1/matching/{id}/decide   { action: "confirm"|"reject"|"complement"|"link", reason?, linkDeclId? }
```

Forme de `MatchQueueItemDto` (voir `ida-place-backend/src/matching/dto/
matching.dto.ts`) : `refA/companyA/plateA`, `refB?/companyB?/plateB?`,
`score`, `level`, `status`, `econstatShared`, `criteria` (les 6 critères
pondérés B.5 — déjà exposés individuellement, utiliser `ScoreBar` pour
`score`, `Tag` pour `level`/`status`). À faire : onglets
`Tous/Auto/À confirmer/Non appariés` (`Tabs`, compteurs via
`/matching/queue/counters`), tableau paginé 6/p (`Table`), panneau droit
listant `criteria` avec les poids (35/15/15/10/10, en dur côté front
puisque ce sont des libellés d'affichage, pas une règle métier — le score
final vient toujours du back), boutons Confirmer/Rejeter/Complément
(`POST .../decide`) + raccourcis clavier C/R/↑↓ (A.4).

`matchDecide` est le privilège requis pour `decide` — utiliser
`hasPrivilege('matchDecide')` pour griser les actions.

### 3. `/import` (Module XII, écran 3) — priorité haute

```
GET  /api/v1/claims/import/columns   (modèle 47 colonnes, B.4)
POST /api/v1/claims/import           (multipart/form-data, champ "file")
GET  /api/v1/claims?company=&state=&page=
```

`POST /claims/import` renvoie `ClaimImportReportDto` (voir
`ida-place-backend/src/claims/dto/claim-import.dto.ts`) :
`{fileName, importedAt, totalRows, eligibleCount, ineligibleCount, rows[]}`,
chaque `rows[i]` = `{rowNumber, verdict: "ELIGIBLE_IDA"|"HORS_IDA",
reasons[], data}`. À faire : zone de dépôt (drag-drop + bouton), lien de
téléchargement du modèle (`GET /claims/import/columns` pour construire un
tableau de colonnes attendues, ou un export Excel statique généré côté
front à partir de cette liste), aperçu ligne à ligne avec `Tag` ok/ko
selon `verdict`, affichage de `reasons` si `HORS_IDA`. Le privilège requis
pour importer est `import`.

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
- **Client HTTP** : `apiGet`/`apiPost`/`apiPut` + `ApiError` typée.

## Dette / limites connues de ce socle

- Les types TypeScript des réponses API (`src/lib/types.ts`) sont écrits
  à la main, pas générés depuis le schéma OpenAPI. Dossier technique A.1
  recommande `openapi-typescript` — à faire : `npx openapi-typescript
  http://localhost:3001/api/docs-json -o src/lib/api-types.generated.ts`
  une fois le contrat des écrans suivants stabilisé, puis migrer les
  imports de `src/lib/types.ts` vers ce fichier généré.
- Pas d'intégration OIDC Keycloak réelle (login/refresh). Le client HTTP
  envoie un en-tête `x-dev-user` fixe (voir `.env.example`). À remplacer
  par `oidc-client-ts` ou `next-auth` + provider Keycloak quand le realm
  sera disponible (coordination avec l'agent Backend sur
  `KeycloakStrategy`).
- Pas de connexion WebSocket/SSE encore établie côté front (le
  `RealtimeModule` back est prêt côté serveur, voir §1 ci-dessus) ; à
  créer un hook `useRealtime(room, onEvent)` avec `socket.io-client` au
  moment d'implémenter `/cockpit`.
- `npm install`/`next build` ont été vérifiés dans cet environnement
  (registre npm joignable) ; `npm run lint` (tsc --noEmit) passe.
