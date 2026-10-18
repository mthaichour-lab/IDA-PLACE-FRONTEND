# HANDOFF — pour l'agent Frontend

Le socle (coque, tokens, composants transverses, i18n, auth scaffold,
client HTTP) est posé et **ne devrait pas avoir besoin d'être réécrit** —
seulement étendu.

**Les 14 écrans sont maintenant tous réellement implémentés et branchés
sur l'API réelle.** Sprint 2 : `/cockpit`, `/matching`, `/import`,
`/referential`. Sprint 3 : les 10 restants, livrés par **deux agents
Frontend en parallèle** (worktrees séparés, un par l'agent Backend
correspondant) :
- `/monitoring`, `/fraude`, `/metering`, `/stats`, `/params` ;
- `/exchanges`, `/monthly`, `/quarter`, `/commission`, `/ledger`.

## ⚠️ 2026-10-17 — Le dossier technique de référence est maintenant disponible

Le document cité partout dans ce code (`IDA_Place_Dossier_Technique.md`,
jusqu'ici introuvable sur cette machine) est maintenant sur le poste de
l'utilisateur : `C:\Users\mthai\Desktop\IDA\IDA_Place_Dossier_Technique.md`
+ un guide utilisateur illustré, `Guide_IDA_Place.docx` (16 captures
d'écran de référence, une par écran). **Les deux contredisent plusieurs
décisions prises faute de mieux pendant les sprints précédents :**

1. **Pagination = 6 lignes/page, pas 7.** Corrigé ce sprint sur les 14
   écrans + `Table.tsx` (le prop `pageSize` par défaut était déjà
   incohérent avec son propre commentaire JSDoc, qui disait déjà 6).
2. **`/stats` doit avoir une mesure "Pour 100 000 hab."** — retirée par
   erreur début sprint 3 bis en suivant l'omission du back (qui avait
   lui-même omis la mesure faute de référentiel démographique). Le
   dossier ne fournit pas non plus ce référentiel : **à trancher avec
   l'UAR/CNA avant de la réintroduire** (ne pas inventer de données de
   population).
3. **Écart de maquette majeur, plusieurs écrans.** Les captures du guide
   montrent des écrans sensiblement plus riches que l'implémentation
   actuelle (ex. `/quarter` : agenda de réunion commission, matrice
   thermique des positions bilatérales, diagramme circulaire des flux de
   règlement, 6 KPI). Certains éléments nécessitent des données/
   référentiels que le modèle back n'a pas — à chiffrer écran par écran
   avant de se lancer, PAS une simple session de polish. Voir les deux
   documents avant toute reprise de ce chantier.

### `/stats` rapproché de la capture de référence (2026-10-17)

Première passe de rapprochement (voir HANDOFF.md back pour le détail
des 3 points back) :
- **KPI de synthèse** (`GET /stats/summary`, réel) : déclarations,
  taux d'opposition, montant compensé, délai moyen de règlement.
- **Classement "Zones à forte sinistralité"** (top 5, calculé côté
  front à partir de `/stats/wilayas`, trié par la mesure active).
- **"Activité mensuelle" restaurée en 4 séries réelles** (déclarations/
  Annexes 2 émises/oppositions/recours réglés, via `RecoursModule`,
  devenu réel) — remplace les champs `econstat`/`autresCanaux` que
  j'avais substitués par erreur à ces 4 séries début sprint 3 bis en
  suivant l'ancienne approximation du back, alors que le dossier/guide
  les demandaient explicitement par leur nom d'origine.
- **"Répartition par canal de déclaration"** conservée (`econstat` vs
  `autresCanaux`) — c'est la bonne approximation pour CETTE mesure-là
  (le dossier demande "mobile vs agence", data absente du modèle), mais
  ne jamais la relabelliser "mobile"/"agence" : elle ne mesure que
  ECONSTAT vs ERP+IMPORT+API.
- **Encore manquant** (voir dossier A.4 écran 11, hors périmètre de
  cette passe) : mesure "Pour 100 000 hab." (référentiel démographique
  manquant, point 2 ci-dessus), comparatif "vs IRSAM" (baseline absente
  des deux documents), répartition par code de barème Art.14 et par
  catégorie de véhicule, tableau "délais de bout en bout", tableau
  "activité par compagnie" — aucun champ source pour ces quatre
  derniers dans le modèle `Claim` actuel.
- Test composant (`page.test.tsx`) réécrit en conséquence (8 cas).
  Vérifié en navigateur réel (import + recours réglé + opposé → KPI et
  graphiques corrects).

### `/quarter` rapproché de la capture de référence (2026-10-17)

Voir HANDOFF.md back pour le détail des 2 endpoints additifs :
- **KPI de synthèse** (`GET /settlement/quarter/:q/summary`, réel) :
  positions brutes, après netting bilatéral, après netting
  multilatéral, réduction des flux (%), recours compensés, en
  opposition (hors circuit).
- **"Positions nettes multilatérales" en tableau** (compagnie/à
  recevoir/à payer/position) — remplace l'ancienne liste de chips,
  mêmes données (`SettlementQuarter.net`, contrat figé inchangé).
- **"Matrice des positions brutes" (nouvelle section)** — carte
  thermique créancier(ligne)×débiteur(colonne) via `GET
  /settlement/quarter/:q/matrix`, couleur dégradée par intensité (même
  pattern que la carte des wilayas de `/stats`), marges "à
  recevoir"/"à payer" par ligne/colonne calculées côté front à partir
  des cellules. Remplace l'ancienne table "positions bilatérales" qui
  montrait en réalité les positions déjà NETTÉES (`positions`, pas la
  matrice brute) sous ce nom trompeur.
- **Encore manquant** (captures du guide, hors périmètre de cette
  passe) : agenda de réunion de commission (date/lieu/ordre du jour —
  aucune donnée source, voir HANDOFF.md back), diagramme circulaire des
  flux de règlement (visualisation à construire, les données existent
  déjà via `net`/`matrix`), logos réels des compagnies (actuellement
  `CoChip` — pastille colorée + code, pas une image — cohérent avec le
  reste de l'app, pas changé ici).
- Test composant (`page.test.tsx`) réécrit en conséquence (4 cas).
  Vérifié en navigateur réel (3 recours réglés CAAT/SAA + 1 opposé →
  KPI et matrice corrects, somme "à payer"/"à recevoir" cohérente).

### `/exchanges` rapproché de la capture de référence (2026-10-18)

- **Onglets Réglés/Rejetés ajoutés** — `REGLE`/`REJETE` sont des états
  réels de `RECOURS_STATES` (déjà filtrables côté API) mais n'étaient
  jusqu'ici tout simplement pas proposés comme onglets côté front, un
  oubli pur et simple, pas une dérive. Les onglets exotiques du guide
  ("Acceptés/silence" vs "Réglés/compensés") restent hors périmètre :
  leur distinction métier exacte n'est précisée dans aucun des deux
  documents — deviner une règle de regroupement aurait été inventer une
  donnée, pas la reconstruire (voir HANDOFF.md back).
- **Recherche libre ajoutée** (n° recours/dossier/compagnie) via le
  nouveau paramètre `q` de `GET /recours` (additif, voir HANDOFF.md
  back).
- **"Fil d'échanges" reconstruit à partir des champs RÉELLEMENT
  persistés** (`requestSentAt`/`opposition`/`contestation`/
  `commissionAt`/`resolution`) — remplace l'ancien `transitionLog`
  (état React local, perdu au rechargement, ne montrait que `{state,
  transitionedAt}` sans le motif d'opposition/contestation). Le
  nouveau fil affiche chaque étape RÉELLEMENT survenue (Annexe 2/3/4,
  transmission Commission, résolution) avec son motif quand il existe,
  trié chronologiquement — honnête : pas de noms d'auteur ni d'avatar
  comme dans la capture (`decidedBy` n'est pas persisté sur `Recours`,
  voir B.3 back), juste ce qui est réellement là.
- Après chaque transition, la fiche sélectionnée est rechargée en
  entier (`GET /recours/:id`) plutôt que de ne mettre à jour que
  `{state, timer}` — nécessaire pour que le fil reflète immédiatement
  la nouvelle étape (opposition/contestation/résolution).
- **Toujours hors périmètre** (voir HANDOFF.md back) : pièces jointes
  Annexe 2/3/4, numéro de dossier par compagnie, assuré victime nommé,
  code de barème par dossier.
- Test composant (`page.test.tsx`) réécrit en conséquence (7 cas).
  Vérifié en navigateur réel (opposition avec motif réel → fil
  d'échanges et recherche corrects).

### `/monthly` et `/commission` rapprochés de la capture de référence (2026-10-18)

Backend préparé en parallèle par deux agents différents (voir plus bas) :
`/monthly` par un agent Backend dans un autre worktree (pas encore mergé au
moment de cette passe front, forme fixée avec lui avant de coder contre) ;
`/commission/summary` et `/commission/sanctions` par le Tech Lead lui-même,
déjà mergés et réels au moment de cette passe (vérifiés directement contre
`commission.dto.ts`/`commission.controller.ts` back avant d'écrire le front
et les tests — pas de contrat deviné).

- **`/monthly` — KPI de synthèse** (`GET /settlement/monthly/:period/summary`) :
  recours intégrés, montant de la synthèse, exclus — oppositions (RG-06),
  échéance de saisie. Le KPI d'échéance est intitulé "Échéance de saisie"
  (pas "5e jour ouvré" comme dans la capture) : `MonthlySummaryDto`
  (back `settlement.dto.ts`) documente explicitement que `insertionDeadline`
  est un calcul en jours CALENDAIRES (AAAA-MM-05), pas ouvrés — aucun
  calendrier de jours fériés algériens disponible ; afficher "jour ouvré"
  aurait été une affirmation fausse. Une mention "Jour calendaire · Art. 16"
  est affichée à la place en `extra` du KPI.
- **`/monthly` — "Synthèse Annexe 7 — créanciers / débiteurs"** (nouvelle
  section, `GET /settlement/monthly/:period/annexe7`) : tableau par paire
  orientée créancier→débiteur (`CoChip`, nombre, montant), SANS netting —
  chaque paire telle quelle, contrairement à `/quarter` qui nette. `
  SettlementMonthly` (contrat figé) inchangé.
- **`/monthly` — tableau "Complétude de la saisie par compagnie"** conservé
  tel quel (déjà branché sur de vraies données, pas retouché).
- **`/monthly` — hors périmètre, documenté plutôt que bricolé** : le
  pipeline "Avancement du lot" à 5 étapes nommées (Saisie compagnies /
  Synthèse Annexe 7 / Annexe 8 / Transmission / Scellement) visible dans la
  capture. Aucune entité de workflow de clôture mensuelle n'existe côté
  back pour ça (pas de dates d'étapes, pas de statut par étape) — construire
  un faux pipeline avec des dates bidon aurait été inventer une donnée.
- **`/commission` — KPI de synthèse** (`GET /commission/summary`, réel,
  Tech Lead) : affaires pendantes, hors délai 15j (Art. 24), recours jugés
  fondés, oppositions jugées fondées (Art. 12, indépendant des dossiers de
  commission).
- **`/commission` — onglets ajoutés** (`Tabs`, même composant que
  `/exchanges`) : "Rôle des affaires" (tableau existant, inchangé) et
  "Sanctions" (nouveau — `GET /commission/sanctions`, qui existait déjà
  côté back et était réel, mais n'était jusqu'ici tout simplement pas
  affiché côté front : un oubli pur et simple de ce sprint-ci, pas une
  limite de données). Colonnes : compagnie sanctionnée (`CoChip`), montant
  (`—` si absent, ex. simple avertissement non financier), motif, date,
  auteur (`orderedBy`).
- **`/commission` — colonne "Phase" relabellisée** : seul le LIBELLÉ
  affiché change (clé i18n `commission.status.*`), la valeur `status` et
  toute la logique (tri, filtre, `statusTone`) restent inchangées.
  Correspondance appliquée telle que demandée par le Tech Lead :
  `A_INSTRUIRE` → "Instruction", `EN_DELIBERE` → "Audience", `PRONONCE` →
  "Concilié". **Le Product Owner valide cette correspondance en parallèle**
  — si son rapport la contredit, ne pas la redéfaire soi-même : juste
  changer les 3 valeurs de ces clés dans `translations.ts` (dictionnaire
  `fr` uniquement, AR/EN auto-dérivés).
- **`/commission` — hors périmètre, documenté plutôt que bricolé** :
  onglets "Adhésions & retraits" et "Plafond conventionnel" (aucune entité
  back pour ni l'un ni l'autre) ; fil de pièces échangées contradictoirement
  avec rapporteur nommé dans la capture (aucune donnée source — même limite
  déjà documentée pour le fil d'échanges `/exchanges`, pas de `rapporteur`
  ni de pièces jointes dans `CommissionCase`/`SanctionViewDto`).
- Types ajoutés dans `src/lib/types.ts` : `SettlementMonthlySummary`,
  `SettlementMonthlyAnnexe7`(Pair), `CommissionSummary`, `Sanction` — tous
  additifs, les contrats figés `SettlementMonthly`/`CommissionCase` ne
  changent pas de forme.
- Tests composants (`page.test.tsx`) mis à jour (2 cas ajoutés par écran,
  même esprit que les sections précédentes) : KPI de synthèse + nouvelle
  section pour `/monthly` ; KPI de synthèse + registre des sanctions dans
  son onglet pour `/commission`. Le test existant vérifiant l'ancien
  libellé "En délibéré" a été mis à jour pour "Audience".
- **Point de vigilance pour le Tech Lead** : `/settlement/monthly/:period/
  summary` et `/annexe7` sont codés contre la forme de `MonthlySummaryDto`/
  `Annexe7Dto` trouvée dans `ida-place-backend-wt-dev/src/settlement/dto/
  settlement.dto.ts` (worktree de l'agent Backend en parallèle, PAS encore
  mergé dans `ida-place-backend` au moment de cette passe front, et les
  routes correspondantes n'étaient pas encore câblées dans
  `settlement.controller.ts` de ce worktree non plus) — à revérifier une
  fois son travail mergé, avant de faire confiance à ce front sans retest.
  `/commission/summary` et `/commission/sanctions`, eux, étaient déjà réels
  et mergés dans `ida-place-backend` (checkout principal) au moment de
  cette passe — vérifiés directement contre le code, pas un contrat deviné.

## ⚠️ Particularité de ce sprint : deux implémentations concurrentes réconciliées

Une **session Claude indépendante**, travaillant en parallèle sur ce même
dépôt sans visibilité sur celle-ci, a livré sa propre implémentation de
`/exchanges`, `/monthly`, `/quarter`, `/commission` (+ une suite de tests
composants Vitest/RTL, nouvelle dans ce dépôt — voir plus bas) et l'a
poussée sur `origin/master` avant que ce sprint ne pousse le sien. Les
deux implémentations ont été **fusionnées** (pas un simple merge Git — un
vrai travail de réconciliation) : la version de la session parallèle a
été **conservée** pour ces 4 écrans (déjà poussée, pas de raison de la
jeter), celle de ce sprint **conservée** pour les 5 autres. Si tu
retrouves une trace de l'ancienne implémentation de `/exchanges` etc. de
*ce* sprint dans l'historique git, c'est normal — elle a été remplacée.

**Bug important trouvé et corrigé pendant la réconciliation** : la
session parallèle avait écrit son frontend (`/exchanges` notamment)
*avant* que son propre agent Backend ne rende `RecoursModule`/
`SettlementModule`/`CommissionModule` réels (deux commits séquentiels de
la même session, jamais revérifiés l'un contre l'autre) — résultat : son
frontend était construit contre un contrat **deviné**, pas le contrat
**réel** de son propre backend (états `RecoursState` faux — pas de
`ENVOYE`, `REGLE`/`REJETE` manquants ; endpoint `/recours/:id/transition`
appelé avec `{toState}` alors que le vrai contrat attend `{action,
reason}` ; échéance exposée comme `timer: {...}` structuré, pas un champ
plat `conventionalDeadlineAt` ; routes Commission sous `/commission/cases/
*`, pas `/commission/*`, etc.). **Tout a été corrigé** (voir
`src/lib/types.ts` et les 4 écrans concernés) en revérifiant chaque DTO
réel contre `ida-place-backend/src/{recours,settlement,commission}/dto/*.dto.ts`
avant de corriger — vérifié en navigateur réel, bout-en-bout (création
d'un recours, opposition, cycle mensuel, grille trimestrielle). **Leçon
pour la suite** : un écran livré par la même session que son backend
n'est pas automatiquement vérifié contre lui — toujours revérifier la
forme exacte avant de faire confiance à un "c'est fait" venant de la
même session.

## Corrigé après la revue croisée sprint 3 (propre à ce sprint, pas la réconciliation ci-dessus)

Voir aussi l'historique git (commit "fix(frontend): corrige les anomalies
de revue croisée sprint 3") : `/commission` (ancienne version, remplacée
depuis), `/monitoring`, `/fraude`, `/params` crashaient (pagination
`{page,total,items}` consommée comme tableau brut, forme de `details`
Monitoring incorrecte, type `FraudCase` incorrect) ; connexion temps réel
(`realtime.ts`) corrigée (un navigateur ne peut pas poser d'en-tête
personnalisé sur un WebSocket brut — identité dev transmise via `auth`
désormais).

## Sprint 3 bis

`/params`, onglet Utilisateurs & accès : édition actif/suspendu +
dérogations grant/revoke (cases à cocher) branchée sur le vrai
`PUT /admin/users/:id` (réel côté back depuis la réconciliation),
vérifié en navigateur bout-en-bout (bascule de statut, octroi d'un
privilège, persistance confirmée après rechargement de la liste).

## Ce qui est déjà prêt à réutiliser

- **Coque** : `src/components/shell/{Rail,Topbar,MobileBar,AppShell}.tsx`
  + `nav-items.ts` (les 14 routes).
- **Composants transverses** : `Kpi/KpiRow`, `Tag`, `Tabs`, `Table`
  (pagination 6/p), `Modal`, `Toast/useToast`, `CoChip`, `ScoreBar`,
  `BarChart/Sparkline`, `TileGrid`, `CountdownBar` (version de la session
  parallèle conservée — prend un `renderLabel` pour l'i18n du libellé),
  `CompanyPeriodPicker`/`PriceGridEditor` (`src/components/metering/`).
- **i18n** : `useI18n()`. FR complet (14 écrans), AR/EN placeholders.
- **Thème** : `useTheme()`.
- **Auth** : `useAuth()`, `RequirePrivilege`.
- **Client HTTP** : `apiGet`/`apiPost`/`apiPut`/`apiPostForm` + `ApiError`
  typée. `DEV_USER` exporté (réutilisé par `realtime.ts`).
- **Temps réel** : `useRealtime(events, onEvent)` — fonctionne réellement
  dans un navigateur (transmission via `auth`, pas un en-tête). **Toujours**
  combiner avec un `refetchInterval` TanStack de repli.
- **Tests** : Vitest + React Testing Library — `npm test`. 48 tests
  composants, les 14 écrans couverts : `/cockpit`, `/import`, `/matching`,
  `/referential` (apportés par la session parallèle, sprint 3) +
  `/monitoring`, `/fraude`, `/metering`, `/stats`, `/params`, `/exchanges`,
  `/monthly`, `/quarter`, `/commission`, `/ledger` (sprint 3 bis, patron
  existant — `src/test/render.tsx`, `vitest.setup.ts`). 1-2 cas par écran
  (rendu principal + une règle métier représentative : pagination 6/p,
  actions autorisées par état, scoping d'un privilège B.7) — pas une
  couverture exhaustive de chaque branche.

## Corrigé en revue de polish (2026-10-17) — dérive de contrat `/stats`

`StatsModule` (back) a changé de forme sans que ce changement soit
répercuté côté front : `pour100k` est omis (pas de référentiel
démographique), et l'activité mensuelle expose `econstat`/`autresCanaux`
(comptes réels par canal) au lieu des anciens champs mock
`annexes2`/`oppositions`/`indemnises`/`econstatMobile`/`econstatAgence`.
**L'écran `/stats` affichait donc des valeurs `undefined`/`NaN` en
conditions réelles** (jamais détecté faute de test composant avant ce
sprint). Corrigé : `WilayaStat`/`MonthlyActivity` (`src/lib/types.ts`)
et `/stats/page.tsx` alignés sur `WilayaStatDto`/`MonthlyStatDto` réels
(back `stats.service.ts`) — mesure "pour 100k hab." retirée des onglets,
3 séries mensuelles (déclarations/e-constat/autres canaux), répartition
par canal en comptes réels (plus de fausses "%"). Vérifié en navigateur
réel (import d'un dossier, wilaya 16 → comptes/montants corrects) + test
composant mis à jour. **Leçon** : toujours vérifier un type de données
mocké contre le DTO réel du back avant d'écrire un test composant — ne
pas faire confiance à `types.ts` existant sans le recomparer.

## Dette / limites connues (documentées dans le code, pas des bugs)

- **Pas d'agrégat cross-compagnie** pour les coûts (`/params`) ni pour
  les KPIs `/fraude`/`/monitoring` — dérivés côté front d'une liste
  complète (pageSize large).
- **Commission** : les pénalités (`SanctionViewDto`) sont des
  enregistrements séparés liés par `commissionCaseId`, pas embarqués dans
  `CommissionCase` — affichées localement pour la session courante après
  prononcé (voir `/commission`, `decisions` state). Le PV, lui, est bien
  persisté et reflété après invalidation de la requête.
- **`/exchanges`** : pas d'historique de transitions exposé par l'API —
  tenu en mémoire pour la session courante (même limite que le journal
  `/import`).

## Scripts

| Script | Rôle |
|---|---|
| `npm run dev` | Démarrage en développement (Turbopack) |
| `npm run build` | Build de production |
| `npm run start` | Démarrage du build de production |
| `npm run lint` | `tsc --noEmit` |
| `npm test` | Tests composants (Vitest + RTL) |
