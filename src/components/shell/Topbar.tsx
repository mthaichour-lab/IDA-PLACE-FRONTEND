'use client';

import { useTheme } from '@/components/theme-provider';
import { useI18n } from '@/i18n/provider';
import { Locale } from '@/i18n/translations';

/** Topbar (A.3) : logo FinLab + marque, sélecteur de langue, thème clair/sombre. */
export function Topbar() {
  const { locale, setLocale, t } = useI18n();
  const { theme, toggle } = useTheme();

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
      </div>
    </header>
  );
}
