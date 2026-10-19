'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { PriceGrid } from '@/lib/types';

/** SEC-37 : format imposé par le backend (`TARIF-AAAA.NN`). */
export const GRID_VERSION_PATTERN = /^TARIF-\d{4}\.\d{2}$/;

/** Date du jour (UTC, AAAA-MM-JJ) — le backend refuse une date d'effet antérieure (400 DATE_EFFET_RETROACTIVE). */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Version suivante proposée à l'édition : `TARIF-AAAA.NN` incrémenté (même
 * année), sinon `TARIF-<année courante>.01`. Simple proposition : l'auteur
 * peut la changer, le backend reste juge de l'unicité (409 VERSION_EXISTANTE).
 */
export function suggestNextVersion(current: string, now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const m = /^TARIF-(\d{4})\.(\d{2})$/.exec(current);
  if (m && Number(m[1]) === year && Number(m[2]) < 99) return `TARIF-${year}.${String(Number(m[2]) + 1).padStart(2, '0')}`;
  if (m && Number(m[1]) > year) return `TARIF-${m[1]}.${String(Math.min(99, Number(m[2]) + 1)).padStart(2, '0')}`;
  return `TARIF-${year}.01`;
}

/**
 * Grille tarifaire paramétrable (B.8) — affichage + édition si
 * `hasPrivilege('grid')` (le parent décide, via `canEdit`). Partagée par
 * `/metering` (écran 10) et l'onglet "Coûts & tarification" de `/params`
 * (écran 14) : même grille réelle (`GET/PUT /pricing/grid`), un seul
 * composant pour éviter la duplication. Aucun calcul métier ici — on édite
 * des valeurs, le back recalcule les factures à partir d'elles.
 */
export function PriceGridEditor({
  grid,
  canEdit,
  onSave,
  saving,
}: {
  grid: PriceGrid;
  canEdit: boolean;
  onSave: (next: PriceGrid) => Promise<unknown>;
  saving: boolean;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PriceGrid>(grid);

  // Resynchronise le brouillon sur la valeur serveur tant qu'on n'édite pas
  // (ex: changement de période côté facture n'affecte pas la grille, mais un
  // refetch après sauvegarde doit se refléter).
  useEffect(() => {
    if (!editing) setDraft(grid);
  }, [grid, editing]);

  // SEC-37 : une modification crée une NOUVELLE version, à une date d'effet
  // au plus tôt aujourd'hui — jamais une réécriture de la grille publiée.
  function startEditing() {
    setDraft({ ...grid, version: suggestNextVersion(grid.version), effectiveFrom: todayIso() });
    setEditing(true);
  }

  const versionValid = GRID_VERSION_PATTERN.test(draft.version) && draft.version !== grid.version;
  const effectiveValid = /^\d{4}-\d{2}-\d{2}$/.test(draft.effectiveFrom) && draft.effectiveFrom >= todayIso();
  const canSave = versionValid && effectiveValid && !saving;

  function updateMetric(index: number, field: 'includedQuota' | 'unitPrice', value: number) {
    setDraft((prev) => ({
      ...prev,
      metrics: prev.metrics.map((m, i) => (i === index ? { ...m, [field]: value } : m)),
    }));
  }

  function cancel() {
    setDraft(grid);
    setEditing(false);
  }

  async function save() {
    try {
      await onSave(draft);
      setEditing(false);
    } catch {
      // le mutateur parent affiche déjà un toast d'erreur — on reste en édition.
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '4px 6px',
    border: '1px solid var(--rule-strong)',
    borderRadius: 'var(--k-r-xs)',
    font: 'inherit',
    background: 'var(--paper)',
    color: 'var(--ink)',
  };

  return (
    <div className="sheet">
      <div className="sheet-head">
        <span>
          {t('metering.grid.title')} · <span className="mono">{grid.version}</span>
        </span>
        {canEdit ? (
          editing ? (
            <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
              <button type="button" onClick={cancel} disabled={saving} style={{ padding: '6px 12px', borderRadius: 'var(--k-r-s)', border: '1px solid var(--rule-strong)', background: 'var(--paper)', color: 'var(--ink)', font: 'inherit', cursor: 'pointer' }}>
                {t('metering.grid.cancel')}
              </button>
              <button type="button" onClick={save} disabled={!canSave} style={{ padding: '6px 12px', borderRadius: 'var(--k-r-s)', border: '1px solid var(--k-pri)', background: 'var(--k-pri)', color: '#fff', font: 'inherit', cursor: canSave ? 'pointer' : 'not-allowed', opacity: canSave ? 1 : 0.6 }}>
                {t('metering.grid.save')}
              </button>
            </div>
          ) : (
            <button type="button" onClick={startEditing} style={{ padding: '6px 12px', borderRadius: 'var(--k-r-s)', border: '1px solid var(--rule-strong)', background: 'var(--paper)', color: 'var(--ink)', font: 'inherit', cursor: 'pointer' }}>
              {t('metering.grid.edit')}
            </button>
          )
        ) : null}
      </div>
      <div className="sheet-body">
        <p style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)', marginTop: 0 }}>
          {t('metering.grid.effectiveFrom')} : <span className="mono">{grid.effectiveFrom}</span>
        </p>
        {!canEdit ? (
          <p style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)', marginTop: 0 }}>{t('metering.grid.readonly')}</p>
        ) : null}

        {editing ? (
          <div style={{ display: 'flex', gap: 'var(--s-3)', flexWrap: 'wrap', marginBottom: 'var(--s-4)' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)', minWidth: 200 }}>
              {t('metering.grid.newVersion')}
              <input
                type="text"
                required
                aria-invalid={!versionValid}
                style={inputStyle}
                value={draft.version}
                placeholder="TARIF-AAAA.NN"
                onChange={(e) => setDraft((prev) => ({ ...prev, version: e.target.value.trim().toUpperCase() }))}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)', minWidth: 180 }}>
              {t('metering.grid.newEffectiveFrom')}
              <input
                type="date"
                required
                min={todayIso()}
                aria-invalid={!effectiveValid}
                style={inputStyle}
                value={draft.effectiveFrom}
                onChange={(e) => setDraft((prev) => ({ ...prev, effectiveFrom: e.target.value }))}
              />
            </label>
            <p style={{ flexBasis: '100%', fontSize: 'var(--k-fs-xs)', color: versionValid && effectiveValid ? 'var(--ink-3)' : 'var(--ko)', margin: 0 }}>
              {versionValid && effectiveValid ? t('metering.grid.versionHint') : t('metering.grid.versionInvalid')}
            </p>
          </div>
        ) : null}

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)', maxWidth: 260, marginBottom: 'var(--s-4)' }}>
          {t('metering.grid.subscriptionLabel')}
          <input
            type="number"
            style={inputStyle}
            value={draft.subscription.monthly}
            disabled={!editing}
            onChange={(e) => setDraft((prev) => ({ ...prev, subscription: { ...prev.subscription, monthly: Number(e.target.value) } }))}
          />
        </label>

        <div className="t-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>{t('metering.grid.col.metric')}</th>
                <th>{t('metering.grid.col.unit')}</th>
                <th>{t('metering.grid.col.quota')}</th>
                <th>{t('metering.grid.col.price')}</th>
              </tr>
            </thead>
            <tbody>
              {draft.metrics.map((m, i) => (
                <tr key={m.metric}>
                  <td>{m.label}</td>
                  <td className="mono">{m.unit}</td>
                  <td>
                    <input
                      type="number"
                      style={inputStyle}
                      value={m.includedQuota}
                      disabled={!editing}
                      onChange={(e) => updateMetric(i, 'includedQuota', Number(e.target.value))}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      style={inputStyle}
                      value={m.unitPrice}
                      disabled={!editing}
                      onChange={(e) => updateMetric(i, 'unitPrice', Number(e.target.value))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
