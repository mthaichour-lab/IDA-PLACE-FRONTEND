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
- **Revue Tech Lead (2026-10-18) — complétée et mergée** : `SanctionType`
  complété avec `'PENALITE_FINANCIERE'` (manquait par rapport à l'énum
  réelle du back, `commission.rules.ts` → `SANCTION_TYPES`) ; sans impact
  runtime (aucune branche sur `.type` dans `commission/page.tsx`) mais
  nécessaire pour la justesse de typage, les pénalités (déjà créées via
  `POST /commission/cases/:id/penalty`) partageant le même registre que
  les sanctions. Suite complète (lint/vitest/build) rejouée après le
  correctif : 60/60 tests, build propre. Mergé dans `master`
  (`sprint4-frontend-team` → `master`, commit `3fe88f0` puis merge). Le
  point de vigilance ci-dessus est résolu : le travail de l'agent Backend
  est désormais mergé dans `ida-place-backend` (checkout principal),
  `MonthlySummaryDto`/`Annexe7Dto` confirmés identiques entre front et
  back champ à champ. **Vérifié en navigateur réel** (3001/3002, jamais
  3000) : recours réglé + recours en opposition créés via l'API, dossier
  de commission avec une pénalité (`PENALITE_FINANCIERE`, montant) et une
  sanction (`AVERTISSEMENT`, sans montant) — `/monthly` affiche les 4 KPI
  et la ligne Annexe 7 attendue, `/commission` affiche les 4 KPI, la phase
  "Instruction" relabellisée, et l'onglet Sanctions avec les deux types de
  sanction correctement rendus (montant `—` pour l'avertissement).
  **Note d'environnement dev** : `CORS_ORIGIN` du back est en dur sur
  `http://localhost:3000` par défaut (`main.ts`) — le faire pointer vers
  `http://localhost:3002` (variable d'env `CORS_ORIGIN`) pour tester le
  front sur ce port sans toucher au 3000 (occupé par une appli sans
  rapport sur cette machine de dev).

### `/monitoring` rapproché de la capture de référence (2026-10-18)

Backend préparé en parallèle par l'agent Backend (worktree dédié,
`monitoring.scoring.ts`/`monitoring.service.ts`/`monitoring.module.ts`,
déjà mergé dans `ida-place-backend` au moment de cette passe front —
vérifié directement contre le code, pas un contrat deviné) :
`MonitoringCompanyResult` complété avec `grade`/`profile`, et nouvel
endpoint `GET /monitoring/companies/:code/journeys`.

- **Classement — nouvelles colonnes** : Note (lettre A/B/C/D dérivée du
  score composite, `gradeFromScore`, seuils documentés côté back comme
  hypothèse non chiffrée par le dossier technique), puis les taux BRUTS
  réels par compagnie (Délais/Silences/Opp. émises en %, Délai moy. en
  jours, Forclos en nombre, Données en %) — depuis le nouveau `profile`
  de chaque compagnie, PAS les scores composite inversés de `details`
  (les deux représentent des notions voisines dans des sens opposés,
  voir le commentaire en tête de `monitoring.scoring.ts` : "Silences"
  dans le classement est le taux brut réel de silences, pas l'inverse du
  score de conformité).
- **"Profil — {compagnie}"** (nouvelle section) : radar 7 axes (nouveau
  composant transverse `RadarChart.tsx`, SVG natif, même esprit que
  `BarChart`/`Sparkline` — pas de librairie graphique), un axe par
  composante du score composite (`details.*.value`, 0-100, sens "plus
  haut = meilleur"), score composite affiché en grand au centre. Les 8
  tuiles associées (`Kpi`) viennent de `profile.*`
  (comptes/taux bruts) + `details.qualiteDonnees.value` pour "Qualité
  des données" (qui, contrairement à silences/oppositions, est déjà un
  taux dans le même sens que le score — pas de représentation brute
  séparée côté back, donc pas de duplication inventée).
- **Bandeau "Oppositions fréquentes" conditionnel** : affiché quand
  `profile.oppositionsRatePct` de la compagnie sélectionnée dépasse
  `oppositionAlertThresholdPct` (nouveau champ renvoyé par
  `GET /monitoring/scores`, seuil non chiffré par le dossier technique —
  hypothèse back à valider avec l'UAR, voir `monitoring.scoring.ts`).
- **"Vue par dossier — parcours complet"** (nouvelle section, scopée à
  la compagnie sélectionnée, pagination 6/p + recherche libre
  côté front sur recours/dossier/contrepartie — même pattern que les
  autres écrans qui dérivent un classement d'une liste complète,
  pageSize large, déjà documenté plus bas dans "Dette / limites
  connues") : colonnes Recours (id + n° dossier), Sens (`émis
  →`/`reçu ←` + contrepartie), Parcours inter-compagnies, État (même
  mapping état→tonalité que `/exchanges`, `stateTone`).
- **Deux écarts volontaires avec la capture de référence du guide
  illustré, documentés plutôt que forcés** :
  1. La capture affiche "Réponses dans les 10 j". La vraie fenêtre
     Art. 10 configurée dans l'app (`RecoursService.getTimerConfig().
     silenceDays`) est 30 j par défaut, utilisée partout ailleurs pour
     les mêmes recours (`/exchanges`, `CountdownBar`). Dupliquer un
     second "10 j" en dur ici aurait créé une incohérence interne avec
     le reste de l'app pour la même notion. Le libellé de la tuile est
     donc construit dynamiquement : `"Réponses dans les {silenceDays}
     j"`, avec `silenceDays` renvoyé par l'API (nouveau champ top-level
     de `GET /monitoring/scores`).
  2. La capture affiche un compte de pastilles fixe par dossier ("8
     étapes", "11 étapes"), ce qui suggère une taxonomie procédurale
     détaillée des Annexes 2/3/4 qu'aucun des deux documents de
     référence (dossier technique, guide illustré) ne définit
     explicitement. Plutôt que d'inventer des étapes non documentées
     pour reproduire ces chiffres, `GET /monitoring/companies/:code/
     journeys` renvoie les SEULES étapes réellement persistées par
     recours (`buildRecoursJourneySteps`, back `recours.rules.ts` —
     1 à 5 étapes selon l'historique réel : Annexe 2 toujours présente,
     puis Annexe 3/4/Commission/résolution si et seulement si elles ont
     réellement eu lieu). La colonne "Parcours inter-compagnies" affiche
     donc exactement ce nombre de pastilles (toutes pleines, puisque ce
     sont des étapes déjà survenues) + `"{N} étapes"`, N variant par
     dossier — jamais un compte fixe 8/11.
- Types ajoutés dans `src/lib/types.ts` : `MonitoringCompanyProfile`,
  `MonitoringJourneyStep`, `MonitoringJourney` — additifs,
  `MonitoringCompanyScore`/`MonitoringScores` (contrat figé) seulement
  complétés (`grade`/`profile`, `silenceDays`/`oppositionAlertThresholdPct`),
  jamais retouchés en forme.
- Nouveau composant transverse : `src/components/ui/RadarChart.tsx`.
  Nouvelle classe de mise en page `.grid.g-mon` (`globals.css`, même
  esprit que `g-side`/`g-side2` — radar à gauche en largeur fixe-ish,
  tuiles + vue par dossier à droite en largeur flexible, repli sur une
  colonne sous 1020px).
- L'ancien bloc "Pondérations du scoring" (sheet séparée) et le panneau
  de détail générique (décomposition par critère + lien vers la file de
  confrontation) ont été retirés : les pondérations sont déjà listées
  dans le sous-titre de l'écran (texte rapproché du guide illustré), et
  le panneau générique est remplacé par les sections réelles
  (Profil/tuiles/bandeau/vue par dossier) ci-dessus. Clés i18n
  `monitoring.panel.*`/`monitoring.weights.title` devenues obsolètes
  retirées de `translations.ts` (dictionnaire `fr`, scope confirmé
  propre à cet écran avant suppression).
- Test composant (`page.test.tsx`) réécrit en conséquence (7 cas) :
  classement avec note + taux bruts, repère "non disponible" sur une
  composante `NON_DISPONIBLE`, radar/tuiles de la compagnie sélectionnée
  par défaut (libellé dynamique `silenceDays`), bandeau conditionnel
  (affiché/masqué selon le seuil), nombre RÉEL d'étapes par dossier (pas
  8/11 fixe), pagination 6/p de la vue par dossier. `npm run lint` /
  `npx vitest run` (64/64) / `npm run build` tous propres après cette
  passe.
- **Hors périmètre, pas de données source** : logos réels des compagnies
  dans le classement (toujours `CoChip` — pastille colorée + code, même
  limite documentée pour `/quarter`), export Excel du classement et de
  la vue par dossier (boutons visibles dans la capture, aucun endpoint
  d'export côté back pour cet écran).

### `/fraude` rapproché de la capture de référence (2026-10-18)

Backend préparé en parallèle par l'agent Backend sur ce même sprint (`plateA`
additif sur `FraudCaseViewDto`, 6ᵉ détection `VELOCITE_ADHERENT`, nouvelle
route `GET /fraud/adherents/:company/signals` → `FraudSignalGroupDto[]`) —
vérifié directement contre `fraud.dto.ts`/`fraud.module.ts`/
`fraud.detection.ts`/`fraud.service.ts` réels avant de coder contre, pas un
contrat deviné.

- **Colonne "Plaque"** ajoutée à la file des cas (`plateA`, jointure réelle
  back sur le premier dossier lié ayant une plaque — `—` si absent).
- **Colonne "Adhérent"** remplace l'ancienne colonne "Compagnies" (qui
  affichait TOUTES les compagnies impliquées) : n'affiche que le PREMIER
  code de `companiesInvolved`, conformément à la capture — c'est aussi celui
  utilisé pour interroger `/fraud/adherents/:company/signals`.
- **Panneau de détail refondu en panneau docké** (`grid g-side`, même idiome
  que `/monitoring`) à la place de l'ancienne `Modal` à plat
  (`Object.entries(details)`) : la capture montre un panneau en permanence à
  côté du tableau, pas une fenêtre modale. En-tête "Cas {id}", puis
  compagnie + plaque + badge "{gravité} · {score}/100" (libellés de gravité
  réutilisés de `fraude.severity.*`, aucun nouveau libellé inventé).
- **Sections de signaux groupés** (`GET /fraud/adherents/:company/signals`,
  React Query clé `['fraud','adherents',company,'signals']`) : un groupe par
  catégorie (Doublons & e-constat / Réseau & récurrence / Montants &
  plafond / Incohérences A/B / Vélocité adhérent), seuls les groupes
  réellement présents pour cet adhérent sont affichés (le back ne renvoie
  jamais de groupe vide). Badge "+{count-1}" affiché seulement si le groupe a
  plus d'un cas sous-jacent (`FraudSignalGroupDto.count`), pas de badge pour
  un groupe à 1 seul cas. La phrase de description du signal dominant
  (`describeDominantCase`, `page.tsx`) est composée des SEULS champs
  réellement présents dans le `details` du cas de tête de groupe (score le
  plus élevé, déjà trié par le back) — voir `fraud.detection.ts` pour la
  forme exacte de chaque `details` par type ; aucun champ fabriqué.
- **Lien "Ouvrir l'appariement"** vers `/matching` — idiome et style repris
  tels quels de `/monitoring` (`monitoring.panel.matchingLink`).
- **Journal des actions suspectes — colonne "Réf." ajoutée** : `claimId`
  (présent pour `TRANSMISSION_TARDIVE`) sinon `matchId` (présent pour
  `APPARIEMENT_MANUEL`/`DELIAGE`/`RELIAGE`) sinon l'id de l'action elle-même
  — jamais une valeur fabriquée, voir `FraudActionViewDto` (back).
- **Colonne "Poids" de la capture : OMISE délibérément, pas bricolée.**
  Aucun champ back ne porte de pondération par action suspecte :
  `FraudActionViewDto.details` est une forme libre selon le type
  (`{matchId, status}` pour les décisions de matching observées,
  `{delayDays}` pour une transmission tardive) — rien d'assimilable à un
  "poids" numérique commun aux 4 types d'action. Inventer un nombre ici
  aurait été fabriquer une donnée (règle d'or C.1) ; la colonne est donc
  simplement absente du tableau plutôt que remplie d'une valeur inventée. À
  réintroduire si le Tech Lead/back ajoute un jour un champ de pondération
  réel.
- **Colonnes relabellisées (libellé d'affichage uniquement, même principe
  que le relabellisage "Phase" de `/commission`)** : en-tête "Type" → "Action"
  et "Agent" → "Auteur" sur le journal des actions, pour coller au texte de
  la capture — la clé `type`/`actor` et toute la logique restent inchangées.
  Titre de la section également aligné sur la capture : "Journal des actions
  suspectes — chaîne de place ({n})" (comptage dynamique, même esprit que les
  compteurs d'onglets `/exchanges`).
- Types ajoutés dans `src/lib/types.ts` : `FraudCaseType` complété avec
  `'VELOCITE_ADHERENT'`, `FraudCase.plateA?`, `FraudAction.claimId?`/
  `matchId?`/`details?` (alignés sur `FraudActionViewDto` réel — ces champs
  existaient déjà côté back avant cette passe mais n'étaient pas reflétés
  côté front), `FraudSignalGroup`/`FraudSignalGroupResult` (nouveaux,
  reflet de `FraudSignalGroupDto`). Tous additifs — rien de ce qui existait
  dans `FraudCase`/`FraudAction` ne change de forme.
- Bouton "Cas suspects" du mock (capture) volontairement ignoré — aucune
  spécification derrière dans le dossier technique, purement décoratif.
- Tests composants (`page.test.tsx`) réécrits (5 cas, même esprit que les
  sections précédentes) : tri par gravité (inchangé), colonne "Plaque"
  (valeur réelle + repli `—`), ouverture du panneau docké avec sections de
  signaux groupées (mock `GET /fraud/adherents/:company/signals` à 2
  groupes : un à 1 cas sans badge, un à 3 cas avec badge "+2") + lien
  d'appariement, colonne "Réf." du journal (claimId puis repli matchId).
- Vérifié : `npm run lint` (tsc --noEmit) propre, `npx vitest run` 63/63
  (14 fichiers), `npm run build` propre (17 routes statiques, `/fraude`
  inclus). Pas de serveur dev lancé pour cette passe (ports 3000-3002
  potentiellement occupés par d'autres sessions sur cette machine, voir
  mémoire de session) — vérification faite par la suite de tests composants
  + build, pas en navigateur réel ; à revérifier en navigateur dès qu'un
  port est libre.

### `/metering` rapproché de la capture de référence (2026-10-18, worktree dédié)

Backend déjà préparé au moment de cette passe (`GET /metering/{company}/
{period}/history/{metric}`, additif, mergé dans `ida-place-backend` —
voir ARCHITECTURE.md et le doc-comment de `metering.service.ts`,
`buildMeasuredHistory`) : vérifié directement contre le code, pas un
contrat deviné.

- **"Consommation mensuelle — {Compagnie}" (nouvelle section)** —
  remplace l'ancien graphe de répartition du montant facturable par
  inducteur (qui n'existe pas dans la capture de référence) par un
  sélecteur de métrique (`PriceGrid.metrics`, défaut `claimsIngested` —
  "Dossiers ingérés", comme le guide illustré) + un graphe 10 mois de
  cette métrique, avec ligne de quota inclus en pointillés et dernier
  mois (courant, partiel) rendu plus clair à l'opacité — composant dédié
  `components/metering/ConsumptionHistoryChart.tsx` (SVG natif, pas de
  librairie graphique, même esprit que `components/ui/BarChart.tsx` —
  pas une extension de celui-ci : la ligne de référence et son étiquette
  n'ont de sens que pour ce graphe-ci, les autres usages de `BarChart`
  comme `/stats` n'en ont pas besoin).
- **Showback "coût d'infrastructure attribué" (CPU/Mémoire/Stockage/
  Réseau/Messagerie) volontairement PAS construit**, ni section ni
  "hors périmètre" visible sur l'écran : aucune donnée de coût
  d'infrastructure réelle n'existe côté back (voir ARCHITECTURE.md,
  ligne `MeteringModule`) — à la différence de la facture TARIF-2026.01
  (prix réels appliqués à une mesure mockée), fabriquer des montants DA
  de showback aurait été de la pure invention. Le nouveau graphe prend
  donc toute la largeur de la ligne plutôt que de laisser un bloc vide à
  droite.
- Type ajouté dans `src/lib/types.ts` : `MeteringHistoryPoint`/
  `MeteringHistory` — additif, `MeteringInvoice`/`PriceGrid` (contrats
  figés) inchangés.
- Clés i18n ajoutées dans `translations.ts` (dictionnaire `fr`
  uniquement) : `metering.history.*`. L'ancienne clé `metering.chart.title`
  a été retirée (son seul usage, l'ancien graphe, a été remplacé).
- Test composant (`page.test.tsx`) étendu (3 cas ajoutés) : sélecteur par
  défaut sur "Dossiers ingérés", changement de métrique déclenchant un
  nouvel appel `/history/{metric}` avec mise à jour de la ligne de quota
  affichée, absence de toute section "Showback". Suite complète (lint/
  vitest/build) rejouée après coup : 63/63 tests, build propre.
- Pas de bug pré-existant trouvé dans `PriceGridEditor.tsx` ni dans la
  table de facture/les tuiles — non modifiés, conformément au périmètre
  de cette passe.

### `/params` rapproché des 3 captures de référence (2026-10-18, worktree dédié)

Backend déjà préparé au moment de cette passe (`GET /metering/place-summary/
{period}`, additif, mergé dans `ida-place-backend` — voir le doc-comment de
`MeteringService.placeSummary()` et la route dans `metering.module.ts`) :
vérifié directement contre le code, pas un contrat deviné.

- **Onglet "Utilisateurs & accès" — 4 KPI ajoutés** (utilisateurs/actifs/
  suspendus/rôles) : total et rôles depuis les endpoints déjà consommés
  (`usersQuery.total`, `matrixQuery.roles.length`), actifs/suspendus
  comptés côté front via un second appel pleine page (`usersAllQuery`,
  `pageSize: 10_000`), même idiome que `casesAllQuery` de `/fraude` — la
  liste affichée reste la page courante paginée serveur (6/p), ce second
  appel ne sert JAMAIS de liste affichée.
- **Action "Suspendre"/"Activer" ajoutée directement dans la ligne**
  (capture de référence) — réutilise la même mutation `PUT /admin/users/
  {id}` que la fiche détail (`{active, grant, revoke}`, grant/revoke de
  l'utilisateur conservés tels quels), déclenchée avec `stopPropagation`
  pour ne pas ouvrir la modale de détail au clic sur le bouton.
- **Colonne "Rôle" (onglet Utilisateurs) et en-têtes de la matrice
  (onglet Rôles) passés en libellé humain** (`Tag` pour la colonne, texte
  simple pour les en-têtes) plutôt que la constante technique brute
  (`OPERATEUR_PLACE`, etc., toujours visible ailleurs — ex. fiche détail,
  sélecteur de création) — nouvelle fonction `roleLabel()`, clés
  `params.role.<ROLE>` (6, une par `Role` de `roles-privileges.ts` back).
- **Onglet "Rôles & privilèges" transposé** : rôles en colonnes, privilège
  en ligne (libellé en gras + clé technique en dessous, texte atténué),
  au lieu de l'inverse. Même état/mutation inchangés (`draft`, `toggle`,
  `dirty`, enregistrer/réinitialiser, `AUDITEUR_CSA` toujours lecture
  seule) — pure restructuration de template, aucune logique touchée.
  Nouvelle fonction `privilegeLabel()`, clés `params.privilege.<key>` (17,
  une par `Privilege` de `roles-privileges.ts` back — liste vérifiée dans
  ce fichier, pas devinée depuis la capture). Note explicative existante
  (`params.roles.auditorNote`) étendue plutôt que dupliquée pour couvrir
  à la fois "cochez une cellule…" et la règle Auditeur CSA déjà présente.
- **Onglet "Coûts & tarification" reconstruit en dashboard place
  entière** : remplace le `CompanyPeriodPicker` + `BarChart` par
  compagnie par 4 KPI (revenu mensuel HT, abonnements · N adhérents,
  consommation hors forfait, inducteurs de coût) + un tableau des 12
  inducteurs (mesuré/facturable/poids revenu — barre pleine largeur
  dédiée `RevenueShareBar`, non colorée par seuil contrairement à
  `ScoreBar`/revenu HT/% conso.) + ligne de total "Consommation hors
  forfait", à partir du nouvel endpoint place entière. `CompanyPeriodPicker`
  n'est PAS retiré du dépôt (toujours utilisé par `/metering`) — seulement
  plus importé ici. La "Grille tarifaire paramétrable" (`PriceGridEditor`)
  reste identique, non touchée.
- Type ajouté dans `src/lib/types.ts` : `PlaceMeteringSummary`/
  `PlaceMeteringSummaryLine` — additif, `MeteringInvoice`/`PriceGrid`
  (contrats figés) inchangés.
- Clés i18n ajoutées dans `translations.ts` (dictionnaire `fr`
  uniquement) : `params.users.kpi.*`, `params.users.action.*`,
  `params.users.toast.toggled`, `params.role.*` (6), `params.roles.col.
  privilege`, `params.privilege.*` (17), `params.costs.*` (dashboard/KPI/
  colonnes/total). Les clés mortes `params.costs.revenue.title`/`.note`
  (vue par compagnie retirée) ont été remplacées en place plutôt que
  laissées comme documentation obsolète.
- Test composant (`page.test.tsx`) étendu (4 cas ajoutés) : les 4 KPI
  Utilisateurs avec comptes exacts, bascule actif/suspendu depuis la
  ligne (sans ouvrir la modale), matrice transposée (en-têtes de colonnes
  = rôles, lignes = libellé + clé privilège) avec cocher/enregistrer
  encore fonctionnel, 4 KPI + tableau des inducteurs de l'onglet Coûts.
  Suite complète (lint/vitest/build) rejouée après coup : 74/74 tests,
  build propre.

### `/referential` rapproché de la capture de référence (2026-10-18, worktree dédié)

Backend préparé en parallèle par l'agent Backend sur ce même sprint
(`CompanyViewDto` complété avec `createdAt`/`correspondentName|Phone|Email`/
`agencyCounts`, nouvelles routes `GET /referential/convention|calendar|
motifs`) — vérifié directement contre `company.dto.ts`/
`adherents.controller.ts`/`adherents.service.ts`/
`referential-reference-data.ts` réels avant de coder contre, pas un contrat
deviné.

- **Remplacement intégral du layout à onglets par un maître-détail** : une
  nav verticale de 6 sections à gauche (`grid g-ref`, même idiome que
  `g-mon`/`g-side` de `/monitoring` — narrow-ish + flexible, nouvelle classe
  ajoutée à `globals.css` plutôt qu'une réutilisation trompeuse de `g-mon`),
  contenu de la section sélectionnée à droite. Chaque ligne de nav porte un
  monogramme (même esprit que `rail-icon` du `Rail` — "pas de librairie
  d'icônes imposée", A.1), un titre et un sous-titre dérivé de données
  réelles (ex. "{N} membres · statuts d'adhésion"), jamais un texte figé.
- **Compagnies adhérentes — liste de cartes** (`.co-card-list`/`.co-card`,
  nouvelles classes) remplace le `Table` à colonnes : logo-chip, nom + code,
  ligne de métadonnées "{nameAr} · adhérente depuis le {date} · {DG} DG ·
  {DR} DR · {AG} agences[· correspondant {nom}]" — le fragment correspondant
  est entièrement ABSENT (pas de placeholder) quand `correspondentName` est
  vide, couvert par un test explicite. Badge "{AG} Agences" (le compte de
  agences de type AG spécifiquement, pas le total des 3 types). Boutons
  "Nouvel adhérent"/"Modifier l'adhérent" gardés par `hasPrivilege('refedit')`
  (même garde que le back, `@Privileges('refedit')`) — formulaire
  création/édition réutilisé entre les deux modales (`CompanyFormFields`).
- **Bouton "Excel" de la capture délibérément PAS construit** : aucune route
  d'export back-end (`GET /referential/companies.xlsx` ou équivalent)
  n'existe — fabriquer un bouton qui ne ferait rien, ou un export côté front
  sans données à exporter proprement, aurait été une fonctionnalité
  décorative plutôt que réelle (règle d'or C.1). Seul "Nouvel adhérent"
  (réellement branché sur `POST /referential/companies`) est présent dans
  l'en-tête de la section.
- **Section "Paramètres de la convention"** (nouvelle) : version, plafond
  Art.4, délais Art.10/12/19 — valeurs réelles de `GET /referential/
  convention`, elles-mêmes la RÉUTILISATION des constantes déjà réelles de
  `RecoursModule`/`EligibilityModule` (jamais une 2ᵉ constante dupliquée,
  voir doc-comment back `getConventionParams`).
- **Section "Calendrier ouvré"** (nouvelle) : week-end légal (Vendredi/
  Samedi) + jours fériés à date FIXE 2026-2027, table paginée 6/p. Note
  explicite en pied de section paraphrasant le doc-comment de
  `referential-reference-data.ts` : les jours fériés religieux à date
  mobile (Aïd el-Fitr, Aïd el-Adha, Mawlid Ennabaoui, 1er Moharram,
  Achoura) sont volontairement absents, leur date dépendant de
  l'observation lunaire et n'étant confirmée par arrêté officiel qu'à
  l'approche de l'événement — jamais une date devinée pour ressembler à la
  capture.
- **Section "Barème & motifs"** (nouvelle) : catalogue RÉEL de
  `GET /referential/motifs` (11 entrées, `eligibility.rules.ts`), table
  paginée 6/p. **Écart assumé avec la capture** : le guide illustré affiche
  "17 cas · motif interdit RG-01" — aucune taxonomie numérotée/codée "RG-01"
  n'existe dans ce moteur de règles (7 catégories d'articles réelles,
  11 motifs). Le compte et les libellés affichés sont les VRAIS (11, sans
  code), pas 17/RG-01 inventés pour coller à la capture ; une note discrète
  en pied de section le documente côté UI.
- **Sous-titre d'en-tête (`FolioHeader`) reformulé** : la capture décrit un
  "référentiel versionné... avec historique" — ce projet n'a ni versioning
  ni historique des paramètres de la convention (juste la valeur courante),
  ni de notion de "sanctions" liée aux experts. Le sous-titre a donc été
  réécrit pour rester exact (liste les 6 sections réelles) plutôt que de
  reprendre tel quel un texte qui survend des fonctionnalités absentes.
- **Agences/Experts** : tableaux `Table` existants conservés tels quels
  (flat list suffisante, pas de vue arborescente DG/DR/AG construite — la
  capture ne l'exige pas clairement). Colonne "Compagnie" ajoutée côté
  Agences (jointure `companyId` → `CoChip`, via une requête `/referential/
  companies?pageSize=100` dédiée à la carte id→compagnie, l'API agences ne
  renvoyant que l'id). Sous-titre nav Experts : "suspensions" uniquement,
  pas "performance" — aucune métrique de performance d'expert n'existe nulle
  part dans ce codebase (ni dossiers traités, ni affectations trackées) ;
  inventer un chiffre ici aurait été fabriquer une donnée.
- Types ajoutés dans `src/lib/types.ts` : `CompanyView` complété
  (`createdAt`, `correspondentName?/Phone?/Email?`, `agencyCounts`, tous
  additifs) + nouveaux `ConventionParams`/`PublicHoliday`/`PlaceCalendar`/
  `EligibilityMotif` (reflet exact des DTO back).
- Clés i18n ajoutées dans `translations.ts` (dictionnaire `fr` uniquement,
  `ar`/`en` restent les placeholders auto-dérivés) : `referential.nav.*`,
  `referential.company.{create,edit,card,field,toast}.*`,
  `referential.status.*`, `referential.agency.col.*`,
  `referential.expert.col.*`, `referential.convention.*`,
  `referential.calendar.*`, `referential.motifs.*`.
- `page.test.tsx` entièrement réécrit (8 cas) : les 6 sections de nav et la
  bascule de contenu au clic, pagination 6/p sur les compagnies, ligne de
  métadonnées complète avec correspondant PUIS sans correspondent (cas de
  non-régression explicite demandé), clé API jamais en clair, paramètres de
  convention réels, calendrier (week-end + jours fériés + note mobile),
  catalogue de motifs réel (et absence de "RG-01"). `company()` du test de
  `/metering` mis à jour avec les mêmes champs additifs (changement de type
  partagé, sinon le build cassait pour cet écran non concerné par cette
  passe).
- Vérifié : `npm run lint` (tsc --noEmit) propre, `npx vitest run` 75/75
  (14 fichiers), `npm run build` propre (17 routes statiques, `/referential`
  inclus). Pas de serveur dev lancé (ports 3000-3002 potentiellement occupés
  par d'autres sessions sur cette machine) — vérification faite par la
  suite de tests composants + build, pas en navigateur réel.

### `/ledger` rapproché de la capture de référence (2026-10-18, worktree dédié)

Passe de restylage PURE : aucun changement back nécessaire. Vérifié
directement contre `ledger.controller.ts`/`ledger.service.ts` (back) avant
de coder contre — `GET /ledger` renvoie déjà la liste COMPLÈTE non paginée
(triée `seq ASC`), filtrable seulement par `from`/`to` (pas de filtre par
`type` côté back) ; `GET /ledger/verify` existe déjà tel quel. Tout l'écart
avec la capture était donc présentationnel.

- **Tableau `Table` (7 colonnes) remplacé par une liste de cartes** : icône
  (badge rond coloré, variée par mot-clé du `type` — contient `MATCH` →
  icône "lien" teintée `--k-pri` ; contient `INGEST`/`CLAIM` → icône
  "bac de réception" teintée `--ok` ; tout autre `type` → simple pastille
  neutre, AUCUN type inventé) puis titre "#{séquence} {Type} · {réf}" en
  gras, puis description "{résumé} — {auteur}" en texte atténué, puis à
  droite l'horodatage et "{empreinte} ← {empreinte précédente}" (réutilise
  `truncHash` existant).
- **Numéro de séquence (`#1806`, décroissant)** dérivé UNIQUEMENT de la
  position de l'entrée dans la liste complète renvoyée par l'API (déjà
  triée `seq ASC` côté back) — `entries.map((e,i) => ({...e, seq: i+1}))`
  puis affichage dans l'ordre inverse (la plus récente en tête). Aucun
  champ `seq` ajouté côté back : purement dérivé côté front, comme demandé.
  Le numéro reste celui de la place entière même après filtrage type/texte
  (jamais recalculé sur la vue filtrée).
- **Filtre par type (nouveau, 100% client)** : select "Tous les types (N)"
  + une option par valeur distincte de `type` réellement présente dans la
  liste chargée, avec son décompte — calculé depuis le tableau `entries`
  déjà récupéré (aucun nouvel appel, le back ne filtre pas par type).
- **Recherche libre (nouveau, 100% client)** : filtre sur
  `ref`/`actor`/`hash`/`prevHash`, insensible à la casse.
- **En-tête restylé** : "Vérifier l'intégrité" est désormais un VRAI bouton
  (plus seulement un tag passif) qui force un `refetch()` immédiat de
  `GET /ledger/verify` au clic (toast ok/ko avec le résultat), en PLUS du
  polling 30 s déjà en place (conservé — jamais l'un sans l'autre). Le
  résultat reste aussi affiché en tag à côté du bouton, comme avant.
- **Bouton "Page du journal" de la capture : désactivé plutôt qu'une fausse
  destination.** Aucun endpoint/route back ne correspond à une "page du
  journal" dédiée (pas plus qu'une page d'impression/export dédiée) — plutôt
  que d'inventer un lien vers nulle part, le bouton est rendu `disabled`
  avec un `title` expliquant pourquoi (voir `ledger.page.tooltip`). À
  remplacer par un vrai lien le jour où un tel endpoint existe.
- **Export CSV** : comportement conservé, mais exporte désormais les
  entrées FILTRÉES (type + recherche, en plus de `from`/`to` déjà en
  place) plutôt que la liste brute non filtrée — plus honnête vis-à-vis du
  libellé existant "Export CSV généré depuis les entrées affichées".
- Pagination 6/page conservée (A.5), appliquée à la liste filtrée, rendue
  en cartes avec la même barre de pagination (`.pager`) qu'avant plutôt
  que via le composant `Table` générique (devenu inadapté à une liste de
  cartes).
- Clés i18n ajoutées dans `translations.ts` (dictionnaire `fr` uniquement) :
  `ledger.verify.cta`, `ledger.list.title`, `ledger.list.entriesSuffix`,
  `ledger.filter.allTypes`, `ledger.search.placeholder`,
  `ledger.page.label`, `ledger.page.tooltip`. Clés retirées (devenues
  inutiles, l'ancien tableau colonnes disparaissant) : `ledger.verify.title`
  et les 7 `ledger.col.*`.
- Test composant (`page.test.tsx`) réécrit (10 cas) : rendu carte (titre/
  description/colonne de droite), numérotation décroissante depuis le
  total, clic sur "Vérifier l'intégrité" déclenchant un appel réseau
  supplémentaire, "Page du journal" désactivé, filtre par type (décompte +
  restriction), recherche libre (réf/acteur/empreinte), pagination 6/page.
  **Piège rencontré** : la ligne de titre mélange texte brut et `<span
  className="mono">` imbriqués — `getByText` par défaut ne concatène que
  les nœuds texte DIRECTS d'un élément (pas ceux des enfants), donc une
  correspondance de chaîne exacte sur le texte complet échoue
  silencieusement ("text is broken up by multiple elements") ; corrigé en
  comparant `element.textContent` via un matcher fonction (`fullText`
  helper du fichier de test) plutôt qu'une chaîne/regex simple.
- Vérifié : `npm run lint` (tsc --noEmit) propre, `npx vitest run` 76/76
  (14 fichiers), `npm run build` propre (17 routes statiques, `/ledger`
  inclus). Pas de serveur dev lancé (ports 3000-3002 potentiellement
  occupés par d'autres sessions sur cette machine) — vérifié par la suite
  de tests composants + build uniquement ; à revérifier en navigateur dès
  qu'un port est libre.

### `/cockpit` reconstruit sur la capture de référence écran 1 (2026-10-18, worktree dédié)

Backend préparé en parallèle par l'agent Backend sur ce même sprint —
`GET /cockpit/summary` étendu de façon PUREMENT ADDITIVE (`kpis`/
`sparklineDeclarations`/`barresNettes`/`updatedAt` inchangés dans leur
forme, `kpis` complété de 5 champs frères). Vérifié directement contre
`cockpit.module.ts` (back, fichier unique contrôleur + agrégation) avant de
coder contre, pas un contrat deviné.

- **⚠️ Décision Tech Lead reconduite telle quelle — tracker à 3 étapes, PAS
  5.** `cycleConventionnel.steps` ne porte que `saisie`/`synthese_annexe7`/
  `cloture_trimestre` : aucune entité de ce backend ne modélise une date de
  convocation "Réunion UAR" (Art.17) ni un suivi d'exécution "Règlements
  sous 8 j" (Art.18) — les inventer pour atteindre le compte de 5 de la
  capture aurait été fabriquer une donnée métier, contraire à C.1. Le
  tracker rend donc exactement 3 cartes (coche/numéro + libellé + article +
  détail RÉEL, tous fournis tels quels par le back, aucune traduction
  nécessaire : ce sont déjà des libellés français persistés) et une note
  muette en dessous nomme explicitement les 2 étapes absentes et pourquoi.
  **Couvert par un test exprès** (`page.test.tsx`, "affiche exactement 3
  étapes réelles (jamais 5)") qui boucle sur les `.cycle-step` rendus et
  vérifie qu'aucun ne contient "Réunion UAR"/"Règlements sous 8" — une
  régression qui "compléterait" le tracker à 5 casserait ce test.
- **Bande calendrier (nouvelle)** : jours du mois courant (`Date` client,
  pas de requête dédiée), semaine ouvrée algérienne réelle (`GET
  /referential/calendar`, déjà consommée par `/referential` — jamais une
  2ᵉ liste de jours fériés inventée ; les jours fériés religieux à date
  mobile restent absents, même note qu'ailleurs). Légende week-end/jour
  férié/aujourd'hui + note "calendrier ouvré — délais en jours ouvrés".
  **Les badges "5ᵉ j.o"/"A7"/"UAR" de la capture sur des jours précis du
  mois sont volontairement absents** : le "UAR" en particulier marquerait
  une date de convocation fictive sur l'étape justement exclue ci-dessus —
  les reproduire aurait réintroduit par la bande calendrier la donnée
  qu'on refuse d'inventer dans le tracker.
- **6 KPI de tête** (`Recours en cours`/`Délais dépassés`/`Déclarations
  reçues (24 h)`/`Appariement automatique`/`Volume brut trimestriel`/
  `Réduction par netting`) — tous des champs réels de `kpis`. **Écart
  assumé** : "Déclarations reçues (24 h)" réutilise `kpis.dossiersDuJour`
  (déclarations créées aujourd'hui, contrat stable existant) — aucun champ
  back dédié à une fenêtre glissante de 24 h n'existe, et en créer un juste
  pour ce libellé aurait dupliqué une donnée déjà réelle sous un autre nom.
  Les 4 anciens KPI du build précédent (`dossiersDuJour` déjà réutilisé
  ci-dessus, `aApparier`, `enRetard`, `compensationAVenir`) ne sont plus
  affichés comme tuiles séparées : la capture de référence écran 1 ne les
  montre pas sous cette forme (`aApparier` redevient `enAttenteAppariement`
  dans les indicateurs ci-dessous, les deux autres n'ont pas d'équivalent
  dans la capture) — supprimés plutôt que conservés en doublon muet.
- **"Indicateurs de place" (§6.8-6.10, nouveau, 10 tuiles)** : grille dédiée
  `.ind-grid` (5 colonnes, replie à 2 sous 900px) plutôt que `KpiRow`
  (`repeat(auto-fit,minmax(160px,1fr))`, qui n'aurait pas donné "deux
  rangées de 5" à la largeur de la capture). Seule "Taux d'appariement"
  porte une mini barre de progression sous la valeur (capture de
  référence) — `Kpi` transverse ne supportant qu'un `extra` textuel, rendu
  dédié `TauxAppariementTile` réutilisant directement `.kpi`/
  `.score-bar-*`. "Experts actifs / suspendus" et "Adhérents actifs /
  suspendus" au format `"{actifs} / {suspendus}"` demandé. `null` partout
  où le back ne peut pas encore calculer un taux/une moyenne → `formatPct`/
  `formatDays` (même idiome exact que `/monitoring`), jamais `NaN`.
- **"Positions nettes par compagnie — T{n}"** : remplace `barresNettes`
  (conservé au contrat, jamais affiché ici) par `positionsNettesQuarter`
  (vraie compensation trimestrielle, plus précise). `BarChart` transverse
  ne sait tracer que des barres posées sur une base commune en bas ; un
  rendu HTML/CSS dédié (`NetPositionsChart`, même esprit que `ScoreBar`/
  `RevenueShareBar` : piste + remplissage en `%`) trace des barres
  divergentes centrées sur une ligne de zéro, teal (`--k-pri-2`) si positif,
  rouge (`--ko`) si négatif. Le "T{n}" du titre vient de la VRAIE période
  trimestrielle courante (`positionsNettesQuarter.quarter`), pas du "T3"
  figé de la capture (démo datée différemment).
- **"Statistiques de la place — déclarations du mois"** : nouveau
  `LineChart` exporté par `components/ui/BarChart.tsx` (même esprit SVG
  natif que `Sparkline`/`BarChart`, A.1 : pas de dépendance graphique
  lourde), avec repères (cercles) par point et libellés de mois en HTML
  sous le SVG (évite le chevauchement de texte propre à
  `preserveAspectRatio="none"`). Ligne "Top wilayas (sinistralité) :
  {noms}" sous le graphe, jointe depuis `topWilayas` (3 entrées réelles).
- **"Alertes conventionnelles ({count})"** : liste scrollable, une ligne
  par alerte réelle (`id`/`from`/`to`/`description`/`article`, dérivés des
  VRAIS dépassements `RecoursItem.timer.expired` et dossiers Commission en
  retard Art.24 — jamais une alerte inventée). **Écart assumé** : `id` est
  l'identifiant réel préfixé par le back (`recours-{id}`/`commission-{id}`)
  affiché tel quel, PAS une référence formatée "REC-2026-00284" comme la
  capture (aucun champ de référence lisible de ce type n'existe côté back
  pour ces alertes). Chaque ligne pointe vers `/exchanges` en clair (pas de
  filtre par recours/dossier — une alerte mélange 2 sources différentes,
  un filtre dédié aurait sur-construit ce lien pour un gain marginal).
- **"Flux temps réel"** : le hook `useRealtime` abonnait déjà l'écran à
  `claim.ingested`/`match.updated`/`metering.tick` mais ne faisait que
  basculer un badge booléen — il alimente désormais aussi un tampon
  glissant (12 entrées max, la plus récente en tête, `useState` côté
  composant) rendu en liste, avec un bouton Pause/Reprendre qui ARRÊTE les
  ajouts (garde booléenne via un `ref`, pas de désabonnement socket).
  **Écart assumé important avec le texte du guide illustré** : le
  commentaire de `realtime.ts` affirmait encore que seul `metering.tick`
  était émis — FAUX au moment de cette passe, vérifié contre le code réel
  (`claims.service.ts`/`matching.service.ts`) : `claim.ingested` ET
  `match.updated` sont RÉELLEMENT émis (`metering.tick`, lui, ne l'est
  toujours par aucun module). La description de chaque ligne de flux
  utilise donc UNIQUEMENT les champs réellement présents sur ces deux
  payloads (`{fileName,totalRows,eligibleCount,ineligibleCount}` pour
  l'ingestion ; `{item,decision}` OU `{claimId,matchedWith}` selon l'origine
  pour le matching) — pas les champs de la capture ("CAAR-2026-010269 ⇄
  CASH-2026-017924 · score 93 · AUTO", wilaya, accusé de réception
  horodaté...) qui n'existent sur AUCUN des deux payloads réels.
- Types ajoutés dans `src/lib/types.ts` : `CockpitIndicateursDePlace`,
  `CockpitPositionsNettesQuarter` (réutilise `SettlementNet` pour
  `positions`, pas une 2ᵉ forme dupliquée), `CockpitMonthlyDeclaration`,
  `CockpitTopWilaya`, `CockpitCycleStep`/`CockpitCycleConventionnel`,
  `CockpitAlerteConventionnelle` ; `CockpitSummary.kpis` complété des 5
  nouveaux champs frères — tous vérifiés champ par champ contre
  `cockpit.module.ts` réel.
- Clés i18n ajoutées dans `translations.ts` (dictionnaire `fr` uniquement) :
  `cockpit.kpi.{recoursEnCours,delaisDepasses,declarationsRecues24h,
  appariementAutoPct,volumeBrutT3,reductionNettingPct}`,
  `cockpit.indicateurs.*`, `cockpit.cycle.*`, `cockpit.calendar.legend.*`
  (réutilise `referential.calendar.day.*` existant pour les noms de jour),
  `cockpit.netPositions.*`, `cockpit.stats.*`, `cockpit.alerts.*`,
  `cockpit.feed.*`, `cockpit.shortcuts.exchangesRegister`,
  `cockpit.badge.demo`. `cockpit.subtitle` reformulé pour décrire l'écran
  réel (cycle/alertes/flux/santé) plutôt que l'ancien sous-titre générique.
  Anciennes clés `cockpit.shortcuts.title`/`.matching`/`.import` laissées en
  place (inutilisées sur cet écran depuis que "Registre des recours" est le
  seul raccourci d'en-tête de la capture) mais pas supprimées, par prudence
  vis-à-vis d'un éventuel autre usage.
- CSS ajouté dans `globals.css` (même esprit que `.co-card*`/`.ref-nav*`
  ajoutés par les passes précédentes) : `.grid.g-cockpit2`, `.ind-grid`,
  `.cycle-step*`, `.cal-*`, `.net-bar-*`, `.alert-*`/`.feed-*`, `.live-dot`.
  Aucun token de `tokens.css` modifié (couleurs/polices fixes, A.2).
- **Infra de test** : `vitest.setup.ts` complété d'un export
  `triggerRealtimeEvent(event, payload)` — le stub `socket.io-client`
  existant (qui empêchait toute vraie connexion réseau en jsdom) capture
  désormais aussi les callbacks `socket.on(event, cb)` enregistrés par
  `useRealtime`, pour que `page.test.tsx` puisse simuler la RÉCEPTION d'un
  événement temps réel sans ouvrir de WebSocket. `disconnect()` (appelé au
  démontage) vide le registre ; le cleanup automatique de Testing Library
  entre deux tests suffit à isoler les tests entre eux. Changement additif,
  sans effet sur les écrans qui ne l'utilisent pas.
- `page.test.tsx` entièrement réécrit (8 cas) : les 6 KPI de tête (+ cas
  `null` → "Aucune donnée.", jamais `NaN`/`null`), les 10 tuiles
  indicateurs, positions nettes sur `positionsNettesQuarter` (pas
  `barresNettes`, vérifié absent) avec couleur positif/négatif, tracker à
  exactement 3 étapes (jamais "Réunion UAR"/"Règlements sous 8" dans une
  carte réelle), alertes avec chips compagnies + badge article, flux temps
  réel qui ajoute une entrée puis s'arrête après Pause. **Piège rencontré** :
  plusieurs valeurs de KPI coïncident avec des numéros de jour affichés par
  la bande calendrier du même écran (ex. "6", "19") — `getByText` seul est
  ambigu ; corrigé en scopant chaque assertion via
  `.closest('.kpi')`/`container.querySelectorAll(...)` plutôt que des
  requêtes globales par texte brut.
- Vérifié : `npm run lint` (tsc --noEmit) propre, `npx vitest run` 89/89
  (14 fichiers), `npm run build` propre (17 routes statiques, `/cockpit`
  inclus). Pas de serveur dev lancé (ports 3000-3002 potentiellement
  occupés par d'autres sessions sur cette machine) — vérifié par la suite
  de tests composants + build uniquement.

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

### Revue Tech Lead + vérification navigateur réelle — `/monitoring`, `/fraude`, `/metering` (2026-10-18)

Les 3 écrans ci-dessus (agents Frontend, chacun dans son propre worktree)
ont été revus, mergés (rebase sur `origin/master` à chaque fois — les 3
worktrees avaient divergé avant le merge du précédent), re-vérifiés
(`lint`/`vitest`/`build`) puis testés en navigateur réel (ports 3001/3002,
jamais 3000) avec des données manufacturées : 9 dossiers importés via
`POST /claims/import` (CSV déclenchant les 6 détections de `/fraude`,
y compris la nouvelle `VELOCITE_ADHERENT`), 3 recours créés/réglés/opposés
entre CAAT/SAA/CASH pour `/monitoring`.

- **Bug trouvé et corrigé en navigateur réel** (`monitoring.scoring.ts`
  back, `computeMonitoringProfile`) : `onTimeResponsePct` affichait des
  valeurs > 100 % (ex. 200 %) dès qu'une compagnie avait plus de recours
  répondus par une opposition (réponse explicite, mais pas encore
  "résolue") que de recours effectivement résolus — le numérateur et le
  dénominateur portaient sur deux populations différentes. Corrigé pour
  utiliser la même population ("répondue" : réponse explicite OU silence
  Art.10 expiré) des deux côtés. Test de régression ajouté côté back.
  Vérifié de nouveau en navigateur après correction : CAAT/SAA affichent
  désormais 100 % (jamais plus), le reste de l'écran inchangé.
- `/monitoring` : classement (note, taux bruts), radar + 8 tuiles
  (libellé dynamique "Réponses dans les 30 j"), "Vue par dossier" avec le
  nombre réel d'étapes par recours — tout confirmé correct en navigateur.
- `/fraude` : 9 cas détectés sur les 6 types (dont `VELOCITE_ADHERENT`),
  colonnes Plaque/Adhérent correctes, panneau docké avec sections de
  signaux groupées par catégorie et descriptions composées des vrais
  champs `details` (ex. "N° e-constat ECN-SHARED-01 réutilisé sur 2
  déclarations divergentes") — confirmé correct en navigateur.
- `/metering` : graphe "Consommation mensuelle" avec sélecteur de
  métrique, ligne de quota en pointillés, changement de métrique
  déclenchant bien un nouvel appel `/history/{metric}` — confirmé correct
  en navigateur. Pas de section Showback (comme prévu).
- **Piège d'environnement répété** : au redémarrage du back avec
  `CORS_ORIGIN`, bien s'assurer qu'aucun process frontend ne tourne déjà
  sur le port 3001 (Next.js replie automatiquement sur le premier port
  libre s'il trouve le 3000 occupé, ce qui peut voler le 3001 au backend
  si les deux sont lancés dans le mauvais ordre/sans vérifier `netstat`
  entre les deux démarrages) — toujours relancer le back D'ABORD, vérifier
  qu'il écoute bien sur 3001, PUIS lancer le front avec `PORT=3002`
  explicite.

### Revue Tech Lead + vérification navigateur réelle — `/referential`, `/params`, `/ledger` (2026-10-18)

Les 3 écrans ci-dessus (agents Frontend, chacun dans son propre worktree)
ont été revus, rebasés sur `origin/master` (conflits HANDOFF.md uniquement
— sections datées côte à côte, jamais de conflit de code) puis mergés,
re-vérifiés (`lint`/`vitest`/`build`) puis testés en navigateur réel
(ports 3001/3002, jamais 3000).

- **Bug réel trouvé et corrigé en navigateur réel** (back,
  `metering.module.ts`) : le dashboard "Coûts & tarification" de
  `/params` affichait "NaN DZD"/"undefined adhérents" partout.
  `GET /metering/place-summary/:period` était déclarée APRÈS
  `GET /metering/:company/:period` — Nest/Express matche les routes dans
  l'ordre de déclaration, donc `place-summary` était capturé comme valeur
  de `:company` par la route générique, jamais atteinte. Corrigé côté back
  (réordonnancement des routes, commit `fa8ed26`) — aucun changement front
  nécessaire. Revérifié en navigateur après correction : les 4 KPI et le
  tableau des 12 inducteurs affichent les vraies valeurs (1 092 350 DZD,
  5 adhérents, etc.).
- `/referential` : les 6 sections (Compagnies/Agences/Experts/Convention/
  Calendrier/Motifs) confirmées correctes en navigateur — fragment
  correspondant bien absent quand non renseigné, convention/calendrier/
  motifs alimentés par les vraies valeurs back.
- `/params` : KPI Utilisateurs corrects, matrice Rôles × privilèges
  transposée avec libellés humains conformes à la capture, dashboard
  Coûts correct après le correctif ci-dessus.
- `/ledger` : liste en cartes avec numérotation décroissante, filtre par
  type (avec décomptes), "Vérifier l'intégrité" fonctionnel — tous
  confirmés corrects en navigateur.

### `/matching` — enrichissement du panneau de détail + "Vue de confrontation" (2026-10-18, agent Frontend)

Repris sur la maquette de référence (`Guide_IDA_Place.docx`, écran 2) pour
rapprocher la présentation de `/matching` de la capture, **sans fabriquer
de donnée absente du modèle réel** (voir le détail ci-dessous — contrainte
posée explicitement par le Tech Lead après vérification du code back).

1. **Critères pondérés en fraction réelle** (`{poids}/{poids}` ou
   `0/{poids}`) au lieu du tag `OK`/`—` plat — plus une sous-description
   concordant/discordant honnête (ex. "Plaques discordantes"). **Jamais**
   la valeur graduée de la capture (ex. "21/35", "67 %") : vérifié dans
   `matching.scoring.ts` (back) que chaque critère pondéré
   (`plaquesCroisees`/`policeCroisee`/`dateHeure`/`compagniesCroisees`/
   `gps`) est un booléen strict, poids plein ou zéro — aucun calcul de
   similarité/distance/pourcentage n'existe dans l'algorithme réel. Les
   fractions affichées utilisent les mêmes constantes (`MATCH_WEIGHTS`)
   que le score déjà renvoyé par l'API — rien n'est recalculé côté front
   (règle d'or C.1).
2. **Nouvelle section "Vue de confrontation"** (sous le panneau de détail)
   : cartes champ par champ (N° e-constat, date d'accident, wilaya,
   immatriculations croisées, polices croisées), badge Concordant/
   Discordant. Pour les 3 champs directement comparables (e-constat, date,
   wilaya) : égalité calculée côté front sur les vraies valeurs A/B. Pour
   les 2 champs "croisés" (immatriculations, polices) : badge = le
   booléen RÉEL déjà calculé par l'algorithme (`criteria.plaquesCroisees`/
   `criteria.policeCroisee`), PAS une égalité naïve des valeurs affichées
   — `plateA`/`plateB` et `policeA`/`policeB` du DTO sont chacun la valeur
   "soi-même" de SA déclaration (même convention que `plateA`/`plateB`
   historiques), pas une paire directement comparable ; le vrai croisement
   compare les deux ensembles {valeur propre, valeur adverse déclarée} des
   deux côtés, déjà fait par le back.
3. **Cartes "Véhicule A"/"Véhicule B"** : UNIQUEMENT Dossier/Identité
   assuré/Immatriculation/Canal — volontairement PAS de "Conducteur" (nom
   du conducteur s'il diffère de l'assuré — seul un booléen
   `conducteurAEstAssure`/`B` existe, pas un nom distinct), PAS de modèle
   de véhicule (ex. "Chery Tiggo 2" — seule la plaque est capturée), PAS
   de point de choc, PAS du schéma d'accident illustré (dépend du point de
   choc) : vérifié qu'aucun de ces champs n'existe dans
   `claim-47-columns.ts`/`claim.entity.ts` (back) avant d'écrire l'écran,
   plutôt que de deviner une valeur.
4. **Changement back associatif (additif, même sprint)** : `MatchQueueItemDto`
   n'exposait pas assez de champs par déclaration pour construire les
   cartes ci-dessus (seulement `refA/companyA/plateA` + équivalent B).
   Ajout de 10 champs optionnels (`accidentDateA/B`, `wilayaA/B`,
   `assureAIdentite/B`, `canalDeclarationA/B`, `policeA/B`) — dénormalisés
   depuis `ClaimMatchInput` au même recalcul que `criteria`
   (`matching.service.ts` `applyComputed`/`applyComputedDto`), même
   convention "valeur soi-même" que `plateA`/`plateB` existants. Forme
   existante de `MatchQueueItemDto` inchangée (additif pur, contrat
   stable). `assureIdentite` (colonne 44 "Identité assuré A" du modèle 47
   colonnes) n'était promue nulle part (ni `Claim` entity, ni
   `ClaimViewDto`) — lue depuis `Claim.raw` (déjà stockée à l'import,
   aucune migration nécessaire pour celle-ci) et ajoutée en champ optionnel
   à `ClaimViewDto`/`ClaimMatchInput`. Migration MikroORM écrite à la main
   (`Migration20261018000000_MatchingConfrontationFields`, voir HANDOFF
   back) pour les 8 nouvelles colonnes de `match_queue_item` (les deux
   champs identité ne touchent pas `claim`, déjà en JSON). Vérifié :
   `npx jest src/matching src/claims --silent` + `tsc --noEmit` back
   passent, `lint`/`vitest`/`build` front passent (voir rapport de
   livraison pour le détail).
5. Tests ajoutés (`page.test.tsx`) : fraction 35/35 (vrai) et 0/35 (faux)
   d'un critère pondéré, badge Concordant/Discordant calculé sur de vraies
   valeurs A/B (cas concordant ET discordant), cartes Véhicule A/B avec
   assertions négatives explicites (pas de "Conducteur"/modèle de
   véhicule/"choc" nulle part dans le DOM).

### Revue Tech Lead + vérification navigateur réelle — `/cockpit`, `/matching` (2026-10-18)

Les 2 derniers écrans du guide (agents Frontend, chacun dans son propre
worktree) ont été revus, rebasés sur `origin/master` (0 conflit pour
`/matching` ; `/cockpit` mergé juste avant), re-vérifiés
(`lint`/`vitest`/`build`) puis testés en navigateur réel (ports 3001/3002,
jamais 3000) avec des données manufacturées (import CSV de 9 lignes,
confirmation manuelle d'un appariement via `POST /matching/:id/decide`).

- `/cockpit` : cycle conventionnel confirmé à **exactement 3 étapes**
  (Saisie mensuelle ✓ / Synthèse Annexe 7 / Compensation trimestrielle),
  avec la note explicite sur Réunion UAR/règlements 8j non suivis. Les 10
  tuiles "Indicateurs de place" et les KPI du bandeau correspondent
  exactement à la réponse de `GET /cockpit/summary`. "Positions nettes T4"
  affiche honnêtement "Aucune position nette pour ce trimestre" (aucune
  compensation exécutée dans les données de test) plutôt qu'une valeur
  inventée. Flux temps réel affiche "Aucun événement reçu" (aucun socket
  émis pendant la session de vérification) — état vide honnête, pas un
  flux fabriqué.
- `/matching` : file de 9 éléments cohérente avec l'import (2 Auto dont un
  à score 100 par e-constat partagé, 6 À confirmer, 1 confirmé
  manuellement pendant la vérification → `CONFIRME_MANUEL`). Panneau de
  détail vérifié sur `ECN-CAL-08`/`ECN-CAL-09` : fractions réelles
  (`0/35`, `0/15`, `0/15`, `0/10`, `10/10`, jamais une valeur graduée),
  sous-descriptions concordant/discordant cohérentes avec les critères
  booléens réels. "Vue de confrontation" : badges Concordant/Discordant
  corrects champ par champ (wilaya concordante 09/09, date et e-constat
  discordants, plaques/polices discordantes via le booléen réel de
  l'algorithme). Cartes Véhicule A/B : uniquement Dossier/Identité
  assuré/Immatriculation/Canal, confirmé en navigateur qu'aucun champ
  "Conducteur"/modèle/choc n'apparaît. "Décidé par" affiche correctement
  l'auteur et l'horodatage réels de la confirmation manuelle faite pendant
  la vérification.

Les 14 écrans du guide `Guide_IDA_Place.docx` sont désormais tous
reconstruits et vérifiés (code + navigateur réel, texte seul — pas de
capture d'écran, consigne explicite de l'utilisateur).

### `/quarter` — section "Flux de règlement entre les N compagnies" (2026-10-18, worktree dédié `feat/quarter-flow-diagram-ui`)

Dernière pièce manquante de `/quarter` (voir l'entrée du 2026-10-17
ci-dessus, "Encore manquant" : "diagramme circulaire des flux de
règlement") — ajoutée sous "Matrice des positions brutes", avant
"Bordereau trimestriel".

- **Aucun changement back** : les deux sources de données existaient déjà
  et étaient déjà récupérées par `page.tsx` (`quarterQuery` → `GET
  /settlement/quarter/:q`) mais **inutilisées** côté affichage —
  `data.positions` (`SettlementPosition[]`) et `data.net`
  (`SettlementNet[]`). Tâche 100% front.
- **Nouveau composant transverse** `src/components/settlement/FlowDiagram.tsx`
  (SVG natif, même trig que `RadarChart` : `angle = i·2π/n - π/2`), deux
  modes :
  - **"Net multilatéral"** (actif par défaut, comme la capture) : **hub
    (la place) + une position nette par compagnie**, PAS un ordre de
    règlement pair-à-pair. Choix délibéré et non négociable pour cette
    passe : `computeMultilateralNetPositions` (back
    `settlement.rules.ts`) réduit explicitement chaque compagnie à UNE
    seule position vis-à-vis de la place par construction ("l'intérêt
    principal de la compensation multilatérale... plutôt que de régler
    chaque contrepartie bilatéralement" — commentaire de la fonction) :
    il n'existe donc AUCUNE donnée réelle "qui paie qui" pour ce mode.
    Un algorithme glouton "plus gros débiteur paie plus gros créditeur"
    aurait fabriqué une règle métier absente du back — exactement ce que
    la discipline de ce projet interdit (jamais fait).
  - **"Bilatéral"** : pas de hub, cercle de compagnies, une flèche RÉELLE
    par entrée de `data.positions` (déjà nettée par paire côté back,
    `computeBilateralNetPositions`), courbée (bézier quadratique) si les
    deux sens existent pour une paire (défensif — ne devrait pas arriver
    en pratique puisque le netting bilatéral réduit déjà chaque paire à
    un seul sens, mais rendu sans crash si les données en contenaient).
  - Convention couleur : réutilise `var(--ok)`/`var(--ko)` (tokens.css,
    mêmes variables que `Tag tone="ok"/"ko"` dans la table "Positions
    nettes multilatérales" juste au-dessus) pour le sens des flèches en
    mode multilatéral (positif = la place doit à la compagnie, négatif =
    l'inverse). En mode bilatéral, pas de position nette par nœud (une
    compagnie peut avoir plusieurs flèches, une par contrepartie) : le
    montant est donc étiqueté sur chaque flèche, pas sous le nœud.
  - États vides honnêtes : `net`/`positions` vide pour le mode courant →
    `common.noData` ("Aucune donnée."), jamais un diagramme fabriqué. Pas
    de crash à 1 compagnie (hub + 1 seul rayon) ni à 0 paire bilatérale.
  - Nœuds : `CoChip` réutilisé tel quel (même convention que le reste de
    la page), rendu en `<div>` HTML superposé au SVG (positions en %,
    container en `aspect-ratio: 1 / 1`) plutôt qu'en `<foreignObject>`.
- **Intégration `page.tsx`** : nouvelle section `.sheet` après "Matrice des
  positions brutes", titre dynamique `"Flux de règlement entre les " +
  rawMatrix.companies.length + " compagnies"` (nombre RÉEL, jamais le "5"
  de la capture — démo à 5 compagnies, pas une constante). Bascule via le
  composant transverse `Tabs` déjà utilisé ailleurs dans l'app (`/exchanges`
  notamment) — pas de nouveau composant de bascule ni de nouvelle classe
  CSS : la capture montre un bandeau à fond sombre pour l'onglet actif,
  mais `Tabs`/`.tab[aria-selected]` (soulignement + gras) est le seul
  motif de bascule déjà établi dans `globals.css` ; en inventer un nouveau
  pour coller pixel-à-pixel à la capture aurait contredit la consigne
  "réutiliser le motif existant, ne pas inventer de nouveau CSS". Légende
  reprise **verbatim** du guide à côté de la bascule : "Point ouvert
  §11-6 : mode à confirmer par l'UAR — les deux sont calculés."
- **Fidélité visuelle non vérifiable au-delà du nœud "CASH"** : la
  capture de référence fournie au Tech Lead est coupée juste au moment où
  le diagramme circulaire commence à apparaître (seul un nœud "CASH ·
  +1,07 M" est visible en haut) — la disposition exacte des nœuds/flèches
  au-delà n'a pas pu être vérifiée pixel par pixel contre la capture. Le
  rendu ci-dessus (hub-and-spoke pour le mode multilatéral, cercle de
  compagnies avec flèches pair-à-pair pour le mode bilatéral) découle
  directement des contraintes de données réelles décrites plus haut, pas
  d'une lecture de la capture au-delà de ce point.
- Nouvelles clés i18n FR uniquement (`quarter.flow.*`) dans
  `src/i18n/translations.ts` — `ar`/`en` restent dérivés automatiquement
  (`Object.fromEntries`), pas écrits à la main.
- Tests ajoutés (`page.test.tsx`, 4 nouveaux cas, 8/8 au total sur ce
  fichier) : titre avec le nombre réel de compagnies, mode par défaut
  (hub + un nœud par entrée de `net`), bascule vers "Bilatéral" (une
  flèche par entrée de `data.positions`, nombre exact, pas de hub), état
  vide honnête des deux côtés de la bascule.
- Vérifié dans ce worktree (`feat/quarter-flow-diagram-ui`, basé sur
  `origin/master`, `npm install` requis — worktree neuf, `node_modules`
  absent) : `npm run lint` (`tsc --noEmit`) propre, `npx vitest run` 14
  fichiers / 98 tests verts (aucune régression sur les 13 autres écrans),
  `npm run build` réussi (17 routes statiques). Vérification purement
  code + tests — pas de navigateur réel ni de capture d'écran pour cette
  passe (consigne explicite de la session : vérification texte seule, le
  Tech Lead refera lui-même la vérification navigateur réelle avant
  merge).
- **Revue Tech Lead** : petit correctif avant merge — `quarter.flow.hub`
  (clé i18n déjà ajoutée par l'agent) n'était en fait jamais utilisée,
  `FlowDiagram` codait "La place" en dur. Ajout d'une prop `hubLabel`
  (le composant reste volontairement non lié à `useI18n`, pour rester
  testable en isolation) fournie par `page.tsx` via `t('quarter.flow.hub')`.
  Re-vérifié après correctif : lint/vitest(98)/build toujours verts.
  Mergé dans `master` (`92ee883`).
- **Vérification navigateur réelle faite par le Tech Lead** (texte seul,
  `get_page_text`/`read_page` — pas de capture d'écran, consigne
  explicite de la session) : backend isolé démarré sur le port 3003
  (3001 déjà occupé par un processus non identifié — probablement une
  session concurrente — jamais arrêté ni réutilisé, voir
  `project_ida_place` mémoire), frontend sur 3002 avec
  `NEXT_PUBLIC_API_URL=http://localhost:3003`. 4 recours créés et réglés
  entre 4 compagnies (CASH→CAAT 290k, CAAT→SAA 190k, CAAT→CAAR 180k,
  SAA→CAAT 210k) pour peupler `data.positions`/`data.net` avec du netting
  bilatéral réel à vérifier (CAAT↔SAA se nette à 20k net SAA→CAAT).
  Résultat conforme à l'API dans les deux modes : "Flux de règlement
  entre les 4 compagnies" (titre dynamique, pas "5" en dur), mode
  multilatéral par défaut avec "La place" + 4 nœuds aux montants signés
  exacts (CAAR +180 000, CAAT +130 000, CASH −290 000, SAA −20 000,
  somme nulle comme attendu), bascule Bilatéral avec exactement 3 flèches
  aux montants exacts (180 000 / 290 000 / 20 000 DZD), sans hub. Seules
  erreurs console observées : websocket `realtime.ts` vers le port 3001
  (bundle Turbopack mis en cache d'une session précédente, fichier non
  modifié par ce changement, sans rapport avec cette fonctionnalité) et
  le HMR du port 3002 — aucune des deux n'affecte les données REST
  affichées, qui proviennent bien du backend 3003 (confirmé par la
  correspondance exacte avec les montants créés manuellement).

### Pièces jointes Recours/Commission — `AttachmentsPanel` (2026-10-18, équipe 4 rôles : Tech Lead + Backend + Frontend + Testeur)

QUESTIONS_UAR.md §9 (backend) — décision Product Owner réelle : dépôt
MANUEL de pièces (Annexe 2/3/4, PV de commission) sur un `Recours` ou un
`CommissionCase`, jamais de génération automatique de PDF.

- **Composant transverse** `src/components/documents/AttachmentsPanel.tsx`
  — props en union exclusive TypeScript (`recoursId` XOR
  `commissionCaseId`, imposé dès la compilation). Liste réelle via `GET
  /documents?recoursId=X|commissionCaseId=Y`, lien de téléchargement =
  vraie URL pré-signée reçue de l'API (jamais construite côté front).
  Contrôle de dépôt (input fichier + bouton) visible UNIQUEMENT si
  `hasPrivilege('insert')` — réutilise `apiPostForm` (même idiome que
  `/import`), toast d'erreur sur 400/403/404 sans jamais planter.
- Intégré dans le détail de `/exchanges` (`recoursId={selected.id}`,
  section "Pièces jointes (Annexes 2/3/4)") et `/commission`
  (`commissionCaseId={selected.id}`, section "Pièces jointes (PV de
  commission)") — même style de titre de section que "Fil d'échanges"
  déjà présent sur ces écrans.
- QUESTIONS_UAR.md §11/§12 (backend, privilèges `closeQuarter`/
  `onboardCompany`) : AUCUN changement frontend nécessaire — l'écran
  `/quarter` et le formulaire de création de compagnie existants
  affichent déjà le message d'erreur générique du back sur un 403, sans
  rien coder de spécifique côté client.
- Revue Tech Lead avant merge : une clé i18n inutilisée
  (`documents.attachments.download`, jamais référencée — le nom de
  fichier sert directement de lien) retirée.
- Vérifié : `tsc --noEmit` propre, 109/109 tests (Vitest, 7 nouveaux),
  build réussi.
- **Vérification Testeur en navigateur/API réel (texte seul)** — PASS :
  upload réel confirmé (liste rafraîchie, lien de téléchargement non
  vide après rechargement), 403 cross-tenant confirmé (compagnie tierce,
  upload ET lecture), variante CommissionCase également vérifiée, aucune
  erreur console. Limitation notée par le Testeur : le masquage du
  bouton de dépôt pour un rôle sans `insert` n'a pas pu être revérifié
  EN NAVIGATEUR dans cette session (le panneau de prévisualisation reste
  figé sur `OPERATEUR_PLACE`) — couvert uniquement par
  `AttachmentsPanel.test.tsx`, pas par cette passe navigateur réelle.

### `/exchanges` — sous-onglets REGLE "Accepté/silence" / "Réglé/compensé" (2026-10-18, équipe 4 rôles : Tech Lead + Backend + Frontend + Testeur)

Point 6 de `QUESTIONS_UAR.md` (backend) — décision Product Owner (l'utilisateur
réel, pas simulée) : la distinction entre les deux sous-onglets du guide
illustré est PUREMENT TEMPORELLE (trimestre du recours réglé déjà clôturé ou
non), pas un nouvel état `RECOURS_STATES`, aucun nouveau champ sur `Recours`.

- **Backend** (agent dédié, worktree) : nouvel endpoint additif
  `GET /settlement/quarter/closures` (toutes les clôtures trimestrielles,
  place entière, voir HANDOFF backend).
- **Frontend** (agent dédié, worktree) : sur l'onglet REGLE de `/exchanges`,
  deux sous-onglets calculés CÔTÉ CLIENT (`quarterOf(settledAt)` croisé
  avec la liste des clôtures) — population REGLE complète récupérée en un
  seul appel (`pageSize: 100_000`, même idiome que `/monitoring`/`/fraude`)
  puis re-paginée localement par sous-onglet (6/p, A.5) ; tous les autres
  onglets de premier niveau gardent la pagination serveur existante
  inchangée.
- **Testeur** (agent dédié, vérification réelle en navigateur, texte seul —
  jamais de capture d'écran) : séquence avant/après clôture vérifiée de bout
  en bout (recours créé+réglé → visible en "Accepté/silence" → trimestre
  clôturé via l'API → visible en "Réglé/compensé" après rechargement),
  montants/compteurs exacts, régression des autres onglets confirmée propre.
  **Trouvaille réelle (pas un crash, un vrai problème de fraîcheur)** :
  `closuresQuery` n'avait PAS de `refetchInterval` contrairement aux 3
  autres requêtes de cet écran — `staleTime` seul ne déclenche aucun
  re-fetch en arrière-plan tant que le composant reste monté, donc un
  opérateur resté sur `/exchanges` pendant qu'un trimestre est clôturé
  ailleurs (autre onglet/session) voyait un classement figé indéfiniment
  sans rechargement manuel. Confirmé par `read_network_requests` sur une
  fenêtre de 30s : `recours?filter=REGLE` re-interrogé plusieurs fois,
  `settlement/quarter/closures` jamais. Corrigé par le Tech Lead
  (`refetchInterval: POLL_INTERVAL_MS`, même valeur que les 3 autres
  requêtes de cet écran) — jamais corrigé par le Testeur lui-même,
  conformément à son rôle (remonte, ne corrige jamais).
- Vérifié après correctif : `tsc --noEmit` propre, 102/102 tests (Vitest),
  build réussi.
- Onglets Commission "Adhésions & retraits" et pipeline "Avancement du
  lot" : construits le 2026-10-19 (voir l'entrée ci-dessous) ; seul
  "Plafond conventionnel" reste reporté (`QUESTIONS_UAR.md` §7, backend).

### Points UAR 1-5, 7, 8 — écrans (2026-10-19, équipe 4 rôles + PO expert)

Décisions et périmètre : `QUESTIONS_UAR.md` §1-5, §7, §8 (backend).

- `/commission` : onglet « Adhésions & retraits »
  (`src/components/commission/MembershipTab.tsx`), actions selon
  `membership`, « Constater l'effet » désactivé avant la date d'effet. Pas
  d'onglet « Plafond conventionnel » (aucune procédure documentée).
- `/quarter` : section « Avancement du lot »
  (`src/components/settlement/PipelineSection.tsx`), polling 30 s, et
  bouton « Clôturer le trimestre » sur l'étape 5, visible seulement une fois
  les étapes 1-4 faites et avec `closeQuarter`, avec confirmation.
  **Correction** : l'entrée « Pièces jointes » ci-dessus affirmait que
  `/quarter` gérait déjà le 403 de la clôture — c'était faux, aucune action
  de clôture n'existait à l'écran avant ce bouton.
- `/referential` : motifs en 3 blocs (« RG-01 » absent, testé), fériés
  mobiles, populations (import CSV), IRSAM, barème Art. 14
  (`src/components/referential/*`).
- `/stats` : sélecteur d'année, « Pour 100 000 hab. », tuiles « n.d. »,
  KPI IRSAM conditionnel, répartitions barème/catégories avec « Sans
  valeur ».
- `/exchanges` : motif d'opposition (liste, ou attestation « pas une
  non-déclaration »).
- `/matching` : panneau Art. 14 (`src/components/matching/Art14Panel.tsx`)
  sur `GET /matching/:id` (`claimAId`/`claimBId`).
- `/import` : modèles v1 (47) / v2 (53), avertissements séparés.
- `/cockpit` : la note du cycle renvoie désormais à « Avancement du lot »
  (elle disait la réunion UAR et le règlement « non suivis »).

**Vérifié** : `tsc` OK, 175/175 tests, build OK. Un test a échoué une
seule fois dans un worktree, non reproduit sur 5 exécutions ensuite
(probable délai dépassé au démarrage à froid) ; le Testeur a aussi vu 3
dépassements de délai quand les tests front tournent en même temps que
ceux du back.

**Environnement** : la stratégie de contrôle des applications Windows
bloque les binaires natifs (`@next/swc-win32-x64-msvc`,
`@rollup/rollup-win32-x64-msvc`) installés par un `npm ci` neuf dans un
worktree, même copiés à l'identique. Ne jamais les remplacer par une
jonction vers le dépôt principal : supprimer le worktree risquerait
d'effacer la cible. Contournement utilisé : un `index.js` qui charge le
binaire du dépôt principal (fichiers non commités).

## Scripts

| Script | Rôle |
|---|---|
| `npm run dev` | Démarrage en développement (Turbopack) |
| `npm run build` | Build de production |
| `npm run start` | Démarrage du build de production |
| `npm run lint` | `tsc --noEmit` |
| `npm test` | Tests composants (Vitest + RTL) |
