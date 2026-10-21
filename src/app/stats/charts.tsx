'use client';

import type { ReactNode } from 'react';

/**
 * Graphiques propres à l'écran 11 (Statistiques de la place) — SVG/HTML
 * minimalistes, couleurs uniquement via tokens. Aucun calcul métier ici :
 * on ne fait que dessiner les séries reçues de l'API.
 */

/** Pas « rond » pour ~4 intervalles d'axe (1, 2, 2.5, 3, 5 × 10^k). */
export function niceStep(max: number, intervals = 4): number {
  if (max <= 0) return 1;
  const raw = max / intervals;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const nice = [1, 2, 2.5, 3, 5, 10].find((n) => n >= norm) ?? 10;
  return Math.max(1, nice * mag);
}

/**
 * Rampe de couleur de la carte en tuiles (0..1) : menthe → teal → teal profond,
 * par mélange de tokens (le thème sombre suit les tokens).
 */
export function rampColor(intensity: number): string {
  const i = Math.max(0, Math.min(1, intensity));
  if (i <= 0) return 'var(--k-mint)';
  if (i <= 1 / 3) return `color-mix(in srgb, var(--k-acc) ${Math.round(i * 3 * 100)}%, var(--k-mint))`;
  if (i <= 2 / 3) return `color-mix(in srgb, var(--k-pri) ${Math.round((i - 1 / 3) * 3 * 100)}%, var(--k-acc))`;
  return `color-mix(in srgb, var(--k-head) ${Math.round((i - 2 / 3) * 3 * 55)}%, var(--k-pri))`;
}

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  dashed?: boolean;
  values: number[];
}

/** Multi-courbes « Activité mensuelle » (maquette) : grille horizontale, points cerclés, légende en dessous. */
export function LineChart({ labels, series, ariaLabel }: { labels: string[]; series: LineSeries[]; ariaLabel: string }) {
  const W = 460;
  const H = 190;
  const padL = 30;
  const padR = 12;
  const padT = 10;
  const padB = 24;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const step = niceStep(max);
  const top = step * Math.ceil(max / step);
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const x = (i: number) => padL + (labels.length <= 1 ? innerW / 2 : (i * innerW) / (labels.length - 1));
  const y = (v: number) => padT + innerH - (v / top) * innerH;

  return (
    <div className="st-line">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} preserveAspectRatio="xMidYMid meet">
        {ticks.map((tv) => (
          <g key={tv}>
            <line x1={padL} x2={W - padR} y1={y(tv)} y2={y(tv)} className="st-line-grid" />
            <text x={padL - 8} y={y(tv) + 3} textAnchor="end" className="st-line-tick">
              {tv}
            </text>
          </g>
        ))}
        {labels.map((l, i) => (
          <text key={l + i} x={x(i)} y={H - 6} textAnchor="middle" className="st-line-xlab">
            {l}
          </text>
        ))}
        {series.map((s) => (
          <g key={s.key}>
            <polyline
              points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
              fill="none"
              stroke={s.color}
              strokeWidth={s.key === series[0]?.key ? 2.2 : 1.8}
              strokeDasharray={s.dashed ? '5 4' : undefined}
              strokeLinejoin="round"
            />
            {s.values.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r={3} fill="var(--paper)" stroke={s.color} strokeWidth={1.6}>
                <title>{`${s.label} · ${labels[i]} : ${v}`}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
      <div className="st-line-legend">
        {series.map((s) => (
          <span key={s.key}>
            <i aria-hidden="true" className={s.dashed ? 'dashed' : undefined} style={{ borderColor: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export interface StackItem {
  key: string;
  label: string;
  /** Part de la série principale, en %, ou null si le mois n'a aucune déclaration avec canal. */
  pct: number | null;
  title: string;
}

/** Barres empilées verticales (part principale en bas, reste en gris), % inscrit dans la barre. */
export function StackedBars({ items, legend }: { items: StackItem[]; legend: ReactNode }) {
  return (
    <div className="st-stack">
      <div className="st-stack-bars">
        {items.map((it) => (
          <div key={it.key} className="st-stack-col" title={it.title}>
            <div className={`st-stack-bar${it.pct === null ? ' empty' : ''}`}>
              {it.pct !== null && it.pct > 0 ? (
                <div className="st-stack-fill" style={{ height: `${Math.max(it.pct, 0)}%` }}>
                  <span>{Math.round(it.pct)}</span>
                </div>
              ) : null}
            </div>
            <span className="st-stack-lab">{it.label}</span>
          </div>
        ))}
      </div>
      <div className="st-legend">{legend}</div>
    </div>
  );
}

export interface HBarItem {
  code: string;
  label?: string;
  count: number;
}

/** Liste de barres horizontales « code + libellé · barre · compte » (Cas de barème, Catégories). */
export function HBarList({ items, locale }: { items: HBarItem[]; locale: string }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="st-hbars">
      {items.map((i) => (
        <div key={i.code} className="st-hbar-row" title={i.label ? `${i.code} — ${i.label} : ${i.count}` : undefined}>
          <span className="st-hbar-name">
            <b>{i.code}</b>
            {i.label ? <span> {i.label}</span> : null}
          </span>
          <span className="st-hbar-track">
            <span style={{ width: `${(i.count / max) * 100}%` }} />
          </span>
          <span className="st-hbar-count">{i.count.toLocaleString(locale)}</span>
        </div>
      ))}
    </div>
  );
}
