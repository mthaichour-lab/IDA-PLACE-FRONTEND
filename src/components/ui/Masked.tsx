'use client';

import { useI18n } from '@/i18n/provider';

/**
 * Valeur nominative masquée par le backend (« •••• », SEC-03/SEC-26) : une
 * donnée d'une autre compagnie que le lecteur n'a pas le droit de voir. Elle
 * n'est jamais affichée comme une valeur réelle ni comparée à une autre.
 */
export const MASKED_VALUE = '••••';

export function isMaskedValue(value: unknown): boolean {
  return value === MASKED_VALUE;
}

/** Libellé « masqué » (valeur masquée) ou « — » (valeur absente), sinon la valeur. */
export function MaskedValue({ value, mono = false }: { value: string | number | undefined | null; mono?: boolean }) {
  const { t } = useI18n();
  if (isMaskedValue(value)) {
    return (
      <span title={t('common.masked.hint')} style={{ color: 'var(--ink-3)', fontStyle: 'italic' }}>
        {t('common.masked')}
      </span>
    );
  }
  if (value === undefined || value === null || value === '') return <span style={{ color: 'var(--ink-3)' }}>—</span>;
  return mono ? <span className="mono">{value}</span> : <>{value}</>;
}
