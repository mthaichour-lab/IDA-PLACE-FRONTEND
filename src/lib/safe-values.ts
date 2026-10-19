import { API_BASE_URL } from './api-client';

/**
 * Valeurs de l'API utilisées dans le DOM — SEC-50 (constats S6-08 à S6-11).
 * Une donnée renvoyée par l'API peut provenir d'une autre compagnie : elle
 * n'est jamais injectée telle quelle dans un `href` ni dans un `style`.
 */

/**
 * Lien de document autorisé : `https:` ou `blob:` uniquement (jamais
 * `javascript:`, `data:`, `vbscript:`…). Un chemin relatif renvoyé par
 * l'API (stockage local de développement, `/api/v1/documents/local/…`) est
 * résolu sur l'origine de l'API. En développement seulement, `http:` est
 * toléré pour la seule origine de l'API locale.
 */
export function safeDocumentUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  let url: URL;
  try {
    url = API_BASE_URL ? new URL(raw, `${API_BASE_URL}/`) : new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol === 'https:' || url.protocol === 'blob:') return url.toString();
  if (process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && API_BASE_URL) {
    try {
      if (url.origin === new URL(API_BASE_URL).origin) return url.toString();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Couleur d'une compagnie : `#RRGGBB` strict, sinon la couleur neutre de repli. */
export function safeColor(raw: unknown, fallback = '#6A6E6D'): string {
  return typeof raw === 'string' && HEX_COLOR.test(raw) ? raw : fallback;
}
