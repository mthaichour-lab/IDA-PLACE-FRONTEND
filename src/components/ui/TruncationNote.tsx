'use client';

import { useI18n } from '@/i18n/provider';

/**
 * Signale qu'une liste chargée par `fetchAllPages` a atteint son plafond
 * (SEC-13) : les décomptes ou reclassements affichés ne portent que sur les
 * `shown` premiers éléments sur `total`.
 */
export function TruncationNote({ truncated, shown, total }: { truncated?: boolean; shown: number; total: number }) {
  const { t } = useI18n();
  if (!truncated) return null;
  return (
    <p className="note warn" role="status" style={{ fontSize: 'var(--k-fs-xs)' }}>
      {t('common.truncated')} ({shown.toLocaleString()} / {total.toLocaleString()})
    </p>
  );
}
