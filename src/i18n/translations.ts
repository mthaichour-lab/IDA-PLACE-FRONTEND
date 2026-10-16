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
