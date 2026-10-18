'use client';

import { useI18n } from '@/i18n/provider';
import { MeteringHistoryPoint } from '@/lib/types';

function monthShort(period: string): string {
  return period.slice(5); // "2026-03" -> "03"
}

/**
 * Graphe "Consommation mensuelle" (écran 10, guide illustré) — 10 mois
 * d'une métrique sélectionnée (`PriceGrid.metrics`), ligne de quota inclus
 * en pointillés + dernier mois (courant, partiel) rendu plus clair — pure
 * convention visuelle, la valeur elle-même vient déjà à ~45% du mesuré
 * courant côté back (`buildMeasuredHistory`), on ne la retouche pas ici.
 *
 * SVG natif, même esprit que `components/ui/BarChart.tsx` (A.1 : pas de
 * librairie graphique lourde) — composant dédié plutôt qu'une extension de
 * `BarChart` : la ligne de référence et son étiquette n'ont de sens que
 * pour ce graphe-ci, les autres usages de `BarChart` (`/stats` notamment)
 * n'en ont pas besoin.
 */
export function ConsumptionHistoryChart({
  points,
  quota,
  unit,
  height = 160,
}: {
  points: MeteringHistoryPoint[];
  quota: number;
  unit: string;
  height?: number;
}) {
  const { t, locale } = useI18n();
  const baseline = height - 20;
  const max = Math.max(1, quota, ...points.map((p) => Math.abs(p.value)));
  const barWidth = 100 / Math.max(1, points.length);
  const quotaY = baseline - (quota / max) * baseline;
  const lastYear = points.length > 0 ? points[points.length - 1].period.slice(0, 4) : '';

  return (
    <div>
      <div style={{ position: 'relative', height }}>
        <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ width: '100%', height }} role="img" aria-label={t('metering.history.title')}>
          {points.map((p, i) => {
            const h = (Math.abs(p.value) / max) * baseline;
            const x = i * barWidth + barWidth * 0.15;
            const w = barWidth * 0.7;
            const y = baseline - h;
            const isCurrentPartialMonth = i === points.length - 1;
            return (
              <rect
                key={p.period}
                x={x}
                y={y}
                width={w}
                height={Math.max(1, h)}
                fill="var(--k-pri-2)"
                opacity={isCurrentPartialMonth ? 0.45 : 1}
                rx={1}
              />
            );
          })}
          {quota > 0 ? <line x1={0} y1={quotaY} x2={100} y2={quotaY} stroke="var(--warn)" strokeDasharray="2,1.4" strokeWidth={0.6} /> : null}
          <line x1={0} y1={baseline} x2={100} y2={baseline} stroke="var(--rule-strong)" strokeWidth={0.5} />
        </svg>
        {quota > 0 ? (
          <span
            style={{
              position: 'absolute',
              right: 2,
              top: Math.max(0, quotaY - 14),
              fontSize: 'var(--k-fs-xs)',
              color: 'var(--warn)',
              background: 'var(--paper)',
              padding: '0 4px',
              whiteSpace: 'nowrap',
            }}
          >
            {t('metering.history.quota')} {quota.toLocaleString(locale)}
          </span>
        ) : null}
      </div>
      <div style={{ display: 'flex' }}>
        {points.map((p) => (
          <span key={p.period} style={{ flex: 1, textAlign: 'center', fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)' }}>
            {monthShort(p.period)}
          </span>
        ))}
      </div>
      <p style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)', marginTop: 'var(--s-2)', marginBottom: 0 }}>
        {lastYear} — {t('metering.history.caption')} · {t('metering.history.unitLabel')}&nbsp;: {unit}
      </p>
    </div>
  );
}
