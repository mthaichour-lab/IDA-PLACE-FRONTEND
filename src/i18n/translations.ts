/**
 * i18n scaffold — FR / AR (RTL) / EN (A.1, C.2.5).
 *
 * Choix d'implémentation : un dictionnaire plat + un contexte React simple
 * (`I18nProvider`/`useT`), plutôt qu'une librairie lourde (`next-intl`).
 * Raison : le dossier technique suggère `next-intl` "ou équivalent" ; pour
 * ce socle, un contexte React évite la configuration de routing
 * i18n/middleware de Next.js (qui aurait complexifié l'arborescence des
 * 14 routes déjà fixées par A.4) tout en couvrant le besoin réel : piloter
 * `dir`, basculer les libellés, et laisser l'agent Frontend étoffer FR
 * complet / AR / EN progressivement. À remplacer par `next-intl` si le
 * projet a besoin de routes localisées (`/fr/...`, `/ar/...`) plus tard.
 *
 * FR = complet (toutes les clés utilisées par le socle). AR/EN = clés
 * copiées en placeholder (mêmes valeurs que FR, préfixées), à traduire par
 * l'agent Frontend.
 */
export type Locale = 'fr' | 'ar' | 'en';

export const LOCALES: Locale[] = ['fr', 'ar', 'en'];
export const RTL_LOCALES: Locale[] = ['ar'];

const fr = {
  'app.brand': 'IDA Place',
  'app.tagline': 'Plateforme de place',
  'nav.cockpit': 'Cockpit',
  'nav.matching': 'Confrontation & matching',
  'nav.import': 'Import des dossiers',
  'nav.exchanges': 'Échanges Annexes 2/3/4',
  'nav.monthly': 'Cycle mensuel',
  'nav.quarter': 'Compensation trimestrielle',
  'nav.commission': 'Commission',
  'nav.monitoring': 'Monitoring assureurs',
  'nav.fraude': 'Anti-fraude',
  'nav.metering': 'Métrologie & facturation',
  'nav.stats': 'Statistiques de la place',
  'nav.referential': 'Référentiel de place',
  'nav.ledger': 'Journal scellé',
  'nav.params': 'Paramétrage',
  'nav.more': 'Plus',
  'theme.light': 'Clair',
  'theme.dark': 'Sombre',
  'wip.title': 'Écran en construction',
  'wip.subtitle': "Cet écran sera implémenté par l'agent Frontend (voir HANDOFF.md). Aucun contenu métier n'est affiché ici tant que l'écran réel n'est pas livré.",
  'referential.title': 'Référentiel de place',
  'referential.subtitle': 'Adhérents, agences et experts enregistrés sur la place IDA.',
  'referential.tab.companies': 'Compagnies',
  'referential.tab.agencies': 'Agences',
  'referential.tab.experts': 'Experts',
  'referential.company.identity': 'Identité',
  'referential.company.code': 'Code',
  'referential.company.color': 'Couleur',
  'referential.company.feedMode': "Mode d'alimentation",
  'referential.company.apiKey': 'Clé API',
  'referential.company.status': 'Statut',
  'common.page': 'Page',
  'common.of': 'sur',
  'common.previous': 'Précédent',
  'common.next': 'Suivant',
  'common.loading': 'Chargement…',
  'common.error': 'Une erreur est survenue.',
  'common.retry': 'Réessayer',
  'common.noData': 'Aucune donnée.',
  'common.forbidden': "Vous n'avez pas le privilège requis pour cette action.",

  // ----- Cockpit (écran 1, Module I) -----
  'cockpit.title': 'Cockpit de place',
  'cockpit.subtitle': "Vue d'ensemble de l'activité de la place IDA — indicateurs, tendances et files du jour.",
  'cockpit.kpi.dossiersDuJour': 'Dossiers du jour',
  'cockpit.kpi.aApparier': 'À apparier',
  'cockpit.kpi.enRetard': 'En retard',
  'cockpit.kpi.compensationAVenir': 'Compensation à venir',
  'cockpit.sparkline.title': 'Déclarations (12 derniers jours)',
  'cockpit.barres.title': 'Positions nettes par compagnie',
  'cockpit.shortcuts.title': 'Raccourcis',
  'cockpit.shortcuts.matching': 'Ouvrir la file de confrontation',
  'cockpit.shortcuts.import': 'Importer des dossiers',
  'cockpit.updatedAt': 'Mis à jour',
  'cockpit.live.on': 'Temps réel actif',
  'cockpit.live.off': 'Mode polling (temps réel indisponible)',

  // ----- Matching (écran 2, Module A §6.3) -----
  'matching.title': 'Confrontation & matching',
  'matching.subtitle': "File des déclarations reçues, appariement A/B et score pondéré — le score et le barème sont calculés par l'API.",
  'matching.tab.tous': 'Tous',
  'matching.tab.auto': 'Auto',
  'matching.tab.aConfirmer': 'À confirmer',
  'matching.tab.nonApparies': 'Non appariés',
  'matching.col.ref': 'Réf.',
  'matching.col.partyA': 'Partie A',
  'matching.col.partyB': 'Partie B',
  'matching.col.score': 'Score',
  'matching.col.status': 'État',
  'matching.panel.title': 'Appariement',
  'matching.panel.empty': 'Sélectionnez une ligne pour voir le détail.',
  'matching.panel.criteria': 'Critères pondérés',
  'matching.panel.thresholds': 'Seuils',
  'matching.panel.auto': 'Auto',
  'matching.panel.confirm': 'À confirmer',
  'matching.panel.confrontation': 'Confrontation A / B',
  'matching.criteria.econstatPartage': 'e-constat partagé',
  'matching.criteria.plaquesCroisees': 'Plaques croisées',
  'matching.criteria.policeCroisee': 'Police croisée',
  'matching.criteria.dateHeure': 'Date / heure',
  'matching.criteria.compagniesCroisees': 'Compagnies croisées',
  'matching.criteria.gps': 'GPS',
  'matching.action.confirm': 'Confirmer',
  'matching.action.reject': 'Rejeter',
  'matching.action.complement': 'Complément',
  'matching.action.reason': 'Motif (facultatif)',
  'matching.toast.confirmed': 'Appariement confirmé.',
  'matching.toast.rejected': 'Appariement rejeté.',
  'matching.toast.complement': 'Complément demandé.',
  'matching.toast.error': "La décision n'a pas pu être enregistrée.",
  'matching.shortcuts.hint': 'Raccourcis : ↑/↓ naviguer · C confirmer · R rejeter',
  'matching.noPartyB': 'Non apparié',
  'matching.decidedBy': 'Décidé par',
  'matching.rejectReason': 'Motif du rejet',

  // ----- Import des dossiers (écran 3, Module XII) -----
  'import.title': 'Import des dossiers',
  'import.subtitle': "Téléversement du modèle 47 colonnes (Excel/CSV) — le contrôle d'éligibilité IDA est effectué par l'API, ligne à ligne.",
  'import.forbidden.title': 'Accès réservé',
  'import.forbidden.body': "Votre profil ne dispose pas du privilège d'import. Contactez un opérateur de place habilité.",
  'import.dropzone.title': 'Déposez votre fichier ici',
  'import.dropzone.subtitle': 'Format Excel/CSV, modèle 47 colonnes (B.4).',
  'import.dropzone.button': 'Choisir le fichier',
  'import.template.download': 'Télécharger le modèle (colonnes)',
  'import.template.note': 'Export CSV généré à partir des 47 colonnes du contrat (placeholder : liste des en-têtes, pas un classeur Excel mis en forme).',
  'import.uploading': 'Import en cours…',
  'import.report.title': "Rapport d'import",
  'import.report.file': 'Fichier',
  'import.report.importedAt': 'Importé le',
  'import.report.total': 'Lignes',
  'import.report.eligible': 'Éligibles IDA',
  'import.report.ineligible': 'Hors IDA',
  'import.col.row': 'Ligne',
  'import.col.verdict': 'Verdict',
  'import.col.reasons': 'Motifs',
  'import.verdict.eligible': 'Éligible IDA',
  'import.verdict.ineligible': 'Hors IDA',
  'import.journal.title': "Journal d'import (session courante)",
  'import.journal.empty': "Aucun import effectué pour l'instant dans cette session.",
  'import.toast.success': 'Import terminé.',
  'import.toast.error': "L'import a échoué.",
} as const;

export type TranslationKey = keyof typeof fr;

// AR/EN : placeholders — à traduire par l'agent Frontend. On garde les
// mêmes clés que FR (contrat de traduction stable) pour que l'ajout de
// nouvelles clés par l'agent Frontend reste homogène.
const ar: Record<TranslationKey, string> = Object.fromEntries(
  Object.entries(fr).map(([k, v]) => [k, `[AR] ${v}`]),
) as Record<TranslationKey, string>;

const en: Record<TranslationKey, string> = Object.fromEntries(
  Object.entries(fr).map(([k, v]) => [k, `[EN] ${v}`]),
) as Record<TranslationKey, string>;

export const DICTIONARIES: Record<Locale, Record<TranslationKey, string>> = { fr, ar, en };
