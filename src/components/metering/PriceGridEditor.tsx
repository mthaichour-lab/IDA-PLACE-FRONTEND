'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { PriceGrid } from '@/lib/types';

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
              <button type="button" onClick={save} disabled={saving} style={{ padding: '6px 12px', borderRadius: 'var(--k-r-s)', border: '1px solid var(--k-pri)', background: 'var(--k-pri)', color: '#fff', font: 'inherit', cursor: 'pointer' }}>
                {t('metering.grid.save')}
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setEditing(true)} style={{ padding: '6px 12px', borderRadius: 'var(--k-r-s)', border: '1px solid var(--rule-strong)', background: 'var(--paper)', color: 'var(--ink)', font: 'inherit', cursor: 'pointer' }}>
              {t('metering.grid.edit')}
            </button>
          )
        ) : null}
      </div>
      <div className="sheet-body">
        {!canEdit ? (
          <p style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)', marginTop: 0 }}>{t('metering.grid.readonly')}</p>
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
