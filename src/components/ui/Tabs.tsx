'use client';

export interface TabItem {
  key: string;
  label: string;
  count?: number;
}

/** Composant transverse `.tabs[role=tablist]` (A.3), avec compteurs par onglet. */
export function Tabs({ items, activeKey, onChange }: { items: TabItem[]; activeKey: string; onChange: (key: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((item) => (
        <button
          key={item.key}
          role="tab"
          type="button"
          className="tab"
          aria-selected={item.key === activeKey}
          onClick={() => onChange(item.key)}
        >
          {item.label}
          {item.count !== undefined ? <span className="tab-count">{item.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
