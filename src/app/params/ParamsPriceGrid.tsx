'use client';

import { Info } from 'lucide-react';
import { useEffect, useState } from 'react';
import { GRID_VERSION_PATTERN, suggestNextVersion, todayIso } from '@/components/metering/PriceGridEditor';
import { useI18n } from '@/i18n/provider';
import { PriceGrid } from '@/lib/types';

/**
 * Grille tarifaire paramétrable — présentation propre à l'onglet « Coûts &
 * tarification » de `/params` (maquette : champs quota/prix directement
 * éditables dans le tableau, bandeau d'information). Même grille réelle
 * (`GET/PUT /pricing/grid`) et mêmes règles que `PriceGridEditor` (partagé
 * avec `/metering`, non modifié) : ses helpers de version sont réutilisés.
 *
 * SEC-37 : une modification ne réécrit JAMAIS la grille publiée — dès la
 * première saisie, une NOUVELLE version (`TARIF-AAAA.NN`, proposée
 * incrémentée) et une date d'effet (au plus tôt aujourd'hui) sont exigées
 * avant l'enregistrement ; le backend reste juge (409/400).
 */
export function ParamsPriceGrid({
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
  const { t, locale } = useI18n();
  const [draft, setDraft] = useState<PriceGrid>(grid);
  // Non nul dès qu'une valeur est modifiée : version + date d'effet de la NOUVELLE grille.
  const [next, setNext] = useState<{ version: string; effectiveFrom: string } | null>(null);

  // Resynchronise sur la valeur serveur tant qu'aucune modification n'est en cours (refetch après sauvegarde).
  useEffect(() => {
    if (!next) setDraft(grid);
  }, [grid, next]);

  function edit(update: (prev: PriceGrid) => PriceGrid) {
    if (!next) setNext({ version: suggestNextVersion(grid.version), effectiveFrom: todayIso() });
    setDraft(update);
  }

  function updateMetric(index: number, field: 'includedQuota' | 'unitPrice', value: number) {
    edit((prev) => ({ ...prev, metrics: prev.metrics.map((m, i) => (i === index ? { ...m, [field]: value } : m)) }));
  }

  const versionValid = !!next && GRID_VERSION_PATTERN.test(next.version) && next.version !== grid.version;
  const effectiveValid = !!next && /^\d{4}-\d{2}-\d{2}$/.test(next.effectiveFrom) && next.effectiveFrom >= todayIso();
  const canSave = versionValid && effectiveValid && !saving;

  function cancel() {
    setDraft(grid);
    setNext(null);
  }

  async function save() {
    if (!next) return;
    try {
      await onSave({ ...draft, version: next.version, effectiveFrom: next.effectiveFrom });
      setNext(null);
    } catch {
      // le mutateur parent affiche déjà un toast d'erreur — on garde la saisie.
    }
  }

  const quotaHeader = t('metering.grid.col.quota');
  const priceHeader = t('metering.grid.col.priceDa');

  return (
    <div className="sheet pa-grid">
      <div className="sheet-head">
        <span>{t('metering.grid.title')}</span>
        <span className="head-chip" title={t('metering.grid.versionHint')}>
          {grid.version} · {t('metering.grid.effectiveFrom')} {grid.effectiveFrom}
        </span>
      </div>
      <div className="sheet-body flush">
        <div className="pa-info">
          <Info size={14} aria-hidden="true" />
          <span>{t('params.grid.info')}</span>
        </div>
        {!canEdit ? <p className="pa-readonly">{t('metering.grid.readonly')}</p> : null}

        <div className="t-wrap">
          <table className="t pa-grid-t">
            <thead>
              <tr>
                <th>{t('params.grid.col.metric')}</th>
                <th>{t('metering.grid.col.unit')}</th>
                <th className="pa-end">{quotaHeader}</th>
                <th className="pa-end">{priceHeader}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="pa-strong">{draft.subscription.label}</td>
                <td className="pa-unit">{t('metering.grid.subscriptionUnit')}</td>
                <td className="pa-end pa-dash">—</td>
                <td className="pa-end">
                  <input
                    type="number"
                    className="pa-num"
                    aria-label={`${draft.subscription.label} — ${priceHeader}`}
                    value={draft.subscription.monthly}
                    disabled={!canEdit || saving}
                    onChange={(e) => edit((prev) => ({ ...prev, subscription: { ...prev.subscription, monthly: Number(e.target.value) } }))}
                  />
                </td>
              </tr>
              {draft.metrics.map((m, i) => (
                <tr key={m.metric}>
                  <td className="pa-strong">{m.label}</td>
                  <td className="pa-unit">{m.unit}</td>
                  <td className="pa-end">
                    <input
                      type="number"
                      className="pa-num pa-num-quota"
                      aria-label={`${m.label} — ${quotaHeader}`}
                      value={m.includedQuota}
                      disabled={!canEdit || saving}
                      onChange={(e) => updateMetric(i, 'includedQuota', Number(e.target.value))}
                    />
                  </td>
                  <td className="pa-end">
                    <input
                      type="number"
                      className="pa-num"
                      aria-label={`${m.label} — ${priceHeader}`}
                      value={m.unitPrice}
                      disabled={!canEdit || saving}
                      onChange={(e) => updateMetric(i, 'unitPrice', Number(e.target.value))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {next ? (
          <div className="pa-grid-save">
            <label>
              {t('metering.grid.newVersion')}
              <input
                type="text"
                required
                aria-invalid={!versionValid}
                value={next.version}
                placeholder="TARIF-AAAA.NN"
                onChange={(e) => setNext((prev) => (prev ? { ...prev, version: e.target.value.trim().toUpperCase() } : prev))}
              />
            </label>
            <label>
              {t('metering.grid.newEffectiveFrom')}
              <input
                type="date"
                required
                min={todayIso()}
                lang={locale}
                aria-invalid={!effectiveValid}
                value={next.effectiveFrom}
                onChange={(e) => setNext((prev) => (prev ? { ...prev, effectiveFrom: e.target.value } : prev))}
              />
            </label>
            <div className="pa-grid-save-actions">
              <button type="button" className="btn-soft" onClick={cancel} disabled={saving}>
                {t('metering.grid.cancel')}
              </button>
              <button type="button" className="btn-primary" onClick={save} disabled={!canSave}>
                {t('metering.grid.save')}
              </button>
            </div>
            <p className={versionValid && effectiveValid ? 'pa-grid-hint' : 'pa-grid-hint ko'}>
              {versionValid && effectiveValid ? t('metering.grid.versionHint') : t('metering.grid.versionInvalid')}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
