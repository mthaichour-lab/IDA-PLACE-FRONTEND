'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import type { TranslationKey } from '@/i18n/translations';
import { apiGet, apiPath, apiPost, apiPut } from '@/lib/api-client';
import { useApiErrorMessage } from '@/lib/error-message';
import { AgencyType, AgencyView, CompanyListItem, CompanyStatus, Paginated, WilayaRef } from '@/lib/types';
import { FormStack, Hint, LabeledInput, LabeledSelect, PrimaryButton } from './fields';

export type AgencyDialogTarget = { mode: 'create' } | { mode: 'edit'; agency: AgencyView };

export interface AgencyForm {
  companyId: string;
  code: string;
  name: string;
  type: AgencyType;
  parentId: string;
  wilayaCode: string;
  manager: string;
  phone: string;
  email: string;
  address: string;
  status: CompanyStatus;
}

const AGENCY_TYPES: AgencyType[] = ['DG', 'DR', 'AG'];
const AGENCY_STATUSES: CompanyStatus[] = ['ACTIF', 'SUSPENDU', 'EN_RETRAIT', 'EXCLU'];

function emptyForm(companyId = ''): AgencyForm {
  return { companyId, code: '', name: '', type: 'AG', parentId: '', wilayaCode: '', manager: '', phone: '', email: '', address: '', status: 'ACTIF' };
}

function formFromAgency(a: AgencyView): AgencyForm {
  return {
    companyId: a.companyId,
    code: a.code,
    name: a.name,
    type: a.type,
    parentId: a.parentId ?? '',
    wilayaCode: a.wilayaCode ?? '',
    manager: a.manager ?? '',
    phone: a.phone ?? '',
    email: a.email ?? '',
    address: a.address ?? '',
    status: a.status,
  };
}

/** Corps de `POST /referential/agencies` (CreateAgencyDto) : champs facultatifs vides omis. */
export function agencyCreateBody(f: AgencyForm) {
  const opt = (v: string) => (v.trim() ? v.trim() : undefined);
  return {
    companyId: f.companyId,
    code: f.code.trim(),
    name: f.name.trim(),
    type: f.type,
    parentId: opt(f.parentId),
    wilayaCode: opt(f.wilayaCode),
    manager: opt(f.manager),
    phone: opt(f.phone),
    email: opt(f.email),
    address: opt(f.address),
  };
}

/**
 * Corps de `PUT /referential/agencies/:id` (UpdateAgencyDto) : seuls les
 * champs modifiés. Code et compagnie ne figurent pas au DTO. Responsable,
 * téléphone et adresse peuvent être vidés ; e-mail, wilaya et agence parente
 * ne peuvent pas l'être (le DTO refuse une chaîne vide) : ils sont alors omis.
 */
export function agencyUpdateBody(original: AgencyView, f: AgencyForm): Record<string, string> {
  const before = formFromAgency(original);
  const body: Record<string, string> = {};
  if (f.name.trim() !== before.name) body.name = f.name.trim();
  if (f.type !== before.type) body.type = f.type;
  if (f.status !== before.status) body.status = f.status;
  for (const k of ['manager', 'phone', 'address'] as const) {
    if (f[k].trim() !== before[k]) body[k] = f[k].trim();
  }
  for (const k of ['email', 'wilayaCode', 'parentId'] as const) {
    if (f[k].trim() && f[k].trim() !== before[k]) body[k] = f[k].trim();
  }
  return body;
}

/**
 * Création / modification d'une agence (écran 12, section « Agences »),
 * privilège `refedit` (B.7 : un correspondant n'agit que sur SA compagnie —
 * compagnie verrouillée par `lockedCompanyId` ; SEC-31 : agence parente de la
 * même compagnie, sans cycle). L'API reste seule juge : ses refus sont
 * affichés tels quels.
 */
export function AgencyDialog({
  target,
  companies,
  lockedCompanyId,
  defaultCompanyId,
  onClose,
}: {
  target: AgencyDialogTarget | null;
  /** Compagnies proposées à la création (rôle place) — liste réelle de `GET /referential/companies`. */
  companies: CompanyListItem[];
  /** Rôle compagnie : sa propre compagnie, imposée. */
  lockedCompanyId?: string;
  /** Rôle place : compagnie pré-sélectionnée (filtre compagnie actif de la section). */
  defaultCompanyId?: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const errorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<AgencyForm>(emptyForm());
  const editing = target?.mode === 'edit' ? target.agency : null;

  useEffect(() => {
    if (!target) return;
    setForm(target.mode === 'edit' ? formFromAgency(target.agency) : emptyForm(lockedCompanyId ?? defaultCompanyId ?? ''));
  }, [target, lockedCompanyId, defaultCompanyId]);

  const wilayasQuery = useQuery({
    queryKey: ['referential', 'wilayas'],
    queryFn: () => apiGet<WilayaRef[]>('/referential/wilayas'),
    enabled: !!target,
  });

  // SEC-31 : candidates « agence parente » = agences de la MÊME compagnie (filtre réel de l'API).
  const parentsQuery = useQuery({
    queryKey: ['referential', 'agencies', 'parents', form.companyId],
    queryFn: () => apiGet<Paginated<AgencyView>>('/referential/agencies', { page: 1, pageSize: 100, companyId: form.companyId }),
    enabled: !!target && !!form.companyId,
  });

  const save = useMutation({
    mutationFn: (f: AgencyForm) =>
      editing ? apiPut<AgencyView>(apiPath`/referential/agencies/${editing.id}`, agencyUpdateBody(editing, f)) : apiPost<AgencyView>('/referential/agencies', agencyCreateBody(f)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['referential', 'agencies'] });
      // Compteurs DG/DR/AG des cartes compagnies.
      void queryClient.invalidateQueries({ queryKey: ['referential', 'companies'] });
      toast(t(editing ? 'referential.agency.toast.updated' : 'referential.agency.toast.created'), 'ok');
      onClose();
    },
    onError: (err: unknown) => toast(errorMessage(err, t('referential.agency.toast.error')), 'ko'),
  });

  const none = { value: '', label: t('referential.field.none') };
  const companyOptions = useMemo(() => {
    const list = lockedCompanyId ? companies.filter((c) => c.id === lockedCompanyId) : companies;
    return [{ value: '', label: '—', disabled: true }, ...list.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }))];
  }, [companies, lockedCompanyId]);
  const wilayaOptions = [
    ...(editing?.wilayaCode ? [] : [none]),
    ...(wilayasQuery.data ?? []).map((w) => ({ value: w.code, label: w.name ? `${w.code} — ${w.name}` : w.code })),
  ];
  const parentOptions = [
    ...(editing?.parentId ? [] : [none]),
    ...(parentsQuery.data?.items ?? []).filter((a) => a.id !== editing?.id).map((a) => ({ value: a.id, label: `${a.code} — ${a.name} (${a.type})` })),
  ];
  const typeOptions = AGENCY_TYPES.map((v) => ({ value: v, label: t(`referential.agency.type.${v}` as TranslationKey) }));
  const statusOptions = AGENCY_STATUSES.map((v) => ({ value: v, label: t(`referential.status.${v}` as TranslationKey) }));

  const complete = !!form.name.trim() && (editing ? Object.keys(agencyUpdateBody(editing, form)).length > 0 : !!form.companyId && !!form.code.trim());

  return (
    <Modal
      open={!!target}
      title={editing ? `${t('referential.agency.edit.title')} — ${editing.code}` : t('referential.agency.create.title')}
      onClose={onClose}
      footer={
        <PrimaryButton disabled={save.isPending || !complete} onClick={() => save.mutate(form)}>
          {t('referential.action.save')}
        </PrimaryButton>
      }
    >
      <FormStack>
        <LabeledSelect
          label={t('referential.agency.field.company')}
          value={form.companyId}
          required
          disabled={!!editing || !!lockedCompanyId}
          options={editing && !companyOptions.some((o) => o.value === form.companyId) ? [{ value: form.companyId, label: form.companyId }] : companyOptions}
          onChange={(v) => setForm((f) => ({ ...f, companyId: v, parentId: '' }))}
        />
        <LabeledInput label={t('referential.agency.field.code')} value={form.code} required disabled={!!editing} onChange={(v) => setForm((f) => ({ ...f, code: v }))} />
        <LabeledInput label={t('referential.agency.field.name')} value={form.name} required onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
        <LabeledSelect label={t('referential.agency.field.type')} value={form.type} options={typeOptions} onChange={(v) => setForm((f) => ({ ...f, type: v as AgencyType }))} />
        <LabeledSelect label={t('referential.agency.field.parent')} value={form.parentId} options={parentOptions} disabled={!form.companyId} onChange={(v) => setForm((f) => ({ ...f, parentId: v }))} />
        <LabeledSelect label={t('referential.agency.field.wilaya')} value={form.wilayaCode} options={wilayaOptions} onChange={(v) => setForm((f) => ({ ...f, wilayaCode: v }))} />
        <LabeledInput label={t('referential.agency.field.manager')} value={form.manager} onChange={(v) => setForm((f) => ({ ...f, manager: v }))} />
        <LabeledInput label={t('referential.agency.field.phone')} value={form.phone} type="tel" onChange={(v) => setForm((f) => ({ ...f, phone: v }))} />
        <LabeledInput label={t('referential.agency.field.email')} value={form.email} type="email" onChange={(v) => setForm((f) => ({ ...f, email: v }))} />
        <LabeledInput label={t('referential.agency.field.address')} value={form.address} onChange={(v) => setForm((f) => ({ ...f, address: v }))} />
        {editing ? (
          <LabeledSelect label={t('referential.company.status')} value={form.status} options={statusOptions} onChange={(v) => setForm((f) => ({ ...f, status: v as CompanyStatus }))} />
        ) : null}
      </FormStack>
      <Hint>{t(editing ? 'referential.agency.hint.edit' : 'referential.agency.hint.create')}</Hint>
    </Modal>
  );
}
