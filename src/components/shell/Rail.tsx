'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/i18n/provider';
import { NAV_ITEMS } from './nav-items';

/** Rail de navigation vertical gauche, fond `--k-head` (A.3). */
export function Rail() {
  const pathname = usePathname();
  const { t } = useI18n();

  return (
    <nav className="rail" aria-label="Navigation principale">
      {NAV_ITEMS.map((item) => {
        const active = pathname?.startsWith(item.href);
        return (
          <Link key={item.href} href={item.href} className={`rail-item${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}>
            <span className="rail-icon mono" aria-hidden="true">
              {item.mono}
            </span>
            <span>{t(item.labelKey)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
