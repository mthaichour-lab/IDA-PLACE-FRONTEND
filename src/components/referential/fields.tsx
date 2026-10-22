'use client';

import { useI18n } from '@/i18n/provider';
import type { TranslationKey } from '@/i18n/translations';
import { ApiError } from '@/lib/api-error';
import { describeApiError } from '@/lib/error-message';

/**
 * Briques de formulaire de l'écran 12 (Référentiel de place), partagées par
 * ses sections. Couleurs : tokens uniquement (`tokens.css`).
 */

const FIELD_LABEL_STYLE: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)' };
const CONTROL_STYLE: React.CSSProperties = {
  padding: '6px 10px',
  border: '1px solid var(--rule-strong)',
  borderRadius: 'var(--k-r-s)',
  font: 'inherit',
  background: 'var(--paper)',
  color: 'var(--ink)',
};

export function LabeledInput({
  label,
  value,
  onChange,
  type = 'text',
  disabled,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  return (
    <label style={FIELD_LABEL_STYLE}>
      {label}
      <input type={type} value={value} disabled={disabled} required={required} onChange={(e) => onChange(e.target.value)} style={CONTROL_STYLE} />
    </label>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function LabeledSelect({
  label,
  value,
  onChange,
  options,
  disabled,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<string | SelectOption>;
  disabled?: boolean;
  required?: boolean;
}) {
  return (
    <label style={FIELD_LABEL_STYLE}>
      {label}
      <select value={value} disabled={disabled} required={required} onChange={(e) => onChange(e.target.value)} style={CONTROL_STYLE}>
        {options.map((o) => {
          const opt = typeof o === 'string' ? { value: o, label: o } : o;
          return (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          );
        })}
      </select>
    </label>
  );
}

export function LabeledCheckbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 'var(--k-fs-s)', color: 'var(--ink)' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function FormStack({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>{children}</div>;
}

/** Bouton d'action principal (pied de modale, en-tête de section). */
export function PrimaryButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        padding: '6px 14px',
        borderRadius: 'var(--k-r-s)',
        border: '1px solid var(--k-pri)',
        background: 'var(--k-pri)',
        color: 'var(--k-head-ink)',
        font: 'inherit',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  );
}

/** Action de ligne de tableau (même rendu que les actions de l'écran Échanges). */
export function RowAction({ children, onClick, disabled, ariaLabel }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; ariaLabel?: string }) {
  return (
    <button type="button" className="tag a" disabled={disabled} onClick={onClick} aria-label={ariaLabel} style={{ border: 'none', cursor: disabled ? 'not-allowed' : 'pointer' }}>
      {children}
    </button>
  );
}

export function RowActions({ children }: { children: React.ReactNode }) {
  return <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>{children}</span>;
}

/**
 * Libellé d'erreur : code métier connu → texte traduit (`t` fourni, voir
 * `lib/error-message.ts`) ; sinon message du backend (ex. 409) s'il existe ;
 * sinon le libellé de repli.
 */
export function apiErrorMessage(err: unknown, fallback: string, t?: (key: TranslationKey) => string): string {
  if (t) return describeApiError(err, t, fallback);
  return err instanceof ApiError && err.message ? err.message : fallback;
}

/** Chargement / erreur avec « Réessayer » / contenu — même rendu que les autres sections de l'écran. */
export function QueryState({
  isLoading,
  error,
  onRetry,
  children,
}: {
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  if (isLoading) return <p>{t('common.loading')}</p>;
  if (error) {
    return (
      <div className="note ko" role="alert">
        <span>{t('common.error')}</span>
        <button type="button" onClick={onRetry}>
          {t('common.retry')}
        </button>
      </div>
    );
  }
  return <>{children}</>;
}

export function SubTitle({ children }: { children: React.ReactNode }) {
  return <strong style={{ display: 'block', marginBottom: 'var(--s-2)', fontSize: 'var(--k-fs-s)' }}>{children}</strong>;
}

export function Hint({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)', marginTop: 'var(--s-3)' }}>{children}</p>;
}
