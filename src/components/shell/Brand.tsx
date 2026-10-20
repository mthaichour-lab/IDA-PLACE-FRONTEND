/**
 * Marques de l'en-tête (A.3) — logo FinLab (carrés de la charte) et logo
 * IDA Place (document validé). SVG en ligne : aucune ressource externe,
 * compatible avec la CSP stricte (SEC-22).
 */
export function FinLabMark({ size = 22 }: { size?: number }) {
  const cell = size / 2 - 1;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
      <rect x="0" y="0" width={cell} height={cell} rx="1.5" fill="#c9d0cd" />
      <rect x={cell + 2} y="0" width={cell} height={cell} rx="1.5" fill="#ffffff" />
      <rect x="0" y={cell + 2} width={cell} height={cell} rx="1.5" fill="#8f9794" />
      <rect x={cell + 2} y={cell + 2} width={cell} height={cell} rx="1.5" fill="#f26b21" />
    </svg>
  );
}

export function FinLabLogo({ size = 22, tone = 'light' }: { size?: number; tone?: 'light' | 'dark' }) {
  return (
    <span className={`finlab-logo ${tone}`}>
      <FinLabMark size={size} />
      <span>FinLab</span>
    </span>
  );
}

export function IdaPlaceMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden="true" focusable="false">
      <rect x="1.5" y="1.5" width="27" height="27" rx="7" fill="none" stroke="var(--brand-green)" strokeWidth="2.2" />
      <path d="M10 7.5h7l4 4V22a1 1 0 0 1-1 1H10a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1Z" fill="none" stroke="var(--brand-green)" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M12 16.2l2.2 2.2 4.3-4.6" fill="none" stroke="var(--brand-green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
