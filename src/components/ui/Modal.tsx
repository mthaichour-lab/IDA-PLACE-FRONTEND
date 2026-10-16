'use client';

import { useEffect } from 'react';

/** Composant transverse `modal(o)` (A.3) : overlay `.ovl` + dialogue `.dlg`. */
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="ovl" role="presentation" onClick={onClose}>
      <div className="dlg" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="dlg-head">
          <strong>{title}</strong>
          <button type="button" aria-label="Fermer" onClick={onClose} className="icon-btn">
            ✕
          </button>
        </div>
        <div className="dlg-body">{children}</div>
        {footer ? <div className="dlg-foot">{footer}</div> : null}
      </div>
    </div>
  );
}
