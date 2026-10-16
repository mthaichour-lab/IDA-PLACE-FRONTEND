import { TranslationKey } from '@/i18n/translations';

export interface NavItem {
  href: string;
  labelKey: TranslationKey;
  mono: string; // monogramme compact pour le rail (pas de librairie d'icônes imposée, A.1)
}

/** Inventaire des 14 écrans — A.4. Ordre = ordre du rail de navigation. */
export const NAV_ITEMS: NavItem[] = [
  { href: '/cockpit', labelKey: 'nav.cockpit', mono: 'CO' },
  { href: '/matching', labelKey: 'nav.matching', mono: 'MA' },
  { href: '/import', labelKey: 'nav.import', mono: 'IM' },
  { href: '/exchanges', labelKey: 'nav.exchanges', mono: 'EX' },
  { href: '/monthly', labelKey: 'nav.monthly', mono: 'CM' },
  { href: '/quarter', labelKey: 'nav.quarter', mono: 'CT' },
  { href: '/commission', labelKey: 'nav.commission', mono: 'CM' },
  { href: '/monitoring', labelKey: 'nav.monitoring', mono: 'MO' },
  { href: '/fraude', labelKey: 'nav.fraude', mono: 'AF' },
  { href: '/metering', labelKey: 'nav.metering', mono: 'ME' },
  { href: '/stats', labelKey: 'nav.stats', mono: 'ST' },
  { href: '/referential', labelKey: 'nav.referential', mono: 'RE' },
  { href: '/ledger', labelKey: 'nav.ledger', mono: 'JS' },
  { href: '/params', labelKey: 'nav.params', mono: 'PA' },
];

/** Barre mobile inférieure — 4 items principaux explicitement désignés par A.3 + "Plus". */
export const MOBILE_PRIMARY_HREFS = ['/cockpit', '/exchanges', '/quarter', '/ledger'];
