'use client';

import { useI18n } from '@/i18n/provider';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
}

/**
 * Tableau générique transverse `.t` (A.3), pagination FIXE 6 lignes/page
 * (A.5). La pagination est pilotée par le parent (`page`/`total`), pour
 * fonctionner aussi bien avec une liste déjà paginée côté API
 * (`{page,total,items}`, B.11) qu'avec un tableau local.
 */
export function Table<T>({
  columns,
  rows,
  page,
  total,
  pageSize = 6,
  onPageChange,
  onRowClick,
  getRowKey,
}: {
  columns: Column<T>[];
  rows: T[];
  page: number;
  total: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
  onRowClick?: (row: T) => void;
  getRowKey: (row: T) => string;
}) {
  const { t } = useI18n();
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <div className="t-wrap">
        <table className="t">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key}>{c.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
                  {t('common.noData')}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={getRowKey(row)} className={onRowClick ? 'click' : undefined} onClick={() => onRowClick?.(row)}>
                  {columns.map((c) => (
                    <td key={c.key}>{c.render(row)}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <span>
          {t('common.page')} {page} {t('common.of')} {pageCount} · {total}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            {t('common.previous')}
          </button>
          <button type="button" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
            {t('common.next')}
          </button>
        </div>
      </div>
    </div>
  );
}
