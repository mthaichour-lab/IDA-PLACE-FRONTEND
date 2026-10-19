'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { FolioHeader } from '@/components/FolioHeader';
import { Table, Column } from '@/components/ui/Table';
import { Tag } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { apiGet, apiPostForm } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { ClaimColumnDef, ClaimImportReport, ClaimImportRowResult, ClaimImportWarning } from '@/lib/types';

const PAGE_SIZE = 6; // pagination fixe 6/p — A.5

/** Construit un CSV (placeholder documenté — pas un classeur Excel mis en forme) à partir d'un modèle de colonnes (v1 ou v2). */
function buildColumnsCsv(columns: ClaimColumnDef[]): string {
  const header = 'index;key;label;group;type;enumValues';
  const lines = columns.map((c) => [c.index, c.key, c.label, c.group, c.type, c.enumValues?.join('|') ?? ''].join(';'));
  return [header, ...lines].join('\n');
}

function downloadText(fileName: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function ImportPage() {
  const { t, locale } = useI18n();
  const { hasPrivilege } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [reportPage, setReportPage] = useState(1);
  const [warningsPage, setWarningsPage] = useState(1);
  const [journal, setJournal] = useState<ClaimImportReport[]>([]);

  const canImport = hasPrivilege('import');

  const columnsQuery = useQuery({
    queryKey: ['claims', 'import', 'columns'],
    queryFn: () => apiGet<ClaimColumnDef[]>('/claims/import/columns'),
  });

  const columnsV2Query = useQuery({
    queryKey: ['claims', 'import', 'columns', 'v2'],
    queryFn: () => apiGet<ClaimColumnDef[]>('/claims/import/columns/v2'),
  });

  const importMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return apiPostForm<ClaimImportReport>('/claims/import', form);
    },
    onSuccess: (report) => {
      setJournal((prev) => [report, ...prev]);
      setReportPage(1);
      setWarningsPage(1);
      toast(t('import.toast.success'), 'ok');
    },
    onError: () => {
      toast(t('import.toast.error'), 'ko');
    },
  });

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!canImport || !files || files.length === 0) return;
      importMutation.mutate(files[0]);
    },
    [canImport, importMutation],
  );

  function onDownloadTemplate(version: 'v1' | 'v2') {
    const cols = version === 'v1' ? columnsQuery.data : columnsV2Query.data;
    if (!cols) return;
    downloadText(version === 'v1' ? 'modele-47-colonnes-IDA.csv' : `modele-v2-${cols.length}-colonnes-IDA.csv`, buildColumnsCsv(cols));
  }

  const latestReport = journal[0];
  const reportRowsTotal = latestReport?.rows.length ?? 0;
  const reportRows = latestReport ? latestReport.rows.slice((reportPage - 1) * PAGE_SIZE, reportPage * PAGE_SIZE) : [];

  const warnings = latestReport?.warnings ?? [];
  const columnLabel = new Map((columnsV2Query.data ?? []).map((c) => [c.index, c.label]));
  const warningColumns: Column<ClaimImportWarning>[] = [
    { key: 'rowNumber', header: t('import.col.row'), render: (w) => <span className="mono">{w.rowNumber}</span> },
    {
      key: 'column',
      header: t('import.warnings.col.column'),
      render: (w) => (
        <>
          <span className="mono">{w.column}</span> · {columnLabel.get(w.column) ?? w.columnKey}
        </>
      ),
    },
    { key: 'message', header: t('import.warnings.col.message'), render: (w) => w.message },
  ];

  const reportColumns: Column<ClaimImportRowResult>[] = [
    { key: 'rowNumber', header: t('import.col.row'), render: (r) => <span className="mono">{r.rowNumber}</span> },
    {
      key: 'verdict',
      header: t('import.col.verdict'),
      render: (r) => <Tag tone={r.verdict === 'ELIGIBLE_IDA' ? 'ok' : 'ko'}>{r.verdict === 'ELIGIBLE_IDA' ? t('import.verdict.eligible') : t('import.verdict.ineligible')}</Tag>,
    },
    {
      key: 'reasons',
      header: t('import.col.reasons'),
      render: (r) => (r.reasons.length > 0 ? r.reasons.join(' · ') : <span style={{ color: 'var(--ink-3)' }}>—</span>),
    },
  ];

  return (
    <>
      <FolioHeader badge="Module XII" title={t('import.title')} subtitle={t('import.subtitle')} />

      {!canImport ? (
        <div className="note warn" role="alert" style={{ marginBottom: 'var(--s-5)' }}>
          <strong>{t('import.forbidden.title')}</strong>
          <span>{t('import.forbidden.body')}</span>
        </div>
      ) : null}

      <div className="grid g-side">
        <div>
          {canImport ? (
            <div className="sheet" style={{ marginBottom: 'var(--s-5)' }}>
              <div className="sheet-body">
                {/* Zone de dépôt drag-drop (A.4, écran 3) */}
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={t('import.dropzone.title')}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    handleFiles(e.dataTransfer.files);
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
                  }}
                  style={{
                    border: `2px dashed ${dragOver ? 'var(--k-pri)' : 'var(--rule-strong)'}`,
                    borderRadius: 'var(--k-r-l)',
                    padding: 'var(--s-8)',
                    textAlign: 'center',
                    cursor: 'pointer',
                    background: dragOver ? 'var(--k-mint)' : 'var(--sheet)',
                  }}
                >
                  <strong style={{ display: 'block', marginBottom: 'var(--s-2)' }}>{t('import.dropzone.title')}</strong>
                  <p style={{ color: 'var(--ink-2)', marginBottom: 'var(--s-3)' }}>{t('import.dropzone.subtitle')}</p>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                    style={{ padding: '8px 16px', borderRadius: 'var(--k-r-s)', border: '1px solid var(--k-pri)', background: 'var(--k-pri)', color: '#fff', font: 'inherit', cursor: 'pointer' }}
                  >
                    {t('import.dropzone.button')}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    aria-hidden="true"
                    style={{ display: 'none' }}
                    onChange={(e) => handleFiles(e.target.files)}
                  />
                </div>

                {importMutation.isPending ? (
                  <p role="status" style={{ marginTop: 'var(--s-3)' }}>
                    {t('import.uploading')}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="sheet">
            <div className="sheet-head">
              <span>{t('import.report.title')}</span>
            </div>
            <div className="sheet-body">
              {!latestReport ? (
                <p style={{ color: 'var(--ink-3)' }}>{t('import.journal.empty')}</p>
              ) : (
                <>
                  <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--s-3)', marginBottom: 'var(--s-4)' }}>
                    <Field label={t('import.report.file')}>
                      <span className="mono">{latestReport.fileName}</span>
                    </Field>
                    <Field label={t('import.report.importedAt')}>{new Date(latestReport.importedAt).toLocaleString(locale)}</Field>
                    <Field label={t('import.report.total')}>{latestReport.totalRows}</Field>
                    <Field label={t('import.report.eligible')}>
                      <Tag tone="ok">{latestReport.eligibleCount}</Tag>
                    </Field>
                    <Field label={t('import.report.ineligible')}>
                      <Tag tone="ko">{latestReport.ineligibleCount}</Tag>
                    </Field>
                  </dl>

                  <Table
                    columns={reportColumns}
                    rows={reportRows}
                    page={reportPage}
                    total={reportRowsTotal}
                    pageSize={PAGE_SIZE}
                    onPageChange={setReportPage}
                    getRowKey={(r) => String(r.rowNumber)}
                  />

                  {warnings.length > 0 ? (
                    <section aria-label={t('import.warnings.title')} style={{ marginTop: 'var(--s-5)' }}>
                      <strong style={{ display: 'block', marginBottom: 'var(--s-2)', fontSize: 'var(--k-fs-s)' }}>
                        {t('import.warnings.title')} ({warnings.length})
                      </strong>
                      <p style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)', marginTop: 0 }}>{t('import.warnings.note')}</p>
                      <Table
                        columns={warningColumns}
                        rows={warnings.slice((warningsPage - 1) * PAGE_SIZE, warningsPage * PAGE_SIZE)}
                        page={warningsPage}
                        total={warnings.length}
                        pageSize={PAGE_SIZE}
                        onPageChange={setWarningsPage}
                        getRowKey={(w) => `${w.rowNumber}-${w.column}`}
                      />
                    </section>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>

        <aside className="sheet" aria-label={t('import.template.download')}>
          <div className="sheet-head">
            <span>{t('import.template.download')}</span>
          </div>
          <div className="sheet-body">
            <p style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)', marginTop: 0 }}>{t('import.template.note')}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}>
              {(
                [
                  { version: 'v1', label: t('import.template.v1'), data: columnsQuery.data },
                  { version: 'v2', label: t('import.template.v2'), data: columnsV2Query.data },
                ] as const
              ).map(({ version, label, data }) => (
                <button
                  key={version}
                  type="button"
                  onClick={() => onDownloadTemplate(version)}
                  disabled={!data}
                  style={{ padding: '8px 16px', borderRadius: 'var(--k-r-s)', border: '1px solid var(--rule-strong)', background: 'var(--paper)', color: 'var(--ink)', font: 'inherit', cursor: data ? 'pointer' : 'not-allowed', width: '100%' }}
                >
                  {label} ({data?.length ?? '…'} {t('import.template.columns')})
                </button>
              ))}
            </div>

            {journal.length > 1 ? (
              <div style={{ marginTop: 'var(--s-5)' }}>
                <strong style={{ display: 'block', marginBottom: 'var(--s-2)', fontSize: 'var(--k-fs-s)' }}>{t('import.journal.title')}</strong>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {journal.map((r, i) => (
                    <li key={`${r.fileName}-${r.importedAt}-${i}`} style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)', display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                      <span className="mono">{r.fileName}</span>
                      <span>{new Date(r.importedAt).toLocaleTimeString(locale)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)' }}>{label}</dt>
      <dd style={{ margin: 0 }}>{children}</dd>
    </div>
  );
}
