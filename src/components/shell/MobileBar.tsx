'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { Modal } from '@/components/ui/Modal';
import { MOBILE_PRIMARY_HREFS, NAV_ITEMS } from './nav-items';

/** Barre mobile inférieure (A.3) : 4 items principaux + menu "Plus". */
export function MobileBar() {
  const pathname = usePathname();
  const { t } = useI18n();
  const [moreOpen, setMoreOpen] = useState(false);

  const primary = NAV_ITEMS.filter((i) => MOBILE_PRIMARY_HREFS.includes(i.href));
  const rest = NAV_ITEMS.filter((i) => !MOBILE_PRIMARY_HREFS.includes(i.href));

  return (
    <>
      <nav className="mobile-bar" aria-label="Navigation mobile">
        {primary.map((item) => (
          <Link key={item.href} href={item.href} className={pathname?.startsWith(item.href) ? 'active' : undefined}>
            <span className="mono" aria-hidden="true">
              {item.mono}
            </span>
            <span>{t(item.labelKey)}</span>
          </Link>
        ))}
        <button type="button" onClick={() => setMoreOpen(true)}>
          <span aria-hidden="true">⋯</span>
          <span>{t('nav.more')}</span>
        </button>
      </nav>
      <Modal open={moreOpen} title={t('nav.more')} onClose={() => setMoreOpen(false)}>
        <div style={{ display: 'grid', gap: 8 }}>
          {rest.map((item) => (
            <Link key={item.href} href={item.href} onClick={() => setMoreOpen(false)}>
              {t(item.labelKey)}
            </Link>
          ))}
        </div>
      </Modal>
    </>
  );
}
