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

## Scripts

| Script | Rôle |
|---|---|
| `npm run dev` | Démarrage en développement (Turbopack) |
| `npm run build` | Build de production |
| `npm run start` | Démarrage du build de production |
| `npm run lint` | `tsc --noEmit` |
| `npm test` | Tests composants (Vitest + RTL) |
