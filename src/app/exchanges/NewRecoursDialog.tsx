'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { CoChip } from '@/components/ui/CoChip';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { apiPost } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { useApiErrorMessage } from '@/lib/error-message';
import { fetchAllPages } from '@/lib/paginate';
import { RecoursItem } from '@/lib/types';

/** Dossier tel que renvoyé par `GET /claims` (sous-ensemble utile à l'ouverture d'un recours). */
interface ClaimForRecours {
  id: string;
  numEconstat: string;
  company: string;
  counterpartyCompany?: string;
  accidentDate?: string;
  estimatedAmount?: number;
  expertAmount?: number;
  eligibilityVerdict?: string;
}

interface CompanyOption {
  code: string;
  name?: string;
  status?: string;
}

/** Montant réclamable d'un dossier : expertisé, à défaut estimé (même règle que `ClaimsService.openRecours`). */
function claimAmount(c: ClaimForRecours): number | undefined {
  const amount = c.expertAmount ?? c.estimatedAmount;
  return typeof amount === 'number' && Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

/**
 * Ouverture d'un recours — Annexe 2 « Demande d'indemnisation » (`POST
 * /recours`). L'assureur direct (créancier) présente sa demande contre la
 * partie tierce déclarée au dossier.
 *
 * Seuls les dossiers RECEVABLES sont proposés : de la compagnie demanderesse,
 * éligibles IDA, avec une partie tierce désignée, un montant, et sans
 * recours déjà ouvert. Le backend reste seul juge (assureur direct, partie
 * tierce, éligibilité, montant ≤ dossier et ≤ plafond conventionnel,
 * unicité) : ses refus sont affichés tels quels.
 *
 * Correspondant : la compagnie demanderesse est la sienne (B.7) ; rôle
 * place : choisie parmi les adhérents actifs.
 */
export function NewRecoursDialog({
  open,
  onClose,
  onCreated,
  companies,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (r: RecoursItem) => void;
  companies: CompanyOption[];
}) {
  const { t, locale } = useI18n();
  const { me } = useAuth();
  const { toast } = useToast();
  const errorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();

  const ownCompany = me?.company;
  const [from, setFrom] = useState(ownCompany ?? '');
  const [claimId, setClaimId] = useState('');
  const [amount, setAmount] = useState('');

  useEffect(() => {
    if (!open) return;
    setFrom(ownCompany ?? '');
    setClaimId('');
    setAmount('');
  }, [open, ownCompany]);

  const claimsQuery = useQuery({
    queryKey: ['claims', 'for-recours', from],
    queryFn: () => fetchAllPages<ClaimForRecours>('/claims', { company: from }),
    enabled: open && !!from,
  });
  const recoursQuery = useQuery({
    queryKey: ['recours', 'list', 'TOUS', 'all-for-opening'],
    queryFn: () => fetchAllPages<RecoursItem>('/recours', { filter: 'TOUS' }),
    enabled: open,
  });

  const candidates = useMemo(() => {
    const withRecours = new Set((recoursQuery.data?.items ?? []).map((r) => r.claimId));
    return (claimsQuery.data?.items ?? [])
      .filter((c) => c.company === from && c.eligibilityVerdict === 'ELIGIBLE_IDA' && !!c.counterpartyCompany && !withRecours.has(c.id) && claimAmount(c) !== undefined)
      .sort((a, b) => (b.accidentDate ?? '').localeCompare(a.accidentDate ?? ''));
  }, [claimsQuery.data, recoursQuery.data, from]);

  const selected = candidates.find((c) => c.id === claimId);
  const max = selected ? claimAmount(selected) : undefined;

  function pick(id: string) {
    setClaimId(id);
    const c = candidates.find((x) => x.id === id);
    const a = c ? claimAmount(c) : undefined;
    setAmount(a !== undefined ? String(a) : '');
  }

  const numericAmount = Number(amount.replace(',', '.'));
  const amountValid = amount.trim() !== '' && Number.isFinite(numericAmount) && numericAmount > 0 && /^\d+([.,]\d{1,2})?$/.test(amount.trim()) && (max === undefined || numericAmount <= max);

  const mutation = useMutation({
    mutationFn: () => apiPost<RecoursItem>('/recours', { claimId, from, to: selected!.counterpartyCompany, amount: numericAmount }),
    onSuccess: (created) => {
      toast(t('exchanges.newRecours.toast.ok').replace('{ref}', created.reference), 'ok');
      void queryClient.invalidateQueries({ queryKey: ['recours'] });
      void queryClient.invalidateQueries({ queryKey: ['claims'] });
      onCreated(created);
      onClose();
    },
    onError: (err: unknown) => toast(errorMessage(err, t('exchanges.newRecours.toast.error')), 'ko'),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!selected || !amountValid || mutation.isPending) return;
    mutation.mutate();
  }

  const loading = claimsQuery.isLoading || recoursQuery.isLoading;
  const fmtDa = (n: number) => `${n.toLocaleString(locale)} DA`;
  const fmtDate = (iso?: string) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');

  return (
    <Modal open={open} title={t('exchanges.newRecours.title')} onClose={onClose}>
      <form className="ex-new" onSubmit={submit}>
        <p className="ex-new-intro">{t('exchanges.newRecours.intro')}</p>

        {ownCompany ? (
          <div className="ex-new-row">
            <span className="ex-new-label">{t('exchanges.newRecours.from')}</span>
            <CoChip code={ownCompany} withName />
          </div>
        ) : (
          <>
            <label htmlFor="new-recours-from" className="ex-new-label">
              {t('exchanges.newRecours.from')}
            </label>
            <select id="new-recours-from" className="ex-new-field" value={from} onChange={(e) => { setFrom(e.target.value); setClaimId(''); setAmount(''); }}>
              <option value="">{t('exchanges.newRecours.chooseCompany')}</option>
              {companies
                .filter((c) => !c.status || c.status === 'ACTIF')
                .map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                    {c.name ? ` — ${c.name}` : ''}
                  </option>
                ))}
            </select>
          </>
        )}

        <label htmlFor="new-recours-claim" className="ex-new-label">
          {t('exchanges.newRecours.claim')}
        </label>
        <select id="new-recours-claim" className="ex-new-field" value={claimId} onChange={(e) => pick(e.target.value)} disabled={!from || loading}>
          <option value="">{loading ? t('common.loading') : candidates.length === 0 ? t('exchanges.newRecours.noClaim') : t('exchanges.newRecours.chooseClaim')}</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {`${c.numEconstat} · ${fmtDate(c.accidentDate)} · ${t('exchanges.newRecours.against')} ${c.counterpartyCompany} · ${fmtDa(claimAmount(c)!)}`}
            </option>
          ))}
        </select>

        {selected ? (
          <>
            <div className="ex-new-row">
              <span className="ex-new-label">{t('exchanges.newRecours.to')}</span>
              <CoChip code={selected.counterpartyCompany!} withName />
            </div>
            <label htmlFor="new-recours-amount" className="ex-new-label">
              {t('exchanges.newRecours.amount')}
            </label>
            <input
              id="new-recours-amount"
              className="ex-new-field mono"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={!amountValid}
              aria-describedby="new-recours-amount-hint"
            />
            <p id="new-recours-amount-hint" className={`ex-new-hint${amountValid ? '' : ' ko'}`}>
              {t('exchanges.newRecours.amountHint').replace('{max}', fmtDa(max!))}
            </p>
          </>
        ) : null}

        <div className="ex-new-actions">
          <button type="button" className="btn-soft" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn-primary" disabled={!selected || !amountValid || mutation.isPending}>
            {mutation.isPending ? t('common.loading') : t('exchanges.newRecours.submit')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
