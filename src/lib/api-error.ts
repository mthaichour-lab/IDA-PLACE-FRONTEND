/** Forme normalisée des erreurs API — B.11/C.4 : {code, message, details}. */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Messages présentés à l'utilisateur — SEC-50.
 *
 * - 5xx, réseau, 401, 413, 429 : message générique, jamais le texte du serveur
 *   (pile, requête SQL, nom d'hôte…).
 * - Autres 4xx (400, 403, 404, 409, 422) : le message métier du backend est
 *   conservé s'il a l'allure d'un message destiné à l'utilisateur (ex. 403
 *   RECOURS_OUVERT, 409 « quatre yeux ») ; sinon message générique.
 */
export const GENERIC_MESSAGES = {
  network: 'Serveur injoignable. Vérifiez votre connexion puis réessayez.',
  unauthorized: 'Votre session a expiré : reconnexion en cours.',
  forbidden: 'Action non autorisée pour votre profil.',
  notFound: 'Élément introuvable.',
  conflict: 'Action impossible dans l’état actuel du dossier.',
  rejected: 'Requête refusée par le serveur.',
  tooManyRequests: 'Trop de requêtes : patientez quelques instants avant de réessayer.',
  tooLarge: 'Fichier ou contenu trop volumineux.',
  unavailable: 'Service momentanément indisponible. Réessayez dans quelques minutes.',
  server: 'Une erreur interne est survenue. Réessayez plus tard.',
} as const;

const TECHNICAL_HINTS =
  /(exception|stack|trace|\bat\s+\S+\s+\(|\.(ts|js):\d|sql|select\s.+\sfrom|insert\s+into|update\s+\S+\s+set|delete\s+from|syntax error|typeerror|referenceerror|econn|enotfound|etimedout|mikro|postgres|prisma|redis|cannot (get|post|put|patch|delete)\s|internal server error|undefined|\bnull\b)/i;

/** Un message serveur affichable tel quel : texte court, sur une ligne, sans indice technique. */
export function isDisplayableServerMessage(message: unknown): message is string {
  return typeof message === 'string' && message.trim().length > 0 && message.length <= 300 && !/[\r\n]/.test(message) && !TECHNICAL_HINTS.test(message);
}

export function userMessage(status: number, body: Partial<ApiErrorBody> | undefined): string {
  if (status === 0) return GENERIC_MESSAGES.network;
  if (status === 401) return GENERIC_MESSAGES.unauthorized;
  if (status === 429) return GENERIC_MESSAGES.tooManyRequests;
  if (status === 413) return GENERIC_MESSAGES.tooLarge;
  if (status === 502 || status === 503 || status === 504) return GENERIC_MESSAGES.unavailable;
  if (status >= 500) return GENERIC_MESSAGES.server;
  if (isDisplayableServerMessage(body?.message)) return body.message;
  if (status === 403) return GENERIC_MESSAGES.forbidden;
  if (status === 404) return GENERIC_MESSAGES.notFound;
  if (status === 409) return GENERIC_MESSAGES.conflict;
  return GENERIC_MESSAGES.rejected;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(userMessage(status, body));
    this.name = 'ApiError';
    this.status = status;
    this.code = typeof body?.code === 'string' ? body.code : 'UNKNOWN';
    // Les détails techniques d'une erreur serveur ne sont jamais conservés côté interface.
    this.details = status >= 400 && status < 500 ? body?.details : undefined;
  }
}
