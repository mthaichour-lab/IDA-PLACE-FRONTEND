'use client';

import { FolioHeader } from '@/components/FolioHeader';
import { useI18n } from '@/i18n/provider';
import { TranslationKey } from '@/i18n/translations';
import { useAuth } from '@/lib/auth-context';
import { isCompanyActor } from '@/lib/recours-actions';

/**
 * Écran réservé aux rôles de la place (cockpit SEC-05, journal scellé
 * SEC-21) : le backend répond 403 à un rôle compagnie. Plutôt qu'une erreur
 * « Réessayer » sans issue, l'écran l'explique et n'émet aucune requête.
 * Affichage seulement : le backend reste seul juge de l'accès.
 */
export function PlaceOnlyGuard({ titleKey, children }: { titleKey: TranslationKey; children: React.ReactNode }) {
  const { t } = useI18n();
  const { me } = useAuth();
  if (!me) return <p>{t('common.loading')}</p>;
  if (!isCompanyActor(me)) return <>{children}</>;
  return (
    <>
      <FolioHeader badge={t('placeOnly.badge')} title={t(titleKey)} />
      <div className="note warn" role="status">
        <span>{t('placeOnly.body')}</span>
      </div>
    </>
  );
}
