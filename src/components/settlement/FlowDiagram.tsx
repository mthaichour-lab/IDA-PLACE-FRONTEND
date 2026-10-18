'use client';

import { CoChip } from '@/components/ui/CoChip';
import type { SettlementNet, SettlementPosition } from '@/lib/types';

export type FlowDiagramMode = 'multilateral' | 'bilateral';

export interface FlowDiagramProps {
  mode: FlowDiagramMode;
  /** Positions nettes multilatérales (`SettlementNet`, une par compagnie vis-à-vis de la place) — utilisé en mode "multilateral". */
  net: SettlementNet[];
  /** Positions bilatérales déjà nettées par paire (`SettlementPosition`, une seule direction par paire côté back) — utilisé en mode "bilateral". */
  positions: SettlementPosition[];
  /** Formatte un montant (valeur absolue) dans la devise de la page — réutilise `formatDzd` (page appelante). */
  formatAmount: (amount: number) => string;
  /** Message d'état vide (même idiome que `common.noData` ailleurs sur cette page), affiché si le tableau pertinent au mode courant est vide. */
  emptyLabel: string;
  /** Libellé du nœud central en mode "multilateral" (`t('quarter.flow.hub')`, côté appelant — composant non lié à `useI18n` pour rester testable en isolation). */
  hubLabel: string;
  size?: number;
}

function angleFor(i: number, n: number): number {
  return (Math.PI * 2 * i) / n - Math.PI / 2;
}

function pointAt(cx: number, cy: number, angle: number, r: number): [number, number] {
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

/** Raccourcit un segment [x1,y1]-[x2,y2] des deux côtés (pour que la ligne/flèche s'arrête au bord des cercles, pas à leur centre). */
function shrinkToward(x1: number, y1: number, x2: number, y2: number, startGap: number, endGap: number): [number, number, number, number] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  return [x1 + ux * startGap, y1 + uy * startGap, x2 - ux * endGap, y2 - uy * endGap];
}

function formatSigned(amount: number, formatAmount: (n: number) => string): string {
  if (amount === 0) return formatAmount(0);
  return `${amount > 0 ? '+' : '−'}${formatAmount(Math.abs(amount))}`;
}

/**
 * Diagramme circulaire des flux de règlement entre compagnies (écran 6
 * "Compensation trimestrielle", section additive 2026-10-18, sous la
 * matrice des positions brutes — point ouvert §11-6 du guide illustré,
 * mode à confirmer par l'UAR) — SVG natif, même esprit que `RadarChart`
 * (A.3) : pas de dépendance graphique lourde, même trig
 * `angle = i·2π/n - π/2` (démarre en haut, tourne dans le sens horaire).
 *
 * Mode "multilateral" : hub (la place / chambre de compensation) + UNE
 * position nette par compagnie (`SettlementNet`, même donnée que la table
 * "Positions nettes multilatérales" déjà affichée au-dessus sur cette
 * page). Choix délibéré du hub-and-spoke, PAS un ordre de règlement
 * pair-à-pair : la compensation multilatérale
 * (`computeMultilateralNetPositions`, back `settlement.rules.ts`) réduit
 * CHAQUE compagnie à une seule position vis-à-vis de la place, par
 * construction — il n'existe côté back AUCUNE donnée réelle "qui paie
 * qui" pour ce mode (voir le commentaire de cette fonction). Inventer un
 * algorithme glouton "plus gros débiteur paie plus gros créditeur"
 * fabriquerait une règle métier absente du back — jamais fait ici (règle
 * d'or du projet, voir HANDOFF.md).
 *
 * Mode "bilateral" : pas de hub, un cercle de compagnies, une flèche RÉELLE
 * par entrée `SettlementPosition` (déjà nettée par paire côté back,
 * `computeBilateralNetPositions` — `from`→`to` = la compagnie qui paie
 * (nette) → celle qui reçoit). Pas de position nette par nœud dans ce
 * mode (une compagnie peut avoir plusieurs flèches, une par contrepartie) :
 * le montant est donc étiqueté sur chaque flèche, pas sous le nœud.
 *
 * États vides honnêtes (jamais un diagramme fabriqué) : aucune compagnie
 * pertinente pour le mode courant (`net`/`positions` vide) → `emptyLabel`.
 */
export function FlowDiagram({ mode, net, positions, formatAmount, emptyLabel, hubLabel, size = 380 }: FlowDiagramProps) {
  const cx = size / 2;
  const cy = size / 2;
  const nodeRadius = 24;

  if (mode === 'multilateral') {
    const n = net.length;
    if (n === 0) {
      return <p style={{ color: 'var(--ink-3)' }}>{emptyLabel}</p>;
    }
    const hubRadius = 36;
    const circleRadius = size / 2 - nodeRadius - 36;
    const maxAbs = Math.max(1, ...net.map((p) => Math.abs(p.net)));
    const nodes = net.map((p, i) => {
      const [x, y] = pointAt(cx, cy, angleFor(i, n), circleRadius);
      return { ...p, x, y };
    });

    return (
      <div style={{ position: 'relative', width: '100%', maxWidth: size, aspectRatio: '1 / 1', margin: '0 auto' }}>
        <svg
          viewBox={`0 0 ${size} ${size}`}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          role="img"
          aria-label="Flux de règlement — netting multilatéral (hub-and-spoke, place au centre)"
        >
          <defs>
            <marker id="fd-arrow-ok" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 Z" fill="var(--ok)" />
            </marker>
            <marker id="fd-arrow-ko" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 Z" fill="var(--ko)" />
            </marker>
          </defs>
          <circle cx={cx} cy={cy} r={hubRadius} fill="var(--k-soft-2)" stroke="var(--rule-strong)" strokeWidth={1.5} />
          {nodes.map((node) => {
            if (node.net === 0) return null;
            const tone = node.net > 0 ? 'ok' : 'ko';
            const [x1, y1, x2, y2] =
              node.net > 0
                ? shrinkToward(cx, cy, node.x, node.y, hubRadius, nodeRadius + 10)
                : shrinkToward(node.x, node.y, cx, cy, nodeRadius, hubRadius + 10);
            const widthRatio = Math.abs(node.net) / maxAbs;
            return (
              <line
                key={`line-${node.code}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={tone === 'ok' ? 'var(--ok)' : 'var(--ko)'}
                strokeWidth={2 + widthRatio * 5}
                markerEnd={`url(#fd-arrow-${tone})`}
              />
            );
          })}
        </svg>
        <div
          data-testid="flow-hub"
          style={{ position: 'absolute', left: `${(cx / size) * 100}%`, top: `${(cy / size) * 100}%`, transform: 'translate(-50%, -50%)', textAlign: 'center' }}
        >
          <span className="mono" style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)', fontWeight: 600 }}>
            {hubLabel}
          </span>
        </div>
        {nodes.map((node) => (
          <div
            key={`node-${node.code}`}
            data-testid={`flow-node-${node.code}`}
            style={{ position: 'absolute', left: `${(node.x / size) * 100}%`, top: `${(node.y / size) * 100}%`, transform: 'translate(-50%, -50%)', textAlign: 'center' }}
          >
            <CoChip code={node.code} />
            <div
              className="mono"
              style={{ fontSize: 'var(--k-fs-xs)', color: node.net > 0 ? 'var(--ok)' : node.net < 0 ? 'var(--ko)' : 'var(--ink-3)', marginTop: 2, whiteSpace: 'nowrap' }}
            >
              {formatSigned(node.net, formatAmount)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // mode === 'bilateral'
  const codes = Array.from(new Set(positions.flatMap((p) => [p.from, p.to])));
  const n = codes.length;
  if (positions.length === 0 || n === 0) {
    return <p style={{ color: 'var(--ink-3)' }}>{emptyLabel}</p>;
  }
  const circleRadius = size / 2 - nodeRadius - 20;
  const maxAmount = Math.max(1, ...positions.map((p) => p.amount));
  const nodePoint = new Map(codes.map((c, i) => [c, pointAt(cx, cy, angleFor(i, n), circleRadius)] as const));
  const hasReverse = (from: string, to: string) => positions.some((p) => p.from === to && p.to === from);

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: size, aspectRatio: '1 / 1', margin: '0 auto' }}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        role="img"
        aria-label="Flux de règlement — netting bilatéral (pair à pair)"
      >
        <defs>
          <marker id="fd-arrow-neutral" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 Z" fill="var(--k-pri)" />
          </marker>
        </defs>
        {positions.map((p, i) => {
          const [fx, fy] = nodePoint.get(p.from) ?? [cx, cy];
          const [tx, ty] = nodePoint.get(p.to) ?? [cx, cy];
          const [x1, y1, x2, y2] = shrinkToward(fx, fy, tx, ty, nodeRadius, nodeRadius + 10);
          const curved = hasReverse(p.from, p.to);
          const widthRatio = p.amount / maxAmount;
          const strokeWidth = 2 + widthRatio * 5;
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;
          if (!curved) {
            return (
              <g key={`edge-${p.from}-${p.to}-${i}`} data-testid={`flow-edge-${p.from}-${p.to}`}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--k-pri)" strokeWidth={strokeWidth} markerEnd="url(#fd-arrow-neutral)" />
                <text x={midX} y={midY - 6} textAnchor="middle" fontSize={10} className="mono" fill="var(--ink-2)">
                  {formatAmount(p.amount)}
                </text>
              </g>
            );
          }
          const nx = -(y2 - y1);
          const ny = x2 - x1;
          const nlen = Math.sqrt(nx * nx + ny * ny) || 1;
          const offset = 18;
          const ctrlX = midX + (nx / nlen) * offset;
          const ctrlY = midY + (ny / nlen) * offset;
          return (
            <g key={`edge-${p.from}-${p.to}-${i}`} data-testid={`flow-edge-${p.from}-${p.to}`}>
              <path d={`M ${x1} ${y1} Q ${ctrlX} ${ctrlY} ${x2} ${y2}`} fill="none" stroke="var(--k-pri)" strokeWidth={strokeWidth} markerEnd="url(#fd-arrow-neutral)" />
              <text x={ctrlX} y={ctrlY} textAnchor="middle" fontSize={10} className="mono" fill="var(--ink-2)">
                {formatAmount(p.amount)}
              </text>
            </g>
          );
        })}
      </svg>
      {codes.map((code) => {
        const [x, y] = nodePoint.get(code) ?? [cx, cy];
        return (
          <div
            key={`node-${code}`}
            data-testid={`flow-node-${code}`}
            style={{ position: 'absolute', left: `${(x / size) * 100}%`, top: `${(y / size) * 100}%`, transform: 'translate(-50%, -50%)', textAlign: 'center' }}
          >
            <CoChip code={code} />
          </div>
        );
      })}
    </div>
  );
}
