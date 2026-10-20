'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { MobileBar } from './MobileBar';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

const WELCOME_KEY = 'ida-place.welcome-shown';

/**
 * Coque applicative (A.3) : en-tête sombre pleine largeur, puis une feuille
 * claire aux angles supérieurs arrondis qui porte la barre latérale et le
 * contenu de l'écran ; barre inférieure sur mobile.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();
  const { toast } = useToast();
  const { t } = useI18n();

  // Mention « Propulsé par … » une fois par session du navigateur.
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(WELCOME_KEY)) return;
      window.sessionStorage.setItem(WELCOME_KEY, '1');
    } catch {
      return;
    }
    toast(t('shell.poweredBy'), 'ok');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Le tiroir mobile se referme à chaque changement d'écran.
  useEffect(() => setDrawerOpen(false), [pathname]);

  const onToggleNav = () => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 860px)').matches) setDrawerOpen((o) => !o);
    else setNavCollapsed((c) => !c);
  };

  return (
    <div className={`shell${drawerOpen ? ' drawer-open' : ''}`}>
      <Topbar onToggleNav={onToggleNav} />
      <div className="sheet-wrap">
        <span className="sheet-grip" aria-hidden="true" />
        <Sidebar collapsed={navCollapsed} onNavigate={() => setDrawerOpen(false)} />
        <main className="content">{children}</main>
      </div>
      <MobileBar />
    </div>
  );
}
