'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { TranslationKey } from '@/i18n/translations';
import { apiPost } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { useApiErrorMessage } from '@/lib/error-message';
import { fetchAllPages } from '@/lib/paginate';
import { CommissionCase, RecoursItem } from '@/lib/types';

/**
 * Saisine de la Commission (Art. 24) pour un recours transmis en commission
 * (`POST /commission/cases`, privilège `exchange`). Le backend reste seul
 * juge : recours à l'état COMMISSION, un seul dossier par recours, séance
 * jamais dans le passé (défaut +14 jours). Si le dossier existe déjà, sa
 * référence et sa phase réelles sont affichées avec un lien vers le rôle.
 */
export function CommissionSeizure({ recours }: { recours: RecoursItem }) {
  const { t } = useI18n();
  const { hasPrivilege } = useAuth();
  const { toast } = useToast();
  const errorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const [motif, setMotif] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');

  const casesQuery = useQuery({
    queryKey: ['commission', 'cases', 'all-for-recours'],
    queryFn: () => fetchAllPages<CommissionCase>('/commission/cases'),
  });
  const existing = casesQuery.data?.items.find((c) => c.recoursId === recours.id);
  const canSeize = hasPrivilege('exchange');

  const mutation = useMutation({
    mutationFn: () =>
      apiPost<CommissionCase>('/commission/cases', {
        recoursId: recours.id,
        motif: motif.trim(),
        scheduledAt: scheduledAt ? new Date(`${scheduledAt}T09:00:00`).toISOString() : undefined,
      }),
    onSuccess: (created) => {
      setMotif('');
      setScheduledAt('');
      toast(t('exchanges.commission.toast.ok').replace('{ref}', created.reference), 'ok');
      void queryClient.invalidateQueries({ queryKey: ['commission'] });
    },
    onError: (err: unknown) => toast(errorMessage(err, t('exchanges.commission.toast.error')), 'ko'),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!motif.trim() || mutation.isPending) return;
    mutation.mutate();
  }

  return (
    <div className="ex-block">
      <strong className="ex-block-title">{t('exchanges.commission.title')}</strong>
      {casesQuery.isLoading ? (
        <p className="muted">{t('common.loading')}</p>
      ) : existing ? (
        <p className="note ok">
          {t('exchanges.commission.existing')} <span className="mono">{existing.reference}</span> —{' '}
          {t(`commission.status.${existing.status}` as TranslationKey)}. <Link href="/commission">{t('exchanges.commission.open')}</Link>
        </p>
      ) : !canSeize ? (
        <p className="note warn">{t('common.forbidden')}</p>
      ) : (
        <form onSubmit={submit}>
          <p className="ex-section-sub">{t('exchanges.commission.intro')}</p>
          <label htmlFor="commission-motif" className="ex-label">
            {t('exchanges.commission.motif')}
          </label>
          <input id="commission-motif" className="ex-input" type="text" maxLength={255} required value={motif} onChange={(e) => setMotif(e.target.value)} />
          <label htmlFor="commission-date" className="ex-label">
            {t('exchanges.commission.scheduledAt')}
          </label>
          <input id="commission-date" className="ex-input" type="date" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          <div className="ex-actions">
            <button type="submit" className="btn-primary ex-action" disabled={!motif.trim() || mutation.isPending}>
              {mutation.isPending ? t('common.loading') : t('exchanges.commission.submit')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
