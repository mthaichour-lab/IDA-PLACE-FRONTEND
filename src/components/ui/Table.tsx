'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
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
  selectedKey,
}: {
  columns: Column<T>[];
  rows: T[];
  page: number;
  total: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
  onRowClick?: (row: T) => void;
  getRowKey: (row: T) => string;
  /** Ligne mise en évidence (sélection courante d'un écran maître-détail). */
  selectedKey?: string;
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
                <tr
                  key={getRowKey(row)}
                  className={[onRowClick ? 'click' : '', selectedKey !== undefined && selectedKey === getRowKey(row) ? 'selected' : ''].filter(Boolean).join(' ') || undefined}
                  onClick={() => onRowClick?.(row)}
                >
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
          {total === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} {t('common.of')} {total} · {t('common.page')} {page} / {pageCount}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" aria-label={t('common.previous')} disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
          </button>
          <button type="button" aria-label={t('common.next')} disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
            <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
