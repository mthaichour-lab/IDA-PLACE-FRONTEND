'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { TranslationKey } from '@/i18n/translations';
import { apiPath, apiPost } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { useApiErrorMessage } from '@/lib/error-message';
import { isCompanyActor } from '@/lib/recours-actions';
import { CommissionCase, Sanction } from '@/lib/types';

const OUTCOMES = ['RECOURS_FONDE', 'RECOURS_REJETE'] as const;
const SANCTION_TYPES = ['AVERTISSEMENT', 'SUSPENSION'] as const;

/**
 * Instruction → délibéré → prononcé (Art. 24) : `POST /commission/cases/:id/
 * deliberate` puis `/decide` (privilège `decide`, rôle place). Les
 * transitions sont validées par le backend (A_INSTRUIRE → EN_DELIBERE →
 * PRONONCE) ; l'écran ne propose que l'étape suivante de l'état réel.
 */
export function DecisionBox({ commissionCase, onUpdated }: { commissionCase: CommissionCase; onUpdated: (c: CommissionCase) => void }) {
  const { t } = useI18n();
  const { me, hasPrivilege } = useAuth();
  const { toast } = useToast();
  const errorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number] | ''>('');
  const [motif, setMotif] = useState('');
  const canDecide = !!me && !isCompanyActor(me) && hasPrivilege('decide');

  useEffect(() => {
    setOutcome('');
    setMotif('');
  }, [commissionCase.id]);

  function done(updated: CommissionCase, key: TranslationKey) {
    onUpdated(updated);
    void queryClient.invalidateQueries({ queryKey: ['commission'] });
    void queryClient.invalidateQueries({ queryKey: ['recours'] });
    toast(t(key), 'ok');
  }

  const deliberate = useMutation({
    mutationFn: () => apiPost<CommissionCase>(apiPath`/commission/cases/${commissionCase.id}/deliberate`, {}),
    onSuccess: (c) => done(c, 'commission.decide.toast.deliberateOk'),
    onError: (err: unknown) => toast(errorMessage(err, t('commission.decide.toast.error')), 'ko'),
  });
  const decide = useMutation({
    mutationFn: () => apiPost<CommissionCase>(apiPath`/commission/cases/${commissionCase.id}/decide`, { outcome, motif: motif.trim() || undefined }),
    onSuccess: (c) => done(c, 'commission.decide.toast.decideOk'),
    onError: (err: unknown) => toast(errorMessage(err, t('commission.decide.toast.error')), 'ko'),
  });

  const status = commissionCase.status;
  const decision = commissionCase.decision;

  return (
    <div className="cm-box">
      <h3>{t('commission.decide.title')}</h3>
      {decision ? (
        <p className="note ok">
          <strong>{t(`commission.decide.outcome.${decision.outcome}` as TranslationKey)}</strong>
          {decision.motif ? ` — ${decision.motif}` : ''}
        </p>
      ) : null}
      {!canDecide ? <p className="note warn">{t('commission.forbidden.decide')}</p> : null}

      {status === 'A_INSTRUIRE' ? (
        <>
          <p className="cm-hint">{t('commission.decide.deliberateHint')}</p>
          <div className="cm-actions">
            <button type="button" className="btn-primary" disabled={!canDecide || deliberate.isPending} onClick={() => deliberate.mutate()}>
              {t('commission.decide.deliberate')}
            </button>
          </div>
        </>
      ) : null}

      {status === 'EN_DELIBERE' ? (
        <>
          <fieldset className="cm-outcomes" disabled={!canDecide}>
            <legend>{t('commission.decide.outcome')}</legend>
            {OUTCOMES.map((o) => (
              <label key={o}>
                <input type="radio" name="decide-outcome" value={o} checked={outcome === o} onChange={() => setOutcome(o)} />
                {t(`commission.decide.outcome.${o}` as TranslationKey)}
              </label>
            ))}
          </fieldset>
          <div className="cm-form">
            <label htmlFor="decide-motif">{t('commission.decide.motif')}</label>
            <textarea id="decide-motif" rows={3} maxLength={2000} value={motif} onChange={(e) => setMotif(e.target.value)} disabled={!canDecide} />
          </div>
          <div className="cm-actions">
            <button type="button" className="btn-primary" disabled={!canDecide || !outcome || decide.isPending} onClick={() => decide.mutate()}>
              {t('commission.decide.submit')}
            </button>
          </div>
        </>
      ) : null}

    </div>
  );
}

/**
 * Proposition de sanction disciplinaire (avertissement / suspension) —
 * `POST /commission/cases/:id/sanction` (privilège `sanction`, rôle place),
 * après décision prononcée et PV signé ; prononcée seulement au contreseing
 * d'un second membre (onglet Sanctions).
 */
export function SanctionBox({ commissionCase }: { commissionCase: CommissionCase }) {
  const { t } = useI18n();
  const { me, hasPrivilege } = useAuth();
  const { toast } = useToast();
  const errorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const [company, setCompany] = useState<'A' | 'B'>('A');
  const [type, setType] = useState<(typeof SANCTION_TYPES)[number]>('AVERTISSEMENT');
  const [reason, setReason] = useState('');
  const canSanction = !!me && !isCompanyActor(me) && hasPrivilege('sanction');

  useEffect(() => {
    setCompany('A');
    setType('AVERTISSEMENT');
    setReason('');
  }, [commissionCase.id]);

  const mutation = useMutation({
    mutationFn: () =>
      apiPost<Sanction>(apiPath`/commission/cases/${commissionCase.id}/sanction`, {
        companyCode: company === 'A' ? commissionCase.companyA : commissionCase.companyB,
        type,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      setReason('');
      void queryClient.invalidateQueries({ queryKey: ['commission', 'sanctions'] });
      toast(t('commission.sanction.toast.ok'), 'ok');
    },
    onError: (err: unknown) => toast(errorMessage(err, t('commission.sanction.toast.error')), 'ko'),
  });

  return (
    <div className="cm-box">
      <h3>{t('commission.sanction.title')}</h3>
      {!canSanction ? <p className="note warn">{t('commission.forbidden.sanction')}</p> : null}
      {canSanction && !commissionCase.pv ? <p className="cm-hint">{t('commission.sanction.requiresPv')}</p> : null}
      <div className="cm-form">
        <label htmlFor="sanction-company">{t('commission.action.penalty.company')}</label>
        <select id="sanction-company" value={company} onChange={(e) => setCompany(e.target.value as 'A' | 'B')} disabled={!canSanction}>
          <option value="A">{commissionCase.companyA}</option>
          <option value="B">{commissionCase.companyB}</option>
        </select>
        <label htmlFor="sanction-type">{t('commission.sanction.type')}</label>
        <select id="sanction-type" value={type} onChange={(e) => setType(e.target.value as (typeof SANCTION_TYPES)[number])} disabled={!canSanction}>
          {SANCTION_TYPES.map((s) => (
            <option key={s} value={s}>
              {t(`commission.sanction.type.${s}` as TranslationKey)}
            </option>
          ))}
        </select>
        <label htmlFor="sanction-reason">{t('commission.action.penalty.reason')}</label>
        <input id="sanction-reason" type="text" maxLength={255} value={reason} onChange={(e) => setReason(e.target.value)} disabled={!canSanction} />
      </div>
      <div className="cm-actions">
        <button type="button" className="btn-outline" disabled={!canSanction || !commissionCase.pv || !reason.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
          {t('commission.sanction.submit')}
        </button>
      </div>
    </div>
  );
}
