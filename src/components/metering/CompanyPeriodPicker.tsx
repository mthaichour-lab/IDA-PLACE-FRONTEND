'use client';

import { useI18n } from '@/i18n/provider';
import { CompanyView } from '@/lib/types';

/**
 * Sélecteur compagnie + mois, partagé par `/metering` (écran 10) et
 * l'onglet "Coûts & tarification" de `/params` (écran 14) — les deux
 * consomment `GET /metering/{company}/{period}`.
 */
export function CompanyPeriodPicker({
  companies,
  company,
  onCompanyChange,
  period,
  onPeriodChange,
  periods,
}: {
  companies: CompanyView[];
  company: string;
  onCompanyChange: (code: string) => void;
  period: string;
  onPeriodChange: (period: string) => void;
  periods: string[];
}) {
  const { t } = useI18n();
  const selectStyle: React.CSSProperties = {
    font: 'inherit',
    border: '1px solid var(--rule-strong)',
    borderRadius: 'var(--k-r-s)',
    padding: '6px 10px',
    background: 'var(--paper)',
    color: 'var(--ink)',
  };

  return (
    <div style={{ display: 'flex', gap: 'var(--s-3)', flexWrap: 'wrap', alignItems: 'center' }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)' }}>
        {t('metering.selector.company')}
        <select style={selectStyle} value={company} onChange={(e) => onCompanyChange(e.target.value)}>
          {companies.map((c) => (
            <option key={c.id} value={c.code}>
              {c.code} — {c.name}
            </option>
          ))}
        </select>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)' }}>
        {t('metering.selector.period')}
        <select style={selectStyle} value={period} onChange={(e) => onPeriodChange(e.target.value)}>
          {periods.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
