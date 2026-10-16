/** En-tête de page `.folio-h` (A.3) : badge module + titre + sous-titre + actions. */
export function FolioHeader({
  badge,
  title,
  subtitle,
  actions,
}: {
  badge: string;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="folio-h">
      <div>
        <span className="folio-badge">{badge}</span>
        <h1>{title}</h1>
        {subtitle ? <p className="folio-sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="folio-actions">{actions}</div> : null}
    </div>
  );
}
