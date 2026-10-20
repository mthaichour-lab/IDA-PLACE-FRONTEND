import {
  Award,
  Building,
  CalendarDays,
  ChartColumn,
  Coins,
  FileText,
  LayoutGrid,
  Link,
  LucideIcon,
  Network,
  Scale,
  Server,
  Settings,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { TranslationKey } from '@/i18n/translations';

/**
 * Pastille de compteur affichée à droite d'un item de navigation — toujours
 * un compteur RÉEL renvoyé par l'API (jamais une valeur décorative) :
 * - `matching` : déclarations « à confirmer » (`GET /matching/queue/counters`) ;
 * - `exchanges` : recours en attente de réponse (`GET /recours/counters`) ;
 * - `commission` : affaires pendantes (`GET /commission/summary`).
 */
export type NavBadgeSource = 'matching' | 'exchanges' | 'commission';

export interface NavItem {
  href: string;
  labelKey: TranslationKey;
  /** Libellé long (titre de page de l'en-tête). */
  titleKey: TranslationKey;
  icon: LucideIcon;
  mono: string; // monogramme compact pour la barre mobile
  badge?: NavBadgeSource;
}

/** Inventaire des 14 écrans — A.4. Ordre = ordre de la barre latérale. */
export const NAV_ITEMS: NavItem[] = [
  { href: '/cockpit', labelKey: 'nav.cockpit', titleKey: 'cockpit.title', icon: LayoutGrid, mono: 'CO' },
  { href: '/matching', labelKey: 'nav.matching', titleKey: 'nav.matching', icon: Link, mono: 'MA', badge: 'matching' },
  { href: '/import', labelKey: 'nav.import', titleKey: 'nav.import', icon: Upload, mono: 'IM' },
  { href: '/exchanges', labelKey: 'nav.exchanges', titleKey: 'nav.exchanges', icon: Network, mono: 'EX', badge: 'exchanges' },
  { href: '/monthly', labelKey: 'nav.monthly', titleKey: 'nav.monthly', icon: CalendarDays, mono: 'CY' },
  { href: '/quarter', labelKey: 'nav.quarter', titleKey: 'nav.quarter', icon: Coins, mono: 'CT' },
  { href: '/commission', labelKey: 'nav.commission', titleKey: 'nav.commission', icon: Scale, mono: 'CM', badge: 'commission' },
  { href: '/monitoring', labelKey: 'nav.monitoring', titleKey: 'nav.monitoring', icon: ShieldCheck, mono: 'MO' },
  { href: '/fraude', labelKey: 'nav.fraude', titleKey: 'nav.fraude', icon: FileText, mono: 'AF' },
  { href: '/metering', labelKey: 'nav.metering', titleKey: 'nav.metering', icon: Server, mono: 'ME' },
  { href: '/stats', labelKey: 'nav.stats', titleKey: 'nav.stats', icon: ChartColumn, mono: 'ST' },
  { href: '/referential', labelKey: 'nav.referential', titleKey: 'nav.referential', icon: Building, mono: 'RE' },
  { href: '/ledger', labelKey: 'nav.ledger', titleKey: 'nav.ledger', icon: Award, mono: 'JS' },
  { href: '/params', labelKey: 'nav.params', titleKey: 'nav.params', icon: Settings, mono: 'PA' },
];

/** Barre mobile inférieure — 4 items principaux explicitement désignés par A.3 + "Plus". */
export const MOBILE_PRIMARY_HREFS = ['/cockpit', '/exchanges', '/quarter', '/ledger'];

/** Item de navigation correspondant au chemin courant (titre de l'en-tête). */
export function currentNavItem(pathname: string | null): NavItem | undefined {
  return NAV_ITEMS.find((i) => pathname?.startsWith(i.href));
}
