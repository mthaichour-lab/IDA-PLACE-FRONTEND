/**
 * Affichage d'une date calendaire ISO `AAAA-MM-JJ` (férié, période IRSAM…).
 * `new Date('2026-03-20')` est minuit UTC : sans `timeZone: 'UTC'`, un
 * navigateur à l'ouest de Greenwich afficherait la veille, et le rendu
 * serveur pourrait différer du rendu client.
 */
export function formatIsoDay(iso: string, locale: string, month: 'long' | 'short' | '2-digit' = 'long'): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale, { day: 'numeric', month, year: 'numeric', timeZone: 'UTC' });
}

/** Année civile courante, en UTC (même référentiel que les dates ISO ci-dessus). */
export function currentUtcYear(): number {
  return new Date().getUTCFullYear();
}
