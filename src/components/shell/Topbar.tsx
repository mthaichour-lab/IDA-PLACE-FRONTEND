'use client';

import { useTheme } from '@/components/theme-provider';
import { useI18n } from '@/i18n/provider';
import { Locale, TranslationKey } from '@/i18n/translations';
import { useAuth } from '@/lib/auth-context';

/** Libellé d'un rôle (`params.role.<ROLE>`), repli sur le code brut. */
function roleLabel(t: (k: TranslationKey) => string, role: string): string {
  const key = `params.role.${role}` as TranslationKey;
  const label = t(key);
  return label === key ? role : label;
}

/**
 * Topbar (A.3) : logo FinLab + marque, identité de l'utilisateur connecté
 * (rôle et compagnie issus du jeton via `GET /me`, SEC-01), sélecteur de
 * langue, thème clair/sombre, déconnexion.
 */
export function Topbar() {
  const { locale, setLocale, t } = useI18n();
  const { theme, toggle } = useTheme();
  const { me, mode, logout } = useAuth();

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-logo" aria-hidden="true">
          FinLab
        </span>
        <span className="brand-sep" />
        <span>
          {t('app.brand')} <span style={{ color: 'var(--ink-2)', fontWeight: 400 }}>· {t('app.tagline')}</span>
        </span>
      </div>
      <div className="topbar-actions">
        {me ? (
          <span style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)', textAlign: 'end', lineHeight: 1.3 }}>
            <strong style={{ display: 'block', color: 'var(--ink)' }}>{me.user.name}</strong>
            {roleLabel(t, me.role)} · {me.company ?? t('auth.noCompany')}
            {mode === 'dev' ? ` · ${t('auth.devMode')}` : null}
          </span>
        ) : null}
        <select
          aria-label="Langue"
          value={locale}
          onChange={(e) => setLocale(e.target.value as Locale)}
        >
          <option value="fr">FR</option>
          <option value="ar">AR</option>
          <option value="en">EN</option>
        </select>
        <button type="button" className="icon-btn" onClick={toggle} aria-label="Basculer le thème">
          {theme === 'light' ? `🌙 ${t('theme.dark')}` : `☀️ ${t('theme.light')}`}
        </button>
        {mode === 'keycloak' ? (
          <button type="button" className="icon-btn" onClick={logout}>
            {t('auth.logout')}
          </button>
        ) : null}
      </div>
    </header>
  );
}
