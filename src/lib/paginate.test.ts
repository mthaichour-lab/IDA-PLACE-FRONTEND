import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_MAX_PAGE_SIZE, fetchAllPages } from './paginate';

/** API simulée : `total` éléments, pagination réelle, 400 au-delà de 100 par page (comme le backend SEC-13). */
function stubPaginatedApi(total: number) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const page = Number(url.searchParams.get('page'));
    const pageSize = Number(url.searchParams.get('pageSize'));
    if (pageSize > 100) return new Response(JSON.stringify({ code: 'VALIDATION', message: 'pageSize > 100' }), { status: 400 });
    const start = (page - 1) * pageSize;
    const items = Array.from({ length: Math.max(0, Math.min(pageSize, total - start)) }, (_, i) => ({ n: start + i }));
    return new Response(JSON.stringify({ page, total, items }), { status: 200 });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchAllPages (SEC-13)', () => {
  it('lit toutes les pages par 100 et jamais au-delà', async () => {
    const fetchFn = stubPaginatedApi(250);
    const res = await fetchAllPages<{ n: number }>('/recours', { filter: 'REGLE' });
    expect(res.items).toHaveLength(250);
    expect(res.items[249]).toEqual({ n: 249 });
    expect(res.truncated).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    for (const [input] of fetchFn.mock.calls) {
      const url = new URL(String(input));
      expect(Number(url.searchParams.get('pageSize'))).toBeLessThanOrEqual(API_MAX_PAGE_SIZE);
      expect(url.searchParams.get('filter')).toBe('REGLE');
    }
  });

  it('s’arrête au plafond et signale la troncature', async () => {
    const fetchFn = stubPaginatedApi(5_000);
    const res = await fetchAllPages('/fraud/cases', {}, { maxItems: 300 });
    expect(res.items).toHaveLength(300);
    expect(res.total).toBe(5_000);
    expect(res.truncated).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('ramène une taille de page demandée trop grande à 100', async () => {
    const fetchFn = stubPaginatedApi(10);
    await fetchAllPages('/admin/users', {}, { pageSize: 10_000 });
    expect(new URL(String(fetchFn.mock.calls[0][0])).searchParams.get('pageSize')).toBe('100');
  });

  it('liste vide : un seul appel', async () => {
    const fetchFn = stubPaginatedApi(0);
    const res = await fetchAllPages('/x');
    expect(res).toEqual({ page: 1, total: 0, items: [], truncated: false });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
