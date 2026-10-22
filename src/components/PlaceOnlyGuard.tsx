'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { FolioHeader } from '@/components/FolioHeader';
import { COMPANY_HOME } from '@/components/shell/nav-items';
import { useI18n } from '@/i18n/provider';
import { TranslationKey } from '@/i18n/translations';
import { useAuth } from '@/lib/auth-context';
import { isCompanyActor } from '@/lib/recours-actions';

/**
 * Écran réservé aux rôles de la place (cockpit SEC-05, journal scellé
 * SEC-21) : le backend répond 403 à un rôle compagnie. Plutôt qu'une erreur
 * « Réessayer » sans issue, l'écran l'explique et n'émet aucune requête.
 * Affichage seulement : le backend reste seul juge de l'accès.
 *
 * `redirectCompany` (cockpit, écran d'accueil par défaut après connexion) :
 * un profil compagnie est renvoyé vers son propre accueil au lieu de buter
 * sur un écran fermé.
 */
export function PlaceOnlyGuard({ titleKey, redirectCompany = false, children }: { titleKey: TranslationKey; redirectCompany?: boolean; children: React.ReactNode }) {
  const { t } = useI18n();
  const { me } = useAuth();
  const router = useRouter();
  const company = isCompanyActor(me);
  useEffect(() => {
    if (redirectCompany && company) router.replace(COMPANY_HOME);
  }, [redirectCompany, company, router]);
  if (!me) return <p>{t('common.loading')}</p>;
  if (!company) return <>{children}</>;
  return (
    <>
      <FolioHeader badge={t('placeOnly.badge')} title={t(titleKey)} />
      <div className="note warn" role="status">
        <span>{t('placeOnly.body')}</span> <Link href={COMPANY_HOME}>{t('placeOnly.goHome')}</Link>
      </div>
    </>
  );
}
