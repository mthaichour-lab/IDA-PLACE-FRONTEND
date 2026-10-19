'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FormStack, LabeledInput, LabeledSelect, PrimaryButton, RowAction, apiErrorMessage } from '@/components/referential/fields';
import { Tag, TagTone } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { TranslationKey } from '@/i18n/translations';
import { apiGet, apiPath, apiPost } from '@/lib/api-client';
import { CompanyKind, CompanyListItem, CompanyStatus, FeedMode, GovernanceChange, GovernancePatch } from '@/lib/types';

const STATUS_TONE: Record<GovernanceChange['status'], TagTone> = { EN_ATTENTE: 'warn', VALIDEE: 'ok', REJETEE: 'ko' };
const KEEP = '';

/**
 * `delayOverrides` saisi en texte « clé=jours » séparé par des virgules
 * (ex. `silenceDays=15, oppositionDays=20`) — format contrôlé par le backend
 * (20 clés au plus, entiers 0 à 3650). `null` si la saisie est invalide.
 */
export function parseDelayOverrides(raw: string): Record<string, number> | null | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  const out: Record<string, number> = {};
  for (const part of text.split(',')) {
    const m = /^\s*([A-Za-z][A-Za-z0-9_]{0,39})\s*=\s*(\d{1,4})\s*$/.exec(part);
    if (!m || Number(m[2]) > 3650) return null;
    out[m[1]] = Number(m[2]);
  }
  return Object.keys(out).length > 20 ? null : out;
}

function describePatch(patch: GovernancePatch): string {
  return Object.entries(patch)
    .map(([k, v]) => `${k} → ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ');
}

/**
 * SEC-04 — gouvernance d'une compagnie (statut, délais dérogatoires, nature,
 * mode d'alimentation) : plus jamais modifiée par `PUT /referential/companies/:id`
 * (403 GOUVERNANCE_RESERVEE). Une demande motivée est déposée par un
 * ADMIN_UAR puis validée ou rejetée par un SECOND ADMIN_UAR (409 FOUR_EYES
 * si c'est l'auteur). Liste visible des rôles place ; actions : privilège
 * `validateRef` (le backend vérifie en plus le rôle ADMIN_UAR).
 */
export function GovernancePanel({ company, canDecide }: { company: CompanyListItem; canDecide: boolean }) {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const queryKey = ['referential', 'companies', company.id, 'governance-changes'];

  const [status, setStatus] = useState<CompanyStatus | ''>(KEEP);
  const [kind, setKind] = useState<CompanyKind | ''>(KEEP);
  const [feedMode, setFeedMode] = useState<FeedMode | ''>(KEEP);
  const [delays, setDelays] = useState('');
  const [reason, setReason] = useState('');

  const listQuery = useQuery({
    queryKey,
    queryFn: () => apiGet<GovernanceChange[]>(apiPath`/referential/companies/${company.id}/governance-changes`),
  });

  const onError = (err: unknown) => toast(apiErrorMessage(err, t('referential.toast.error'), t), 'ko');

  const parsedDelays = parseDelayOverrides(delays);
  const patch: GovernancePatch = {
    ...(status ? { status } : {}),
    ...(kind ? { kind } : {}),
    ...(feedMode ? { feedMode } : {}),
    ...(parsedDelays ? { delayOverrides: parsedDelays } : {}),
  };
  const valid = parsedDelays !== null && Object.keys(patch).length > 0 && reason.trim() !== '';

  const requestMutation = useMutation({
    mutationFn: () => apiPost<GovernanceChange>(apiPath`/referential/companies/${company.id}/governance-changes`, { ...patch, reason: reason.trim() }),
    onSuccess: () => {
      setStatus(KEEP);
      setKind(KEEP);
      setFeedMode(KEEP);
      setDelays('');
      setReason('');
      void queryClient.invalidateQueries({ queryKey });
      toast(t('referential.governance.toast.requested'), 'ok');
    },
    onError,
  });

  const decideMutation = useMutation({
    mutationFn: ({ changeId, decision }: { changeId: string; decision: 'validate' | 'reject' }) =>
      apiPost<GovernanceChange>(apiPath`/referential/companies/${company.id}/governance-changes/${changeId}/${decision}`, {}),
    onSuccess: (_r, { decision }) => {
      void queryClient.invalidateQueries({ queryKey: ['referential', 'companies'] });
      toast(t(decision === 'validate' ? 'referential.governance.toast.validated' : 'referential.governance.toast.rejected'), 'ok');
    },
    onError,
  });

  const changes = listQuery.data ?? [];
  const keepOption = { value: KEEP, label: t('referential.governance.keep') };

  return (
    <section aria-label={t('referential.governance.title')}>
      <p style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)', marginTop: 0 }}>{t('referential.governance.note')}</p>
      <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--s-2)', margin: '0 0 var(--s-4)' }}>
        <Current label={t('referential.company.status')} value={company.status} />
        <Current label={t('referential.company.field.kind')} value={company.kind} />
        <Current label={t('referential.company.field.feedMode')} value={company.feedMode ?? '—'} />
        <Current label={t('referential.governance.delayOverrides')} value={company.delayOverrides && Object.keys(company.delayOverrides).length > 0 ? JSON.stringify(company.delayOverrides) : '—'} />
      </dl>

      {canDecide ? (
        <div style={{ border: '1px solid var(--rule)', borderRadius: 'var(--k-r-s)', padding: 'var(--s-3)', marginBottom: 'var(--s-4)' }}>
          <strong style={{ display: 'block', marginBottom: 'var(--s-2)', fontSize: 'var(--k-fs-s)' }}>{t('referential.governance.request')}</strong>
          <FormStack>
            <LabeledSelect label={t('referential.company.status')} value={status} onChange={(v) => setStatus(v as CompanyStatus | '')} options={[keepOption, 'ACTIF', 'SUSPENDU', 'EN_RETRAIT', 'EXCLU']} />
            <LabeledSelect label={t('referential.company.field.kind')} value={kind} onChange={(v) => setKind(v as CompanyKind | '')} options={[keepOption, 'INSURER', 'MUTUAL', 'SUBSIDIARY']} />
            <LabeledSelect label={t('referential.company.field.feedMode')} value={feedMode} onChange={(v) => setFeedMode(v as FeedMode | '')} options={[keepOption, 'ERP', 'ECONSTAT', 'IMPORT', 'API']} />
            <LabeledInput label={t('referential.governance.delayOverridesInput')} value={delays} onChange={setDelays} />
            {parsedDelays === null ? <p style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ko)', margin: 0 }}>{t('referential.governance.delayOverridesInvalid')}</p> : null}
            <LabeledInput label={t('referential.governance.reason')} value={reason} onChange={setReason} required />
            <div>
              <PrimaryButton disabled={!valid || requestMutation.isPending} onClick={() => requestMutation.mutate()}>
                {t('referential.governance.submit')}
              </PrimaryButton>
            </div>
          </FormStack>
        </div>
      ) : null}

      <strong style={{ display: 'block', marginBottom: 'var(--s-2)', fontSize: 'var(--k-fs-s)' }}>{t('referential.governance.history')}</strong>
      {listQuery.isLoading ? (
        <p>{t('common.loading')}</p>
      ) : listQuery.error ? (
        <div className="note ko" role="alert">
          <span>{t('common.error')}</span>
          <button type="button" onClick={() => listQuery.refetch()}>
            {t('common.retry')}
          </button>
        </div>
      ) : changes.length === 0 ? (
        <p style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)' }}>{t('referential.governance.empty')}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {changes.map((c) => (
            <li key={c.id} style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)', borderInlineStart: '2px solid var(--rule-strong)', paddingInlineStart: 8 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <Tag tone={STATUS_TONE[c.status]}>{t(`referential.governance.status.${c.status}` as TranslationKey)}</Tag>
                <span className="mono">{describePatch(c.patch)}</span>
              </div>
              <div>
                {t('referential.governance.requestedBy')} {c.requestedBy} · {new Date(c.requestedAt).toLocaleString(locale)} — {c.reason}
              </div>
              {c.decidedBy ? (
                <div>
                  {t('referential.governance.decidedBy')} {c.decidedBy}
                  {c.decidedAt ? ` · ${new Date(c.decidedAt).toLocaleString(locale)}` : ''}
                </div>
              ) : null}
              {c.status === 'EN_ATTENTE' && canDecide ? (
                <span style={{ display: 'inline-flex', gap: 6, marginTop: 4 }}>
                  <RowAction disabled={decideMutation.isPending} onClick={() => decideMutation.mutate({ changeId: c.id, decision: 'validate' })}>
                    {t('referential.governance.validate')}
                  </RowAction>
                  <RowAction disabled={decideMutation.isPending} onClick={() => decideMutation.mutate({ changeId: c.id, decision: 'reject' })}>
                    {t('referential.governance.reject')}
                  </RowAction>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Current({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)' }}>{label}</dt>
      <dd className="mono" style={{ margin: 0, fontSize: 'var(--k-fs-s)' }}>
        {value}
      </dd>
    </div>
  );
}
