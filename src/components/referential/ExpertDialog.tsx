'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import type { TranslationKey } from '@/i18n/translations';
import { apiPath, apiPost, apiPut } from '@/lib/api-client';
import { useApiErrorMessage } from '@/lib/error-message';
import { CompanyListItem, ExpertStatus, ExpertView } from '@/lib/types';
import { FormStack, Hint, LabeledCheckbox, LabeledInput, LabeledSelect, PrimaryButton, SubTitle } from './fields';

export type ExpertDialogTarget = { mode: 'create' } | { mode: 'edit'; expert: ExpertView };

export interface ExpertForm {
  name: string;
  firm: string;
  agrement: string;
  /** Codes wilaya saisis librement (« 16, 09 ») — validés par l'API (2 chiffres). */
  wilayas: string;
  /** Spécialités séparées par des virgules. */
  specialties: string;
  companies: string[];
  /** Jamais pré-rempli : le RIB n'est jamais renvoyé par l'API (SEC-14). */
  rib: string;
  status: ExpertStatus;
}

const EXPERT_STATUSES: ExpertStatus[] = ['ACTIF', 'SUSPENDU', 'RADIE'];

export function parseWilayaCodes(s: string): string[] {
  return [...new Set(s.split(/[\s,;]+/).map((v) => v.trim()).filter(Boolean))];
}

export function parseSpecialties(s: string): string[] {
  return [...new Set(s.split(/[,;]/).map((v) => v.trim()).filter(Boolean))];
}

function formFromExpert(e: ExpertView): ExpertForm {
  return {
    name: e.name,
    firm: e.firm ?? '',
    agrement: e.agrement ?? '',
    wilayas: e.wilayas.join(', '),
    specialties: e.specialties.join(', '),
    companies: [...e.companies],
    rib: '',
    status: e.status,
  };
}

/** Corps de `POST /referential/experts` (CreateExpertDto). SEC-14 : un rôle compagnie ne rattache l'expert qu'à elle-même. */
export function expertCreateBody(f: ExpertForm, ownCompany?: string) {
  const opt = (v: string) => (v.trim() ? v.trim() : undefined);
  const wilayas = parseWilayaCodes(f.wilayas);
  const specialties = parseSpecialties(f.specialties);
  const companies = ownCompany ? [ownCompany] : f.companies;
  return {
    name: f.name.trim(),
    firm: opt(f.firm),
    agrement: opt(f.agrement),
    wilayas: wilayas.length ? wilayas : undefined,
    specialties: specialties.length ? specialties : undefined,
    companies: companies.length ? companies : undefined,
    rib: f.rib.trim() ? f.rib.trim().toUpperCase() : undefined,
  };
}

const sameList = (a: readonly string[], b: readonly string[]) => [...a].sort().join('|') === [...b].sort().join('|');

/**
 * Corps de `PUT /referential/experts/:id` (UpdateExpertDto) : champs modifiés
 * seulement. SEC-14 : un rôle compagnie n'envoie jamais `companies` (il ne
 * voit que son propre rattachement) ni `status` (réservé à la place).
 */
export function expertUpdateBody(original: ExpertView, f: ExpertForm, placeActor: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (f.name.trim() !== original.name) body.name = f.name.trim();
  if (f.firm.trim() !== (original.firm ?? '')) body.firm = f.firm.trim();
  if (f.agrement.trim() !== (original.agrement ?? '')) body.agrement = f.agrement.trim();
  const wilayas = parseWilayaCodes(f.wilayas);
  if (!sameList(wilayas, original.wilayas)) body.wilayas = wilayas;
  const specialties = parseSpecialties(f.specialties);
  if (!sameList(specialties, original.specialties)) body.specialties = specialties;
  if (placeActor) {
    if (!sameList(f.companies, original.companies)) body.companies = f.companies;
    if (f.status !== original.status) body.status = f.status;
  }
  if (f.rib.trim()) body.rib = f.rib.trim().toUpperCase();
  return body;
}

/**
 * Création / modification d'un expert agréé (écran 12), privilège `refedit`.
 * SEC-14 : un rôle compagnie ne rattache l'expert qu'à elle-même et ne touche
 * pas au statut ; le RIB est chiffré au repos et jamais réaffiché. L'API reste
 * seule juge (ex. fiche d'un expert partagé : 403 affiché tel quel).
 */
export function ExpertDialog({
  target,
  companies,
  ownCompany,
  onClose,
}: {
  target: ExpertDialogTarget | null;
  /** Rôle place : compagnies proposées au rattachement (liste réelle de l'API). */
  companies: CompanyListItem[];
  /** Rôle compagnie : son code, imposé. Absent pour un rôle place. */
  ownCompany?: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const errorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const placeActor = !ownCompany;
  const editing = target?.mode === 'edit' ? target.expert : null;
  const [form, setForm] = useState<ExpertForm>(formFromExpert({ id: '', name: '', wilayas: [], specialties: [], companies: [], status: 'ACTIF' }));

  useEffect(() => {
    if (!target) return;
    setForm(
      target.mode === 'edit'
        ? formFromExpert(target.expert)
        : { name: '', firm: '', agrement: '', wilayas: '', specialties: '', companies: ownCompany ? [ownCompany] : [], rib: '', status: 'ACTIF' },
    );
  }, [target, ownCompany]);

  const save = useMutation({
    mutationFn: (f: ExpertForm) =>
      editing
        ? apiPut<ExpertView>(apiPath`/referential/experts/${editing.id}`, expertUpdateBody(editing, f, placeActor))
        : apiPost<ExpertView>('/referential/experts', expertCreateBody(f, ownCompany)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['referential', 'experts'] });
      toast(t(editing ? 'referential.expert.toast.updated' : 'referential.expert.toast.created'), 'ok');
      onClose();
    },
    onError: (err: unknown) => toast(errorMessage(err, t('referential.expert.toast.error')), 'ko'),
  });

  const complete = !!form.name.trim() && (!editing || Object.keys(expertUpdateBody(editing, form, placeActor)).length > 0);
  const statusOptions = EXPERT_STATUSES.map((v) => ({ value: v, label: t(`referential.status.${v}` as TranslationKey) }));
  // Rattachements déjà présents mais absents de la liste chargée : conservés et affichés tels quels.
  const companyCodes = [...new Set([...companies.map((c) => c.code), ...form.companies])];

  return (
    <Modal
      open={!!target}
      title={editing ? `${t('referential.expert.edit.title')} — ${editing.name}` : t('referential.expert.create.title')}
      onClose={onClose}
      footer={
        <PrimaryButton disabled={save.isPending || !complete} onClick={() => save.mutate(form)}>
          {t('referential.action.save')}
        </PrimaryButton>
      }
    >
      <FormStack>
        <LabeledInput label={t('referential.expert.field.name')} value={form.name} required onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
        <LabeledInput label={t('referential.expert.field.firm')} value={form.firm} onChange={(v) => setForm((f) => ({ ...f, firm: v }))} />
        <LabeledInput label={t('referential.expert.field.agrement')} value={form.agrement} onChange={(v) => setForm((f) => ({ ...f, agrement: v }))} />
        <LabeledInput label={t('referential.expert.field.wilayas')} value={form.wilayas} onChange={(v) => setForm((f) => ({ ...f, wilayas: v }))} />
        <LabeledInput label={t('referential.expert.field.specialties')} value={form.specialties} onChange={(v) => setForm((f) => ({ ...f, specialties: v }))} />
        {placeActor ? (
          <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
            <legend style={{ padding: 0 }}>
              <SubTitle>{t('referential.expert.field.companies')}</SubTitle>
            </legend>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-2) var(--s-4)' }}>
              {companyCodes.map((code) => (
                <LabeledCheckbox
                  key={code}
                  label={code}
                  checked={form.companies.includes(code)}
                  onChange={(checked) => setForm((f) => ({ ...f, companies: checked ? [...f.companies, code] : f.companies.filter((c) => c !== code) }))}
                />
              ))}
            </div>
          </fieldset>
        ) : (
          <p style={{ margin: 0, fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)' }}>
            {t('referential.expert.field.ownCompany')} <strong className="mono">{ownCompany}</strong>
          </p>
        )}
        <LabeledInput label={t(editing ? 'referential.expert.field.ribNew' : 'referential.expert.field.rib')} value={form.rib} onChange={(v) => setForm((f) => ({ ...f, rib: v }))} />
        {editing && placeActor ? (
          <LabeledSelect label={t('referential.company.status')} value={form.status} options={statusOptions} onChange={(v) => setForm((f) => ({ ...f, status: v as ExpertStatus }))} />
        ) : null}
      </FormStack>
      <Hint>{t(placeActor ? 'referential.expert.hint.place' : 'referential.expert.hint.company')}</Hint>
    </Modal>
  );
}

/** Suspension / réactivation d'un expert (`PUT /referential/experts/:id` `{ status }`) — statut réservé à la place (SEC-14). */
export function useExpertStatusMutation() {
  const { t } = useI18n();
  const { toast } = useToast();
  const errorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ExpertStatus }) => apiPut<ExpertView>(apiPath`/referential/experts/${id}`, { status }),
    onSuccess: (_res, { status }) => {
      void queryClient.invalidateQueries({ queryKey: ['referential', 'experts'] });
      toast(t(status === 'SUSPENDU' ? 'referential.expert.toast.suspended' : 'referential.expert.toast.reactivated'), 'ok');
    },
    onError: (err: unknown) => toast(errorMessage(err, t('referential.expert.toast.error')), 'ko'),
  });
}
