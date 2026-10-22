import { describe, expect, it } from 'vitest';
import { COMPANY_HOME, homePath, visibleNavItems } from './nav-items';

describe('navigation selon le profil', () => {
  it('masque les écrans réservés à la place à un profil compagnie', () => {
    const hrefs = visibleNavItems(true).map((i) => i.href);
    expect(hrefs).not.toContain('/cockpit');
    expect(hrefs).not.toContain('/ledger');
    expect(hrefs).toContain('/matching');
    expect(hrefs).toContain('/exchanges');
  });

  it('masque un écran dont le privilège manque (paramétrage : admin)', () => {
    expect(visibleNavItems(false, () => false).map((i) => i.href)).not.toContain('/params');
    expect(visibleNavItems(false, (p) => p === 'admin').map((i) => i.href)).toContain('/params');
  });

  it('un rôle place voit le cockpit ; une compagnie atterrit sur sa file de confrontation', () => {
    expect(visibleNavItems(false).map((i) => i.href)).toContain('/cockpit');
    expect(homePath(true)).toBe(COMPANY_HOME);
    expect(homePath(false)).toBe('/cockpit');
  });
});
