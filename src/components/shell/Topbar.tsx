'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CalendarDays, Menu, Moon, Search, Sun } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '@/components/theme-provider';
import { useI18n } from '@/i18n/provider';
import { Locale, TranslationKey } from '@/i18n/translations';
import { apiGet } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { chosenDevRole, DEV_ROLES, setDevRole } from '@/lib/auth/dev-role';
import { CockpitSummary } from '@/lib/types';
import { FinLabLogo, IdaPlaceMark } from './Brand';
import { currentNavItem, NAV_ITEMS } from './nav-items';

/** Libellé d'un rôle (`params.role.<ROLE>`), repli sur le code brut. */
export function roleLabel(t: (k: TranslationKey) => string, role: string): string {
  const key = `params.role.${role}` as TranslationKey;
  const label = t(key);
  return label === key ? role : label;
}

/** Initiales d'un nom (« Souad Benyahia » → « SB »). */
export function initials(name: string | undefined): string {
  if (!name) return '··';
  const words = name.replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '··';
}

const LOCALES: { value: Locale; label: string }[] = [
  { value: 'fr', label: 'FR' },
  { value: 'ar', label: 'ع' },
  { value: 'en', label: 'EN' },
];

/**
 * En-tête sombre (A.3) : menu, marques FinLab / IDA Place, badge « Démo »
 * (mode développement uniquement), titre de l'écran courant, recherche
 * d'écran, date de place, rôle, langue, thème, alertes et avatar.
 *
 * Données réelles uniquement : le rôle et l'identité viennent de `GET /me`
 * (SEC-01) ; la pastille de la cloche est le nombre d'alertes
 * conventionnelles réellement renvoyées par `GET /cockpit/summary` (rôles
 * de place seulement — SEC-05).
 */
export function Topbar({ onToggleNav }: { onToggleNav: () => void }) {
  const { locale, setLocale, t } = useI18n();
  const { theme, toggle } = useTheme();
  const { me, mode } = useAuth();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const current = currentNavItem(pathname);
  const placeUser = !!me && !me.company;

  const alertsQuery = useQuery({
    queryKey: ['cockpit', 'summary'],
    queryFn: () => apiGet<CockpitSummary>('/cockpit/summary'),
    enabled: placeUser,
    staleTime: 20_000,
  });
  const alertsCount = alertsQuery.data?.alertesConventionnelles.length ?? 0;

  const today = new Date().toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });

  const devMode = mode === 'dev';
  const [devRole, setDevRoleState] = useState<string>('OPERATEUR_PLACE');
  useEffect(() => {
    if (devMode) setDevRoleState(chosenDevRole() ?? me?.role ?? 'OPERATEUR_PLACE');
  }, [devMode, me?.role]);

  const onRoleChange = (role: string) => {
    setDevRole(role);
    setDevRoleState(role);
    // Nouvelle identité de démonstration : toutes les données sont rechargées sous ce rôle.
    void queryClient.resetQueries();
  };

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button type="button" className="tb-circle" onClick={onToggleNav} aria-label={t('shell.toggleNav')}>
          <Menu size={17} strokeWidth={2} />
        </button>
        <FinLabLogo size={24} />
        <span className="tb-sep" aria-hidden="true" />
        <Link href="/cockpit" className="ida-brand" aria-label={t('app.brand')}>
          <IdaPlaceMark size={28} />
          <span className="ida-brand-text">
            <strong>{t('app.brand')}</strong>
            <small>{t('app.tagline')}</small>
          </span>
        </Link>
        {devMode ? <span className="demo-badge">{t('shell.demo')}</span> : null}
        {current ? <span className="tb-title">{t(current.labelKey)}</span> : null}
      </div>

      <div className="topbar-right">
        <ScreenSearch />
        <span className="tb-pill tb-date" title={t('shell.placeDate')}>
          <CalendarDays size={14} strokeWidth={2} aria-hidden="true" />
          <span>{t('shell.placeDate')}</span>
          <span className="mono">{today}</span>
        </span>
        {devMode ? (
          <select className="tb-pill tb-role" aria-label={t('shell.role')} value={devRole} onChange={(e) => onRoleChange(e.target.value)}>
            {DEV_ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(t, r)}
              </option>
            ))}
          </select>
        ) : me ? (
          <span className="tb-pill tb-role">{roleLabel(t, me.role)}</span>
        ) : null}
        <div className="tb-lang" role="group" aria-label={t('shell.language')}>
          {LOCALES.map((l) => (
            <button key={l.value} type="button" aria-pressed={locale === l.value} className={locale === l.value ? 'on' : undefined} onClick={() => setLocale(l.value)}>
              {l.label}
            </button>
          ))}
        </div>
        <button type="button" className="tb-circle" onClick={toggle} aria-label={theme === 'light' ? t('theme.dark') : t('theme.light')}>
          {theme === 'light' ? <Moon size={16} strokeWidth={2} /> : <Sun size={16} strokeWidth={2} />}
        </button>
        {placeUser ? (
          <Link href="/cockpit" className="tb-circle tb-bell" aria-label={`${t('shell.alerts')} (${alertsCount})`}>
            <Bell size={16} strokeWidth={2} />
            {alertsCount > 0 ? <span className="tb-bell-count">{alertsCount > 99 ? '99+' : alertsCount}</span> : null}
          </Link>
        ) : null}
        <span className="tb-avatar" title={me?.user.name}>
          {initials(me?.user.name)}
        </span>
      </div>
    </header>
  );
}

/** Recherche d'écran : filtre les 14 écrans par libellé et y navigue (aucune donnée métier). */
function ScreenSearch() {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return NAV_ITEMS.filter((i) => !needle || t(i.labelKey).toLowerCase().includes(needle));
  }, [q, t]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const go = (href: string) => {
    setOpen(false);
    setQ('');
    router.push(href);
  };

  return (
    <div className="tb-search" ref={boxRef}>
      <button type="button" className="tb-circle" aria-label={t('shell.search')} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Search size={16} strokeWidth={2} />
      </button>
      {open ? (
        <div className="tb-search-pop" role="dialog" aria-label={t('shell.search')}>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('shell.searchPlaceholder')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results[0]) go(results[0].href);
              if (e.key === 'Escape') setOpen(false);
            }}
          />
          <ul>
            {results.map((r) => {
              const Icon = r.icon;
              return (
                <li key={r.href}>
                  <button type="button" onClick={() => go(r.href)}>
                    <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
                    {t(r.labelKey)}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
