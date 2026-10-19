'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Column, Table } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { apiDelete, apiPath, apiPost, apiPut } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { BAREME_VERSIONS_KEY, useBaremeVersions, useVehicleCategories, VEHICLE_CATEGORIES_KEY } from '@/lib/bareme';
import { BaremeCase, BaremeVersion, VehicleCategory } from '@/lib/types';
import { apiErrorMessage, FormStack, Hint, LabeledInput, PrimaryButton, QueryState, RowAction, RowActions, SubTitle } from './fields';
import { ValidationTag } from './ValidationTag';

const PAGE_SIZE = 6; // pagination fixe 6/p — A.5

const REFERENCE_CODE = /^[A-Z0-9_-]{1,32}$/;

const BLOCK_STYLE: React.CSSProperties = { marginBottom: 'var(--s-5)' };
const BLOCK_HEAD_STYLE: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--s-2)', flexWrap: 'wrap' };

interface CaseForm {
  code: string;
  label: string;
  partA: string;
  partB: string;
}

const EMPTY_CASE: CaseForm = { code: '', label: '', partA: '', partB: '' };

function parsePart(value: string): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 100 ? n : null;
}

/** Parts saisies et A + B = 100 — même règle que le backend, qui reste juge. */
function partsState(form: CaseForm): { complete: boolean; valid: boolean } {
  const a = parsePart(form.partA);
  const b = parsePart(form.partB);
  const complete = form.partA.trim() !== '' && form.partB.trim() !== '';
  return { complete, valid: a !== null && b !== null && a + b === 100 };
}

/**
 * « Barème Art. 14 » (écran 12), décision PO §5 : versions BROUILLON →
 * VALIDE_UAR (immuable) → ARCHIVE, cas d'une version (parts A + B = 100) et
 * catégories de véhicule. Rien n'est pré-rempli. Saisie `params`,
 * validation et archivage `validateRef` (quatre yeux côté backend).
 */
export function BaremeSection() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { hasPrivilege } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = hasPrivilege('params');
  const canValidate = hasPrivilege('validateRef');

  const versionsQuery = useBaremeVersions();
  const categoriesQuery = useVehicleCategories();

  const [versionsPage, setVersionsPage] = useState(1);
  const [casesPage, setCasesPage] = useState(1);
  const [categoriesPage, setCategoriesPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [versionModal, setVersionModal] = useState<{ mode: 'create' } | { mode: 'rename'; id: string } | null>(null);
  const [versionForm, setVersionForm] = useState({ label: '', sourceRef: '' });
  const [caseModal, setCaseModal] = useState<{ mode: 'create' } | { mode: 'edit'; code: string } | null>(null);
  const [caseForm, setCaseForm] = useState<CaseForm>(EMPTY_CASE);
  const [categoryModal, setCategoryModal] = useState<{ mode: 'create' } | { mode: 'edit'; code: string } | null>(null);
  const [categoryForm, setCategoryForm] = useState({ code: '', label: '' });

  const versions = versionsQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];
  const selected = versions.find((v) => v.id === selectedId) ?? versions[versions.length - 1];
  const published = versions.some((v) => v.status === 'VALIDE_UAR');
  const draft = selected?.status === 'BROUILLON';

  const onError = (err: unknown) => toast(apiErrorMessage(err, t('referential.toast.error')), 'ko');
  const refreshVersions = () => void queryClient.invalidateQueries({ queryKey: BAREME_VERSIONS_KEY });
  const refreshCategories = () => void queryClient.invalidateQueries({ queryKey: VEHICLE_CATEGORIES_KEY });

  const saveVersion = useMutation({
    mutationFn: (form: { label: string; sourceRef: string }) => {
      const body = { label: form.label.trim(), sourceRef: form.sourceRef.trim() || undefined };
      return versionModal?.mode === 'rename'
        ? apiPut<BaremeVersion>(apiPath`/referential/bareme-versions/${versionModal.id}`, body)
        : apiPost<BaremeVersion>('/referential/bareme-versions', body);
    },
    onSuccess: (version) => {
      refreshVersions();
      setSelectedId(version.id);
      toast(t('referential.toast.saved'), 'ok');
      setVersionModal(null);
    },
    onError,
  });

  const versionTransition = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'validate' | 'archive' }) => apiPost<BaremeVersion>(apiPath`/referential/bareme-versions/${id}/${action}`),
    onSuccess: (_v, { action }) => {
      refreshVersions();
      toast(t(action === 'validate' ? 'referential.toast.validated' : 'referential.toast.saved'), 'ok');
    },
    onError,
  });

  const saveCase = useMutation({
    mutationFn: (form: CaseForm) => {
      const body = { label: form.label.trim(), partA: Number(form.partA), partB: Number(form.partB) };
      return caseModal?.mode === 'edit'
        ? apiPut<BaremeVersion>(apiPath`/referential/bareme-versions/${selected!.id}/cases/${caseModal.code}`, body)
        : apiPost<BaremeVersion>(apiPath`/referential/bareme-versions/${selected!.id}/cases`, { code: form.code, ...body });
    },
    onSuccess: () => {
      refreshVersions();
      toast(t('referential.toast.saved'), 'ok');
      setCaseModal(null);
    },
    onError,
  });

  const removeCase = useMutation({
    mutationFn: (code: string) => apiDelete<BaremeVersion>(apiPath`/referential/bareme-versions/${selected!.id}/cases/${code}`),
    onSuccess: () => {
      refreshVersions();
      toast(t('referential.toast.saved'), 'ok');
    },
    onError,
  });

  const saveCategory = useMutation({
    mutationFn: (form: { code: string; label: string }) =>
      categoryModal?.mode === 'edit'
        ? apiPut<VehicleCategory>(apiPath`/referential/vehicle-categories/${categoryModal.code}`, { label: form.label.trim() })
        : apiPost<VehicleCategory>('/referential/vehicle-categories', { code: form.code, label: form.label.trim() }),
    onSuccess: () => {
      refreshCategories();
      toast(t('referential.toast.saved'), 'ok');
      setCategoryModal(null);
    },
    onError,
  });

  const validateCategory = useMutation({
    mutationFn: (code: string) => apiPost<VehicleCategory>(apiPath`/referential/vehicle-categories/${code}/validate`),
    onSuccess: () => {
      refreshCategories();
      toast(t('referential.toast.validated'), 'ok');
    },
    onError,
  });

  const versionColumns: Column<BaremeVersion>[] = [
    { key: 'label', header: t('referential.bareme.version.col.label'), render: (r) => (r.id === selected?.id ? <strong aria-current="true">{r.label}</strong> : r.label) },
    { key: 'source', header: t('referential.field.sourceRef'), render: (r) => r.sourceRef ?? '—' },
    { key: 'cases', header: t('referential.bareme.version.col.cases'), render: (r) => <span className="mono">{r.cases.length}</span> },
    { key: 'status', header: t('referential.company.status'), render: (r) => <ValidationTag status={r.status} /> },
  ];
  if (canEdit || canValidate) {
    versionColumns.push({
      key: 'actions',
      header: t('referential.col.actions'),
      render: (r) => (
        <RowActions>
          {canEdit && r.status === 'BROUILLON' ? (
            <RowAction
              onClick={() => {
                setVersionForm({ label: r.label, sourceRef: r.sourceRef ?? '' });
                setVersionModal({ mode: 'rename', id: r.id });
              }}
            >
              {t('referential.bareme.version.rename')}
            </RowAction>
          ) : null}
          {canValidate && r.status === 'BROUILLON' ? (
            <RowAction disabled={versionTransition.isPending} onClick={() => versionTransition.mutate({ id: r.id, action: 'validate' })}>
              {t('referential.action.validate')}
            </RowAction>
          ) : null}
          {canValidate && r.status === 'VALIDE_UAR' ? (
            <RowAction disabled={versionTransition.isPending} onClick={() => versionTransition.mutate({ id: r.id, action: 'archive' })}>
              {t('referential.bareme.version.archive')}
            </RowAction>
          ) : null}
        </RowActions>
      ),
    });
  }

  const caseColumns: Column<BaremeCase>[] = [
    { key: 'code', header: t('referential.oppositionMotifs.col.code'), render: (r) => <span className="mono">{r.code}</span> },
    { key: 'label', header: t('referential.bareme.case.col.label'), render: (r) => r.label },
    { key: 'partA', header: t('referential.bareme.case.col.partA'), render: (r) => <span className="mono">{r.partA}</span> },
    { key: 'partB', header: t('referential.bareme.case.col.partB'), render: (r) => <span className="mono">{r.partB}</span> },
  ];
  if (canEdit && draft) {
    caseColumns.push({
      key: 'actions',
      header: t('referential.col.actions'),
      render: (r) => (
        <RowActions>
          <RowAction
            onClick={() => {
              setCaseForm({ code: r.code, label: r.label, partA: String(r.partA), partB: String(r.partB) });
              setCaseModal({ mode: 'edit', code: r.code });
            }}
          >
            {t('referential.action.edit')}
          </RowAction>
          <RowAction disabled={removeCase.isPending} onClick={() => removeCase.mutate(r.code)}>
            {t('referential.bareme.case.delete')}
          </RowAction>
        </RowActions>
      ),
    });
  }

  const categoryColumns: Column<VehicleCategory>[] = [
    { key: 'code', header: t('referential.oppositionMotifs.col.code'), render: (r) => <span className="mono">{r.code}</span> },
    { key: 'label', header: t('referential.bareme.case.col.label'), render: (r) => r.label },
    { key: 'status', header: t('referential.company.status'), render: (r) => <ValidationTag status={r.status} /> },
  ];
  if (canEdit || canValidate) {
    categoryColumns.push({
      key: 'actions',
      header: t('referential.col.actions'),
      render: (r) => (
        <RowActions>
          {canEdit && r.status !== 'VALIDE_UAR' ? (
            <RowAction
              onClick={() => {
                setCategoryForm({ code: r.code, label: r.label });
                setCategoryModal({ mode: 'edit', code: r.code });
              }}
            >
              {t('referential.action.edit')}
            </RowAction>
          ) : null}
          {canValidate && r.status !== 'VALIDE_UAR' ? (
            <RowAction disabled={validateCategory.isPending} onClick={() => validateCategory.mutate(r.code)}>
              {t('referential.action.validate')}
            </RowAction>
          ) : null}
        </RowActions>
      ),
    });
  }

  const parts = partsState(caseForm);
  const caseFormValid = !!caseForm.label.trim() && parts.valid && (caseModal?.mode === 'edit' || REFERENCE_CODE.test(caseForm.code));
  const cases = selected?.cases ?? [];

  return (
    <div className="sheet">
      <div className="sheet-head">
        <span>{t('referential.nav.bareme.title')}</span>
      </div>
      <div className="sheet-body">
        <section style={BLOCK_STYLE} aria-label={t('referential.bareme.versions.title')}>
          <div style={BLOCK_HEAD_STYLE}>
            <SubTitle>{t('referential.bareme.versions.title')}</SubTitle>
            {canEdit ? (
              <PrimaryButton
                onClick={() => {
                  setVersionForm({ label: '', sourceRef: '' });
                  setVersionModal({ mode: 'create' });
                }}
              >
                {t('referential.bareme.version.create')}
              </PrimaryButton>
            ) : null}
          </div>
          <QueryState isLoading={versionsQuery.isLoading} error={versionsQuery.error} onRetry={() => versionsQuery.refetch()}>
            {!published ? (
              <div className="note warn" role="status" style={{ marginBottom: 'var(--s-3)' }}>
                <span>{t('referential.bareme.empty')}</span>
              </div>
            ) : null}
            {versions.length > 0 ? (
              <Table
                columns={versionColumns}
                rows={versions.slice((versionsPage - 1) * PAGE_SIZE, versionsPage * PAGE_SIZE)}
                page={versionsPage}
                total={versions.length}
                pageSize={PAGE_SIZE}
                onPageChange={setVersionsPage}
                onRowClick={(r) => {
                  setSelectedId(r.id);
                  setCasesPage(1);
                }}
                getRowKey={(r) => r.id}
              />
            ) : null}
            <Hint>{t('referential.bareme.note')}</Hint>
          </QueryState>
        </section>

        {selected ? (
          <section style={BLOCK_STYLE} aria-label={t('referential.bareme.cases.title')}>
            <div style={BLOCK_HEAD_STYLE}>
              <SubTitle>
                {t('referential.bareme.cases.title')} « {selected.label} »
              </SubTitle>
              {canEdit && draft ? (
                <PrimaryButton
                  onClick={() => {
                    setCaseForm(EMPTY_CASE);
                    setCaseModal({ mode: 'create' });
                  }}
                >
                  {t('referential.bareme.case.create')}
                </PrimaryButton>
              ) : null}
            </div>
            {cases.length === 0 ? (
              <p style={{ color: 'var(--ink-3)' }}>{t('referential.bareme.cases.empty')}</p>
            ) : (
              <Table
                columns={caseColumns}
                rows={cases.slice((casesPage - 1) * PAGE_SIZE, casesPage * PAGE_SIZE)}
                page={casesPage}
                total={cases.length}
                pageSize={PAGE_SIZE}
                onPageChange={setCasesPage}
                getRowKey={(r) => r.code}
              />
            )}
            {!draft ? <Hint>{t('referential.bareme.case.immutable')}</Hint> : null}
          </section>
        ) : null}

        <section aria-label={t('referential.bareme.categories.title')}>
          <div style={BLOCK_HEAD_STYLE}>
            <SubTitle>{t('referential.bareme.categories.title')}</SubTitle>
            {canEdit ? (
              <PrimaryButton
                onClick={() => {
                  setCategoryForm({ code: '', label: '' });
                  setCategoryModal({ mode: 'create' });
                }}
              >
                {t('referential.bareme.category.create')}
              </PrimaryButton>
            ) : null}
          </div>
          <QueryState isLoading={categoriesQuery.isLoading} error={categoriesQuery.error} onRetry={() => categoriesQuery.refetch()}>
            {categories.length === 0 ? (
              <div className="note warn" role="status">
                <span>{t('referential.bareme.categories.empty')}</span>
              </div>
            ) : (
              <Table
                columns={categoryColumns}
                rows={categories.slice((categoriesPage - 1) * PAGE_SIZE, categoriesPage * PAGE_SIZE)}
                page={categoriesPage}
                total={categories.length}
                pageSize={PAGE_SIZE}
                onPageChange={setCategoriesPage}
                getRowKey={(r) => r.code}
              />
            )}
          </QueryState>
        </section>
      </div>

      <Modal
        open={!!versionModal}
        title={versionModal?.mode === 'rename' ? t('referential.bareme.version.rename') : t('referential.bareme.version.create')}
        onClose={() => setVersionModal(null)}
        footer={
          <PrimaryButton disabled={saveVersion.isPending || !versionForm.label.trim()} onClick={() => saveVersion.mutate(versionForm)}>
            {t('referential.action.save')}
          </PrimaryButton>
        }
      >
        <FormStack>
          <LabeledInput label={t('referential.bareme.version.field.label')} value={versionForm.label} onChange={(v) => setVersionForm((f) => ({ ...f, label: v }))} />
          <LabeledInput label={t('referential.field.sourceRef')} value={versionForm.sourceRef} onChange={(v) => setVersionForm((f) => ({ ...f, sourceRef: v }))} />
        </FormStack>
      </Modal>

      <Modal
        open={!!caseModal}
        title={caseModal?.mode === 'edit' ? t('referential.bareme.case.edit.title') : t('referential.bareme.case.create')}
        onClose={() => setCaseModal(null)}
        footer={
          <PrimaryButton disabled={saveCase.isPending || !caseFormValid} onClick={() => saveCase.mutate(caseForm)}>
            {t('referential.action.save')}
          </PrimaryButton>
        }
      >
        <FormStack>
          <LabeledInput
            label={t('referential.bareme.field.code')}
            value={caseForm.code}
            disabled={caseModal?.mode === 'edit'}
            onChange={(v) => setCaseForm((f) => ({ ...f, code: v.toUpperCase() }))}
          />
          <LabeledInput label={t('referential.bareme.case.col.label')} value={caseForm.label} onChange={(v) => setCaseForm((f) => ({ ...f, label: v }))} />
          <LabeledInput label={t('referential.bareme.case.col.partA')} type="number" value={caseForm.partA} onChange={(v) => setCaseForm((f) => ({ ...f, partA: v }))} />
          <LabeledInput label={t('referential.bareme.case.col.partB')} type="number" value={caseForm.partB} onChange={(v) => setCaseForm((f) => ({ ...f, partB: v }))} />
          {parts.complete && !parts.valid ? (
            <p className="note ko" role="alert" style={{ margin: 0 }}>
              {t('referential.bareme.case.partsError')}
            </p>
          ) : null}
        </FormStack>
      </Modal>

      <Modal
        open={!!categoryModal}
        title={categoryModal?.mode === 'edit' ? t('referential.bareme.category.edit.title') : t('referential.bareme.category.create')}
        onClose={() => setCategoryModal(null)}
        footer={
          <PrimaryButton
            disabled={saveCategory.isPending || !categoryForm.label.trim() || (categoryModal?.mode === 'create' && !REFERENCE_CODE.test(categoryForm.code))}
            onClick={() => saveCategory.mutate(categoryForm)}
          >
            {t('referential.action.save')}
          </PrimaryButton>
        }
      >
        <FormStack>
          <LabeledInput
            label={t('referential.bareme.field.code')}
            value={categoryForm.code}
            disabled={categoryModal?.mode === 'edit'}
            onChange={(v) => setCategoryForm((f) => ({ ...f, code: v.toUpperCase() }))}
          />
          <LabeledInput label={t('referential.bareme.case.col.label')} value={categoryForm.label} onChange={(v) => setCategoryForm((f) => ({ ...f, label: v }))} />
          {categoryModal?.mode === 'edit' ? <Hint>{t('referential.revalidationHint')}</Hint> : null}
        </FormStack>
      </Modal>
    </div>
  );
}
