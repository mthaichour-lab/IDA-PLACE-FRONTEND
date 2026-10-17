/**
 * Génère les 12 derniers mois au format `YYYY-MM` (sélecteur `/metering`,
 * écrans 10 et 14) — simple utilitaire de date, PAS une donnée métier (le
 * contenu réel de chaque mois vient toujours de l'API).
 */
export function buildRecentPeriods(count = 12, from: Date = new Date()): string[] {
  const periods: string[] = [];
  const d = new Date(from.getFullYear(), from.getMonth(), 1);
  for (let i = 0; i < count; i++) {
    periods.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() - 1);
  }
  return periods;
}
