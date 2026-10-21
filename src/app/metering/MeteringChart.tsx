'use client';

import { useI18n } from '@/i18n/provider';
import { MeteringHistoryPoint } from '@/lib/types';

/** Pas « rond » de l'axe vertical (1, 2, 2,5, 5 × 10^n) pour 4 intervalles. */
export function niceStep(max: number, intervals = 4): number {
  if (!(max > 0)) return 1;
  const raw = max / intervals;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const ratio = raw / mag;
  const nice = ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 2.5 ? 2.5 : ratio <= 5 ? 5 : 10;
  return nice * mag;
}

const W = 540;
const H = 196;
const PAD_L = 36;
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 22;

/**
 * Graphe « Consommation mensuelle » (écran 10, maquette r19) — 10 mois
 * d'une métrique (`GET /metering/{company}/{period}/history/{metric}`),
 * axe gradué, ligne de quota inclus en pointillés et dernier mois (en
 * cours, partiel) en barre claire. Pure mise en forme : les valeurs
 * viennent telles quelles de l'API. SVG natif (A.1 : pas de librairie
 * graphique lourde) — composant propre à l'écran, `ConsumptionHistoryChart`
 * (partagé) reste inchangé.
 */
export function MeteringChart({ points, quota, unit }: { points: MeteringHistoryPoint[]; quota: number; unit: string }) {
  const { t, locale } = useI18n();
  const top = Math.max(1, quota, ...points.map((p) => Math.abs(p.value)));
  const step = niceStep(top);
  const axisMax = Math.ceil(top / step) * step;
  const ticks = Array.from({ length: Math.round(axisMax / step) + 1 }, (_, i) => i * step);
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const y = (v: number) => PAD_T + plotH - (v / axisMax) * plotH;
  const slot = plotW / Math.max(1, points.length);
  const barW = slot * 0.62;
  const lastYear = points.length > 0 ? points[points.length - 1].period.slice(0, 4) : '';

  return (
    <div className="mtr-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('metering.history.title')}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} className={v === 0 ? 'mtr-axis' : 'mtr-gridline'} />
            <text x={PAD_L - 8} y={y(v) + 3} textAnchor="end" className="mtr-tick">
              {v.toLocaleString(locale)}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const h = (Math.abs(p.value) / axisMax) * plotH;
          const x = PAD_L + i * slot + (slot - barW) / 2;
          const partial = i === points.length - 1;
          return (
            <g key={p.period}>
              <rect x={x} y={PAD_T + plotH - h} width={barW} height={Math.max(1, h)} className={partial ? 'mtr-bar partial' : 'mtr-bar'}>
                <title>{`${p.period} : ${p.value.toLocaleString(locale)} ${unit}`}</title>
              </rect>
              <text x={x + barW / 2} y={H - 6} textAnchor="middle" className="mtr-tick">
                {p.period.slice(5)}
              </text>
            </g>
          );
        })}
        {quota > 0 ? (
          <>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(quota)} y2={y(quota)} className="mtr-quota" />
            <text x={W - PAD_R} y={y(quota) - 4} textAnchor="end" className="mtr-quota-label">
              {`${t('metering.history.quota')} ${quota.toLocaleString(locale)}`}
            </text>
          </>
        ) : null}
      </svg>
      <p className="mtr-caption">
        {lastYear} — {t('metering.history.caption')} · {t('metering.history.unitLabel')}&nbsp;: {unit}
      </p>
    </div>
  );
}
