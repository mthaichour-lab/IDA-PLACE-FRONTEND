'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiErrorMessage, FormStack, LabeledSelect, PrimaryButton } from '@/components/referential/fields';
import { CoChip } from '@/components/ui/CoChip';
import { Modal } from '@/components/ui/Modal';
import { Tag } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { apiGet, apiPatch } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { publishedCases, publishedCategories, PublishedBaremeCase, useBaremeVersions, useVehicleCategories } from '@/lib/bareme';
import { ClaimResponsabilitePatch, ConstatCircumstance, DeclarationResponsabilite, MatchItemDetail, MatchQueueItem, VehicleCategory } from '@/lib/types';

const CIRCUMSTANCE_NUMBERS = Array.from({ length: 17 }, (_, i) => i + 1);
const NONE = '';

function caseKey(versionId: string | undefined, code: string | undefined): string {
  return code ? `${versionId ?? ''}|${code}` : NONE;
}

function sameNumbers(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((n, i) => n === b[i]);
}

interface Side {
  key: 'A' | 'B';
  claimId?: string;
  company?: string;
  reference?: string;
  block?: DeclarationResponsabilite;
}

interface Art14Form {
  circonstancesA: number[];
  circonstancesB: number[];
  bareme: string;
  vehicleCategoryA: string;
  vehicleCategoryB: string;
}

function toForm(block: DeclarationResponsabilite | undefined): Art14Form {
  return {
    circonstancesA: [...(block?.circonstancesA ?? [])].sort((x, y) => x - y),
    circonstancesB: [...(block?.circonstancesB ?? [])].sort((x, y) => x - y),
    bareme: caseKey(block?.baremeVersionId, block?.baremeCode),
    vehicleCategoryA: block?.vehicleCategoryA ?? NONE,
    vehicleCategoryB: block?.vehicleCategoryB ?? NONE,
  };
}

/** Seuls les champs modifiés partent : une valeur hors référentiel publié reste intacte si on n'y touche pas. */
function toPatch(initial: Art14Form, form: Art14Form, cases: PublishedBaremeCase[]): ClaimResponsabilitePatch {
  const patch: ClaimResponsabilitePatch = {};
  for (const key of ['circonstancesA', 'circonstancesB'] as const) {
    if (!sameNumbers(initial[key], form[key])) patch[key] = form[key].length > 0 ? form[key] : null;
  }
  if (initial.bareme !== form.bareme) {
    const picked = cases.find((c) => caseKey(c.versionId, c.code) === form.bareme);
    if (picked) {
      patch.baremeCode = picked.code;
      patch.baremeVersionId = picked.versionId;
    } else {
      patch.baremeCode = null;
    }
  }
  for (const key of ['vehicleCategoryA', 'vehicleCategoryB'] as const) {
    if (initial[key] !== form[key]) patch[key] = form[key] || null;
  }
  return patch;
}

/**
 * Responsabilité Art. 14 d'un appariement (écran 2), décision PO §5 : les
 * deux déclarations côte à côte, badge « Divergence », taux selon barème
 * face au taux déclaré (alerte non bloquante). Le backend fait foi
 * (403 RECOURS_OUVERT, 400 BAREME_NON_PUBLIE affichés tels quels).
 */
export function Art14Panel({ item }: { item: MatchQueueItem }) {
  const { t } = useI18n();
  const { me, hasPrivilege } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const detailQuery = useQuery({
    queryKey: ['matching', 'item', item.id],
    queryFn: () => apiGet<MatchItemDetail>(`/matching/${item.id}`),
  });
  const circumstancesQuery = useQuery({
    queryKey: ['referential', 'constat-circumstances'],
    queryFn: () => apiGet<ConstatCircumstance[]>('/referential/constat-circumstances'),
  });
  const versionsQuery = useBaremeVersions();
  const categoriesQuery = useVehicleCategories();

  const [editing, setEditing] = useState<Side | null>(null);
  const [initial, setInitial] = useState<Art14Form>(toForm(undefined));
  const [form, setForm] = useState<Art14Form>(toForm(undefined));

  const cases = publishedCases(versionsQuery.data);
  const categories = publishedCategories(categoriesQuery.data);
  const circumstanceLabel = new Map((circumstancesQuery.data ?? []).map((c) => [c.number, c.labelFr]));

  const detail: MatchQueueItem & Partial<Pick<MatchItemDetail, 'claimAId' | 'claimBId'>> = detailQuery.data ?? item;
  const sides: Side[] = [
    { key: 'A', claimId: detail.claimAId, company: detail.companyA, reference: detail.refA, block: detail.responsabiliteA },
    ...(detail.refB ? [{ key: 'B' as const, claimId: detail.claimBId, company: detail.companyB, reference: detail.refB, block: detail.responsabiliteB }] : []),
  ];

  function canEdit(side: Side): boolean {
    if (!side.claimId || !side.company) return false;
    if (me?.company) return hasPrivilege('insert') && side.company === me.company;
    return hasPrivilege('matchDecide');
  }

  const save = useMutation({
    mutationFn: ({ side, patch }: { side: Side; patch: ClaimResponsabilitePatch }) => apiPatch(`/claims/${side.claimId}/responsabilite`, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['matching'] });
      toast(t('matching.art14.toast.saved'), 'ok');
      setEditing(null);
    },
    onError: (err) => toast(apiErrorMessage(err, t('matching.art14.toast.error')), 'ko'),
  });

  function openEditor(side: Side) {
    const f = toForm(side.block);
    setInitial(f);
    setForm(f);
    setEditing(side);
  }

  function formatCircumstances(numbers: number[] | undefined) {
    if (!numbers || numbers.length === 0) return <span style={{ color: 'var(--ink-3)' }}>{t('matching.art14.notSet')}</span>;
    return (
      <ul style={{ margin: 0, paddingInlineStart: '1.1em' }}>
        {numbers.map((n) => (
          <li key={n}>
            <span className="mono">{n}</span>
            {circumstanceLabel.has(n) ? ` · ${circumstanceLabel.get(n)}` : ''}
          </li>
        ))}
      </ul>
    );
  }

  function formatPair(own: number | undefined, adverse: number | undefined) {
    if (own === undefined && adverse === undefined) return <span style={{ color: 'var(--ink-3)' }}>{t('matching.art14.notSet')}</span>;
    return (
      <span className="mono">
        {own ?? '—'} % / {adverse ?? '—'} %
      </span>
    );
  }

  const patch = editing ? toPatch(initial, form, cases) : {};
  const changed = Object.keys(patch).length > 0;

  const baremeOptions = [
    { value: NONE, label: cases.length > 0 ? t('matching.confrontation.unknown') : t('matching.art14.notPublished') },
    ...cases.map((c) => ({ value: caseKey(c.versionId, c.code), label: `${c.code} — ${c.label} (${c.versionLabel}) · ${c.partA} % / ${c.partB} %` })),
  ];
  if (initial.bareme !== NONE && !baremeOptions.some((o) => o.value === initial.bareme)) {
    baremeOptions.push({ value: initial.bareme, label: initial.bareme.split('|')[1] });
  }

  function categoryOptions(current: string) {
    const options = [
      { value: NONE, label: categories.length > 0 ? t('matching.confrontation.unknown') : t('matching.art14.notPublished') },
      ...categories.map((c: VehicleCategory) => ({ value: c.code, label: `${c.code} — ${c.label}` })),
    ];
    if (current !== NONE && !options.some((o) => o.value === current)) options.push({ value: current, label: current });
    return options;
  }

  return (
    <div className="sheet" style={{ marginTop: 'var(--s-5)' }}>
      <div className="sheet-head">
        <span>{t('matching.art14.title')}</span>
        {detail.divergence ? <Tag tone="ko">{t('matching.art14.divergence')}</Tag> : null}
      </div>
      <div className="sheet-body">
        {detailQuery.error ? (
          <div className="note ko" role="alert">
            <span>{t('common.error')}</span>
            <button type="button" onClick={() => detailQuery.refetch()}>
              {t('common.retry')}
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 'var(--s-3)' }}>
            {sides.map((side) => {
              const b = side.block;
              const taux = b?.tauxSelonBareme;
              const rateDiffers =
                !!taux &&
                ((b?.responsabiliteDeclareeA !== undefined && b.responsabiliteDeclareeA !== taux.partA) ||
                  (b?.responsabiliteDeclareeB !== undefined && b.responsabiliteDeclareeB !== taux.partB));
              return (
                <section
                  key={side.key}
                  aria-label={`${t('matching.art14.declaration')} ${side.key}`}
                  style={{ border: '1px solid var(--rule-strong)', borderRadius: 'var(--k-r-s)', padding: 'var(--s-3)' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--s-3)', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 'var(--k-fs-s)' }}>
                      {t('matching.art14.declaration')} {side.key}
                    </strong>
                    {side.company ? <CoChip code={side.company} /> : null}
                    <span className="mono" style={{ color: 'var(--ink-3)' }}>
                      {side.reference}
                    </span>
                  </div>
                  <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 10px', margin: 0, fontSize: 'var(--k-fs-s)' }}>
                    <dt style={{ color: 'var(--ink-3)' }}>
                      {t('matching.art14.circumstances')} · {t('matching.art14.own')}
                    </dt>
                    <dd style={{ margin: 0 }}>{formatCircumstances(b?.circonstancesA)}</dd>
                    <dt style={{ color: 'var(--ink-3)' }}>
                      {t('matching.art14.circumstances')} · {t('matching.art14.adverse')}
                    </dt>
                    <dd style={{ margin: 0 }}>{formatCircumstances(b?.circonstancesB)}</dd>
                    <dt style={{ color: 'var(--ink-3)' }}>{t('matching.art14.baremeCode')}</dt>
                    <dd className="mono" style={{ margin: 0 }}>
                      {b?.baremeCode ?? <span style={{ color: 'var(--ink-3)' }}>{t('matching.art14.notSet')}</span>}
                    </dd>
                    <dt style={{ color: 'var(--ink-3)' }}>
                      {t('matching.art14.vehicleCategory')} · {t('matching.art14.own')} / {t('matching.art14.adverse')}
                    </dt>
                    <dd className="mono" style={{ margin: 0 }}>
                      {b?.vehicleCategoryA ?? '—'} / {b?.vehicleCategoryB ?? '—'}
                    </dd>
                    <dt style={{ color: 'var(--ink-3)' }}>
                      {t('matching.art14.declared')} · {t('matching.art14.own')} / {t('matching.art14.adverse')}
                    </dt>
                    <dd style={{ margin: 0 }}>{formatPair(b?.responsabiliteDeclareeA, b?.responsabiliteDeclareeB)}</dd>
                    {taux ? (
                      <>
                        <dt style={{ color: 'var(--ink-3)' }}>
                          {t('matching.art14.selonBareme')} · {t('matching.art14.own')} / {t('matching.art14.adverse')}
                        </dt>
                        <dd style={{ margin: 0 }}>
                          {formatPair(taux.partA, taux.partB)} <span style={{ color: 'var(--ink-3)' }}>({taux.versionLabel})</span>
                        </dd>
                      </>
                    ) : null}
                  </dl>
                  {rateDiffers ? (
                    <p className="note warn" role="status" style={{ marginBottom: 0 }}>
                      {t('matching.art14.rateAlert')}
                    </p>
                  ) : null}
                  {canEdit(side) ? (
                    <div style={{ marginTop: 'var(--s-3)' }}>
                      <button type="button" className="tag a" style={{ border: 'none', cursor: 'pointer' }} onClick={() => openEditor(side)}>
                        {t('matching.art14.edit')}
                      </button>
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </div>

      <Modal
        open={!!editing}
        title={`${t('matching.art14.edit')} — ${t('matching.art14.declaration')} ${editing?.key ?? ''}`}
        onClose={() => setEditing(null)}
        footer={
          <PrimaryButton disabled={save.isPending || !changed} onClick={() => editing && save.mutate({ side: editing, patch })}>
            {t('referential.action.save')}
          </PrimaryButton>
        }
      >
        <FormStack>
          {(['circonstancesA', 'circonstancesB'] as const).map((key) => (
            <fieldset key={key} style={{ border: '1px solid var(--rule)', borderRadius: 'var(--k-r-s)', margin: 0, padding: 'var(--s-2) var(--s-3)' }}>
              <legend style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)' }}>
                {t('matching.art14.circumstances')} · {t(key === 'circonstancesA' ? 'matching.art14.own' : 'matching.art14.adverse')}
              </legend>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 4 }}>
                {CIRCUMSTANCE_NUMBERS.map((n) => (
                  <label key={n} style={{ display: 'flex', gap: 6, fontSize: 'var(--k-fs-xs)', color: 'var(--ink)' }}>
                    <input
                      type="checkbox"
                      checked={form[key].includes(n)}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, [key]: e.target.checked ? [...f[key], n].sort((x, y) => x - y) : f[key].filter((x) => x !== n) }))
                      }
                    />
                    <span>
                      <span className="mono">{n}</span>
                      {circumstanceLabel.has(n) ? ` · ${circumstanceLabel.get(n)}` : ''}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <LabeledSelect
            label={t('matching.art14.baremeCode')}
            value={form.bareme}
            disabled={cases.length === 0}
            options={baremeOptions}
            onChange={(v) => setForm((f) => ({ ...f, bareme: v }))}
          />
          {(['vehicleCategoryA', 'vehicleCategoryB'] as const).map((key) => (
            <LabeledSelect
              key={key}
              label={`${t('matching.art14.vehicleCategory')} · ${t(key === 'vehicleCategoryA' ? 'matching.art14.own' : 'matching.art14.adverse')}`}
              value={form[key]}
              disabled={categories.length === 0}
              options={categoryOptions(initial[key])}
              onChange={(v) => setForm((f) => ({ ...f, [key]: v }))}
            />
          ))}
        </FormStack>
      </Modal>
    </div>
  );
}
