'use client';

import { FolioHeader } from '@/components/FolioHeader';
import { useI18n } from '@/i18n/provider';

/**
 * Écran "en construction" — pour les 13 écrans non prioritaires de ce
 * sprint (A.4). Garde le bon badge/titre/sous-titre de l'écran final,
 * sans aucun contenu métier inventé (voir HANDOFF.md pour la priorité des
 * écrans restants).
 */
export function WipPage({ badge, title }: { badge: string; title: string }) {
  const { t } = useI18n();
  return (
    <>
      <FolioHeader badge={badge} title={title} />
      <div className="wip">
        <strong>{t('wip.title')}</strong>
        <p style={{ maxWidth: '48ch' }}>{t('wip.subtitle')}</p>
      </div>
    </>
  );
}
