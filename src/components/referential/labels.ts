import { TranslationKey } from '@/i18n/translations';
import { PopulationSourceType } from '@/lib/types';

/** Libellés des types de source de population — écran 12 (saisie) et écran 11 (infobulle des tuiles). */
export const POPULATION_SOURCE_LABELS: Record<PopulationSourceType, TranslationKey> = {
  RECENSEMENT_RGPH: 'referential.population.sourceType.RECENSEMENT_RGPH',
  ESTIMATION_ONS: 'referential.population.sourceType.ESTIMATION_ONS',
  AUTRE: 'referential.population.sourceType.AUTRE',
};
