'use client';

import { useCallback } from 'react';
import { useI18n } from '@/i18n/provider';
import type { TranslationKey } from '@/i18n/translations';
import { ApiError } from './api-error';

/**
 * Codes d'erreur métier du backend (phase 1 de remédiation sécurité) qui ont
 * un libellé traduit côté interface. Le code fait foi ; le texte du serveur
 * n'est plus qu'un repli pour les codes non répertoriés ici.
 *
 * Ne concerne que les 4xx : un 5xx, un 401, un 413 ou un 429 garde le message
 * générique de `api-error.ts` (SEC-50).
 */
export const API_ERROR_CODE_KEYS: Record<string, TranslationKey> = {
  // Import (SEC-02, SEC-12)
  COMPAGNIE_REQUISE: 'error.code.COMPAGNIE_REQUISE',
  COMPAGNIE_INCONNUE: 'error.code.COMPAGNIE_INCONNUE',
  FORMAT_INVALIDE: 'error.code.FORMAT_INVALIDE',
  FORMAT_XLS_NON_PRIS_EN_CHARGE: 'error.code.FORMAT_XLS_NON_PRIS_EN_CHARGE',
  ARCHIVE_REFUSEE: 'error.code.ARCHIVE_REFUSEE',
  IMPORT_TROP_DE_LIGNES: 'error.code.IMPORT_TROP_DE_LIGNES',
  PARAMETRE_INCONNU: 'error.code.PARAMETRE_INCONNU',
  // Appariement (SEC-28)
  MOTIF_REQUIS: 'error.code.MOTIF_REQUIS',
  LIEN_REQUIS: 'error.code.LIEN_REQUIS',
  LIEN_INVALIDE: 'error.code.LIEN_INVALIDE',
  // Recours (SEC-06, SEC-17, SEC-32, SEC-46)
  RECOURS_MONTANT_SUPERIEUR_DOSSIER: 'error.code.RECOURS_MONTANT_SUPERIEUR_DOSSIER',
  RECOURS_MONTANT_PLAFOND: 'error.code.RECOURS_MONTANT_PLAFOND',
  MONTANT_INVALIDE: 'error.code.MONTANT_INVALIDE',
  MONTANT_DOSSIER_INCONNU: 'error.code.MONTANT_DOSSIER_INCONNU',
  CONFLIT_CONCURRENT: 'error.code.CONFLIT_CONCURRENT',
  DECISION_COMMISSION_REQUISE: 'error.code.DECISION_COMMISSION_REQUISE',
  RECOURS_EXISTANT: 'error.code.RECOURS_EXISTANT',
  // Commission (SEC-20, SEC-32)
  RECOURS_HORS_COMMISSION: 'error.code.RECOURS_HORS_COMMISSION',
  DOSSIER_COMMISSION_EXISTANT: 'error.code.DOSSIER_COMMISSION_EXISTANT',
  PV_DEJA_SIGNE: 'error.code.PV_DEJA_SIGNE',
  DECISION_REQUISE: 'error.code.DECISION_REQUISE',
  PENALITE_PLAFOND: 'error.code.PENALITE_PLAFOND',
  SANCTION_EXISTANTE: 'error.code.SANCTION_EXISTANTE',
  SANCTION_DEJA_PRONONCEE: 'error.code.SANCTION_DEJA_PRONONCEE',
  FOUR_EYES: 'error.code.FOUR_EYES',
  // Compensation (SEC-19, SEC-34)
  PERIODE_NON_ECHUE: 'error.code.PERIODE_NON_ECHUE',
  // Référentiel (SEC-04, SEC-14, SEC-30)
  GOUVERNANCE_RESERVEE: 'error.code.GOUVERNANCE_RESERVEE',
  REVISION_PERIMEE: 'error.code.REVISION_PERIMEE',
  RIB_NON_CHIFFRABLE: 'error.code.RIB_NON_CHIFFRABLE',
  // Adhésions (SEC-47)
  DATE_RECEPTION_TROP_ANCIENNE: 'error.code.DATE_RECEPTION_TROP_ANCIENNE',
  // Administration (SEC-25)
  PRIVILEGE_RESERVE_PLACE: 'error.code.PRIVILEGE_RESERVE_PLACE',
  // Métrologie (SEC-37)
  VERSION_EXISTANTE: 'error.code.VERSION_EXISTANTE',
  DATE_EFFET_RETROACTIVE: 'error.code.DATE_EFFET_RETROACTIVE',
};

/** Libellé d'une erreur d'API : code connu → texte traduit ; sinon message (déjà filtré) de l'API ; sinon repli. */
export function describeApiError(err: unknown, t: (key: TranslationKey) => string, fallback: string): string {
  if (!(err instanceof ApiError)) return fallback;
  if (err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 413 && err.status !== 429) {
    const key = API_ERROR_CODE_KEYS[err.code];
    if (key) return t(key);
  }
  return err.message || fallback;
}

/** Variante hook de `describeApiError`, liée à la langue courante. */
export function useApiErrorMessage(): (err: unknown, fallback: string) => string {
  const { t } = useI18n();
  return useCallback((err: unknown, fallback: string) => describeApiError(err, t, fallback), [t]);
}
