'use client';

import { Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';
import { GRID_VERSION_PATTERN, suggestNextVersion, todayIso } from '@/components/metering/PriceGridEditor';
import { useI18n } from '@/i18n/provider';
import { PriceGrid } from '@/lib/types';

/**
 * Grille tarifaire paramétrable (B.8), présentation de la maquette r19 :
 * tableau Métrique / Unité / Quota inclus / Prix unitaire avec champs en
 * pastille. Même comportement que `PriceGridEditor` (partagé avec
 * `/params`, inchangé) dont on réutilise les règles de version :
 * - SEC-37 : une modification crée une NOUVELLE version (`TARIF-AAAA.NN`,
 *   différente de la version en vigueur) à une date d'effet au plus tôt
 *   aujourd'hui — jamais une réécriture de la grille publiée ;
 * - SEC-38 : édition seulement si le parent l'autorise (`hasPrivilege('grid')`),
 *   le backend refuse de toute façon le PUT sans ce privilège (403).
 * Aucun calcul métier ici : on édite des valeurs, le back recalcule les factures.
 */
export function MeteringGridCard({
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

  // Resynchronise le brouillon sur la valeur serveur tant qu'on n'édite pas.
  useEffect(() => {
    if (!editing) setDraft(grid);
  }, [grid, editing]);

  function startEditing() {
    setDraft({ ...grid, version: suggestNextVersion(grid.version), effectiveFrom: todayIso() });
    setEditing(true);
  }

  const versionValid = GRID_VERSION_PATTERN.test(draft.version) && draft.version !== grid.version;
  const effectiveValid = /^\d{4}-\d{2}-\d{2}$/.test(draft.effectiveFrom) && draft.effectiveFrom >= todayIso();
  const canSave = versionValid && effectiveValid && !saving;

  function updateMetric(index: number, field: 'includedQuota' | 'unitPrice', value: number) {
    setDraft((prev) => ({ ...prev, metrics: prev.metrics.map((m, i) => (i === index ? { ...m, [field]: value } : m)) }));
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

  const quotaHeader = t('metering.grid.col.quota');
  const priceHeader = t('metering.grid.col.priceDa');

  return (
    <div className="sheet mtr-grid">
      <div className="sheet-head">
        <span>{t('metering.grid.title')}</span>
        {canEdit ? (
          editing ? (
            <div className="mtr-head-actions">
              <button type="button" className="btn-soft" onClick={cancel} disabled={saving}>
                {t('metering.grid.cancel')}
              </button>
              <button type="button" className="btn-primary mtr-save" onClick={save} disabled={!canSave}>
                {t('metering.grid.save')}
              </button>
            </div>
          ) : (
            <button type="button" className="btn-outline mtr-edit" onClick={startEditing}>
              <Pencil size={15} strokeWidth={2} aria-hidden="true" />
              {t('metering.grid.edit')}
            </button>
          )
        ) : null}
      </div>
      <div className="sheet-body flush">
        <p className="mtr-grid-meta">
          {t('metering.grid.effectiveFrom')} <span className="mono">{grid.effectiveFrom}</span>
          <span className="head-chip">{grid.version}</span>
          {!canEdit ? <span className="mtr-grid-ro">{t('metering.grid.readonly')}</span> : null}
        </p>

        {editing ? (
          <div className="mtr-grid-edit">
            <label>
              {t('metering.grid.newVersion')}
              <input
                type="text"
                required
                aria-invalid={!versionValid}
                value={draft.version}
                placeholder="TARIF-AAAA.NN"
                onChange={(e) => setDraft((prev) => ({ ...prev, version: e.target.value.trim().toUpperCase() }))}
              />
            </label>
            <label>
              {t('metering.grid.newEffectiveFrom')}
              <input
                type="date"
                required
                min={todayIso()}
                aria-invalid={!effectiveValid}
                value={draft.effectiveFrom}
                onChange={(e) => setDraft((prev) => ({ ...prev, effectiveFrom: e.target.value }))}
              />
            </label>
            <p className={versionValid && effectiveValid ? 'mtr-hint' : 'mtr-hint ko'}>
              {versionValid && effectiveValid ? t('metering.grid.versionHint') : t('metering.grid.versionInvalid')}
            </p>
          </div>
        ) : null}

        <div className="t-wrap">
          <table className="t mtr-grid-t">
            <thead>
              <tr>
                <th>{t('metering.grid.col.metricShort')}</th>
                <th>{t('metering.grid.col.unit')}</th>
                <th className="num">{quotaHeader}</th>
                <th className="num">{priceHeader}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="mtr-strong">{draft.subscription.label}</td>
                <td className="mtr-unit">{t('metering.grid.subscriptionUnit')}</td>
                <td className="num mtr-dash">—</td>
                <td className="num">
                  <input
                    type="number"
                    className="mtr-field"
                    aria-label={`${draft.subscription.label} — ${t('metering.grid.subscriptionLabel')}`}
                    value={draft.subscription.monthly}
                    disabled={!editing}
                    onChange={(e) => setDraft((prev) => ({ ...prev, subscription: { ...prev.subscription, monthly: Number(e.target.value) } }))}
                  />
                </td>
              </tr>
              {draft.metrics.map((m, i) => (
                <tr key={m.metric}>
                  <td>{m.label}</td>
                  <td className="mtr-unit">{m.unit}</td>
                  <td className="num">
                    <input
                      type="number"
                      className="mtr-field"
                      aria-label={`${m.label} — ${quotaHeader}`}
                      value={m.includedQuota}
                      disabled={!editing}
                      onChange={(e) => updateMetric(i, 'includedQuota', Number(e.target.value))}
                    />
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      className="mtr-field"
                      aria-label={`${m.label} — ${priceHeader}`}
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
