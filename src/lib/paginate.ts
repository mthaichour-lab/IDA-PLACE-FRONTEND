import { apiGet, QueryParams } from './api-client';
import { Paginated } from './types';

/** Taille de page maximale acceptée par l'API (`@Max(100)` sur `pageSize`, SEC-13) : au-delà, 400. */
export const API_MAX_PAGE_SIZE = 100;

/**
 * Plafond des lectures « population complète » (SEC-13) : 20 pages de 100.
 * Au-delà, la liste est tronquée (`truncated: true`) et l'écran le signale
 * — un besoin de volume supérieur appelle un agrégat ou un filtre côté API,
 * pas un chargement massif dans le navigateur.
 */
export const FETCH_ALL_MAX_ITEMS = 2_000;

export interface FetchAllResult<T> extends Paginated<T> {
  /** `true` si le plafond a été atteint avant d'avoir lu `total` éléments. */
  truncated: boolean;
}

/**
 * Charge les pages successives d'une liste paginée (100 éléments par page)
 * jusqu'à `total` ou jusqu'au plafond `maxItems` — remplace les anciens
 * appels à `pageSize` 10 000 / 100 000, refusés par l'API.
 *
 * Utilisé uniquement là où l'écran doit reclasser ou compter TOUTE la
 * population côté client (sous-onglets REGLE de `/exchanges`, KPI de
 * `/fraude` et `/params`, recherche dans les parcours de `/monitoring`) ;
 * partout ailleurs, la pagination serveur (6 lignes/page) reste la règle.
 */
export async function fetchAllPages<T>(
  path: string,
  query: QueryParams = {},
  { maxItems = FETCH_ALL_MAX_ITEMS, pageSize = API_MAX_PAGE_SIZE }: { maxItems?: number; pageSize?: number } = {},
): Promise<FetchAllResult<T>> {
  const size = Math.min(pageSize, API_MAX_PAGE_SIZE);
  const maxPages = Math.max(1, Math.ceil(maxItems / size));
  const items: T[] = [];
  let total = 0;
  for (let page = 1; page <= maxPages; page++) {
    const res = await apiGet<Paginated<T>>(path, { ...query, page, pageSize: size });
    total = res.total;
    items.push(...res.items);
    if (res.items.length < size || items.length >= total) break;
  }
  const kept = items.slice(0, maxItems);
  return { page: 1, total, items: kept, truncated: kept.length < total };
}
