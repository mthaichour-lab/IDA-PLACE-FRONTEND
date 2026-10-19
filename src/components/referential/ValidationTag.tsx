import { Tag, TagTone } from '@/components/ui/Tag';
import { useI18n } from '@/i18n/provider';
import { TranslationKey } from '@/i18n/translations';

type ValidationStatus = 'STANDARD_A_CONFIRMER' | 'SAISI' | 'VALIDE_UAR' | 'ARCHIVE';

const VALIDATION_TAGS: Record<ValidationStatus, { tone: TagTone; label: TranslationKey }> = {
  STANDARD_A_CONFIRMER: { tone: 'warn', label: 'referential.validation.STANDARD_A_CONFIRMER' },
  SAISI: { tone: 'warn', label: 'referential.validation.SAISI' },
  VALIDE_UAR: { tone: 'ok', label: 'referential.validation.VALIDE_UAR' },
  ARCHIVE: { tone: 'a', label: 'referential.validation.ARCHIVE' },
};

/** Statut de validation UAR d'une valeur de référentiel (circonstance, motif d'opposition, référence IRSAM). */
export function ValidationTag({ status }: { status: ValidationStatus }) {
  const { t } = useI18n();
  const tag = VALIDATION_TAGS[status];
  return <Tag tone={tag.tone}>{t(tag.label)}</Tag>;
}
