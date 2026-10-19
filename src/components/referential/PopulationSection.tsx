'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Column, Table } from '@/components/ui/Table';
import { Tag } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { apiGet, apiPost, apiPostForm, apiPut } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { PopulationImportReport, PopulationImportRow, PopulationSourceType, WilayaPopulation, WilayaRef } from '@/lib/types';
import { apiErrorMessage, FormStack, Hint, LabeledInput, LabeledSelect, PrimaryButton, QueryState, RowAction, SubTitle } from './fields';
import { POPULATION_SOURCE_LABELS } from './labels';

const PAGE_SIZE = 6; // pagination fixe 6/p — A.5

interface PopulationForm {
  wilayaCode: string;
  referenceYear: string;
  population: string;
  sourceType: PopulationSourceType;
  sourceRef: string;
}

const EMPTY_FORM: PopulationForm = { wilayaCode: '', referenceYear: '', population: '', sourceType: 'RECENSEMENT_RGPH', sourceRef: '' };

/**
 * « Populations de référence » (écran 12), décision PO §3 : saisie ou import
 * CSV (tout ou rien, rapport ligne par ligne), source obligatoire. Aucune
 * population pré-remplie ; une population antérieure au périmètre actuel de
 * la wilaya est signalée invalide et n'entre dans aucun calcul.
 */
export function PopulationSection() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const { hasPrivilege } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = hasPrivilege('params');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [page, setPage] = useState(1);
  const [reportPage, setReportPage] = useState(1);
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'edit'; id: string } | null>(null);
  const [form, setForm] = useState<PopulationForm>(EMPTY_FORM);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<PopulationImportReport | null>(null);

  const populationsQuery = useQuery({
    queryKey: ['referential', 'wilaya-populations'],
    queryFn: () => apiGet<WilayaPopulation[]>('/referential/wilaya-populations'),
  });
  const wilayasQuery = useQuery({
    queryKey: ['referential', 'wilayas'],
    queryFn: () => apiGet<WilayaRef[]>('/referential/wilayas'),
    enabled: canEdit,
  });
  const wilayaName = useMemo(() => new Map((wilayasQuery.data ?? []).map((w) => [w.code, w.name])), [wilayasQuery.data]);

  const onError = (err: unknown) => toast(apiErrorMessage(err, t('referential.toast.error')), 'ko');

  const save = useMutation({
    mutationFn: (f: PopulationForm) =>
      modal?.mode === 'edit'
        ? apiPut<WilayaPopulation>(`/referential/wilaya-populations/${modal.id}`, { population: Number(f.population), sourceType: f.sourceType, sourceRef: f.sourceRef.trim() })
        : apiPost<WilayaPopulation>('/referential/wilaya-populations', {
            wilayaCode: f.wilayaCode,
            referenceYear: Number(f.referenceYear),
            population: Number(f.population),
            sourceType: f.sourceType,
            sourceRef: f.sourceRef.trim(),
          }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['referential', 'wilaya-populations'] });
      toast(t('referential.toast.saved'), 'ok');
      setModal(null);
    },
    onError,
  });

  const importCsv = useMutation({
    mutationFn: (csv: File) => {
      const data = new FormData();
      data.append('file', csv);
      return apiPostForm<PopulationImportReport>('/referential/wilaya-populations/import', data);
    },
    onSuccess: (result) => {
      setReport(result);
      setReportPage(1);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (result.written) {
        void queryClient.invalidateQueries({ queryKey: ['referential', 'wilaya-populations'] });
        toast(t('referential.toast.saved'), 'ok');
      } else {
        toast(t('referential.population.import.notWritten'), 'warn');
      }
    },
    onError,
  });

  const populations = populationsQuery.data ?? [];
  const sourceOptions = (Object.keys(POPULATION_SOURCE_LABELS) as PopulationSourceType[]).map((s) => ({ value: s, label: t(POPULATION_SOURCE_LABELS[s]) }));
  const wilayaOptions = [{ value: '', label: '—', disabled: true }, ...(wilayasQuery.data ?? []).map((w) => ({ value: w.code, label: w.name ? `${w.code} — ${w.name}` : w.code }))];
  const formComplete =
    !!form.population && Number(form.population) >= 1 && !!form.sourceRef.trim() && (modal?.mode === 'edit' || (!!form.wilayaCode && /^\d{4}$/.test(form.referenceYear)));

  const columns: Column<WilayaPopulation>[] = [
    {
      key: 'wilaya',
      header: t('referential.population.col.wilaya'),
      render: (r) => (
        <span>
          <span className="mono">{r.wilayaCode}</span>
          {wilayaName.get(r.wilayaCode) ? ` — ${wilayaName.get(r.wilayaCode)}` : ''}
        </span>
      ),
    },
    { key: 'year', header: t('referential.population.col.year'), render: (r) => <span className="mono">{r.referenceYear}</span> },
    { key: 'population', header: t('referential.population.col.population'), render: (r) => <span className="mono">{r.population.toLocaleString(locale)}</span> },
    { key: 'sourceType', header: t('referential.population.col.sourceType'), render: (r) => t(POPULATION_SOURCE_LABELS[r.sourceType]) },
    { key: 'sourceRef', header: t('referential.field.sourceRef'), render: (r) => r.sourceRef },
    {
      key: 'validity',
      header: t('referential.population.col.validity'),
      render: (r) => (r.valid ? <Tag tone="ok">{t('referential.population.valid')}</Tag> : <Tag tone="ko">{`${t('referential.population.invalid')}${r.invalidReason ? ` — ${r.invalidReason}` : ''}`}</Tag>),
    },
  ];
  if (canEdit) {
    columns.push({
      key: 'actions',
      header: t('referential.col.actions'),
      render: (r) => (
        <RowAction
          onClick={() => {
            setForm({ wilayaCode: r.wilayaCode, referenceYear: String(r.referenceYear), population: String(r.population), sourceType: r.sourceType, sourceRef: r.sourceRef });
            setModal({ mode: 'edit', id: r.id });
          }}
        >
          {t('referential.action.edit')}
        </RowAction>
      ),
    });
  }

  const reportColumns: Column<PopulationImportRow>[] = [
    { key: 'line', header: t('referential.population.import.col.line'), render: (r) => <span className="mono">{r.line}</span> },
    {
      key: 'status',
      header: t('referential.company.status'),
      render: (r) =>
        r.status === 'ACCEPTEE' ? <Tag tone="ok">{t('referential.population.import.status.ACCEPTEE')}</Tag> : <Tag tone="ko">{t('referential.population.import.status.REJETEE')}</Tag>,
    },
    { key: 'wilaya', header: t('referential.population.col.wilaya'), render: (r) => r.wilayaCode ?? '—' },
    { key: 'year', header: t('referential.population.col.year'), render: (r) => r.referenceYear ?? '—' },
    { key: 'population', header: t('referential.population.col.population'), render: (r) => (r.population !== undefined ? r.population.toLocaleString(locale) : '—') },
    { key: 'reason', header: t('referential.population.import.col.reason'), render: (r) => r.reason ?? '—' },
  ];

  return (
    <div className="sheet">
      <div className="sheet-head">
        <span>{t('referential.nav.population.title')}</span>
        {canEdit ? (
          <PrimaryButton
            onClick={() => {
              setForm(EMPTY_FORM);
              setModal({ mode: 'create' });
            }}
          >
            {t('referential.population.create')}
          </PrimaryButton>
        ) : null}
      </div>
      <div className="sheet-body">
        <QueryState isLoading={populationsQuery.isLoading} error={populationsQuery.error} onRetry={() => populationsQuery.refetch()}>
          {populations.length === 0 ? (
            <div className="note warn" role="status">
              <span>{t('referential.population.empty')}</span>
            </div>
          ) : (
            <Table columns={columns} rows={populations.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)} page={page} total={populations.length} pageSize={PAGE_SIZE} onPageChange={setPage} getRowKey={(r) => r.id} />
          )}
        </QueryState>

        {canEdit ? (
          <section aria-label={t('referential.population.import.title')} style={{ marginTop: 'var(--s-5)' }}>
            <SubTitle>{t('referential.population.import.title')}</SubTitle>
            <p style={{ marginTop: 0, fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)' }}>{t('referential.population.import.format')}</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (file) importCsv.mutate(file);
              }}
              style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap', alignItems: 'center' }}
            >
              <label htmlFor="population-import-file" style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)' }}>
                {t('referential.population.import.file')}
              </label>
              <input
                id="population-import-file"
                ref={fileInputRef}
                type="file"
                accept=".csv"
                disabled={importCsv.isPending}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                style={{ font: 'inherit' }}
              />
              <button type="submit" className="tag a" style={{ border: 'none', cursor: file && !importCsv.isPending ? 'pointer' : 'not-allowed' }} disabled={!file || importCsv.isPending}>
                {t('referential.population.import.submit')}
              </button>
            </form>

            {report ? (
              <section style={{ marginTop: 'var(--s-3)' }} aria-label={t('referential.population.import.report')}>
                <div className={`note ${report.written ? 'ok' : 'ko'}`} role="status" style={{ marginBottom: 'var(--s-3)' }}>
                  <span>
                    <span className="mono">{report.fileName}</span> ·{' '}
                    {t('referential.population.import.summary')
                      .replace('{accepted}', String(report.acceptedCount))
                      .replace('{rejected}', String(report.rejectedCount))
                      .replace('{total}', String(report.totalRows))}{' '}
                    — {report.written ? t('referential.population.import.written').replace('{n}', String(report.writtenCount)) : t('referential.population.import.notWritten')}
                  </span>
                </div>
                <Table
                  columns={reportColumns}
                  rows={report.rows.slice((reportPage - 1) * PAGE_SIZE, reportPage * PAGE_SIZE)}
                  page={reportPage}
                  total={report.rows.length}
                  pageSize={PAGE_SIZE}
                  onPageChange={setReportPage}
                  getRowKey={(r) => String(r.line)}
                />
              </section>
            ) : null}
          </section>
        ) : null}

        <Hint>{t('referential.population.note')}</Hint>
      </div>

      <Modal
        open={!!modal}
        title={modal?.mode === 'edit' ? t('referential.population.edit.title') : t('referential.population.create')}
        onClose={() => setModal(null)}
        footer={
          <PrimaryButton disabled={save.isPending || !formComplete} onClick={() => save.mutate(form)}>
            {t('referential.action.save')}
          </PrimaryButton>
        }
      >
        <FormStack>
          <LabeledSelect
            label={t('referential.population.col.wilaya')}
            value={form.wilayaCode}
            disabled={modal?.mode === 'edit'}
            options={modal?.mode === 'edit' && !wilayaName.has(form.wilayaCode) ? [{ value: form.wilayaCode, label: form.wilayaCode }] : wilayaOptions}
            onChange={(v) => setForm((f) => ({ ...f, wilayaCode: v }))}
          />
          <LabeledInput
            label={t('referential.population.col.year')}
            type="number"
            value={form.referenceYear}
            disabled={modal?.mode === 'edit'}
            onChange={(v) => setForm((f) => ({ ...f, referenceYear: v }))}
          />
          <LabeledInput label={t('referential.population.col.population')} type="number" value={form.population} onChange={(v) => setForm((f) => ({ ...f, population: v }))} />
          <LabeledSelect
            label={t('referential.population.col.sourceType')}
            value={form.sourceType}
            options={sourceOptions}
            onChange={(v) => setForm((f) => ({ ...f, sourceType: v as PopulationSourceType }))}
          />
          <LabeledInput label={t('referential.field.sourceRef')} value={form.sourceRef} required onChange={(v) => setForm((f) => ({ ...f, sourceRef: v }))} />
        </FormStack>
      </Modal>
    </div>
  );
}
