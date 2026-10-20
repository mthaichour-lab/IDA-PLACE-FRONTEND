'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { FolioHeader } from '@/components/FolioHeader';
import { LabeledSelect } from '@/components/referential/fields';
import { Table, Column } from '@/components/ui/Table';
import { Tag, TagTone } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { TranslationKey } from '@/i18n/translations';
import { apiGet, apiPostForm } from '@/lib/api-client';
import { buildColumnsCsv, downloadCsv } from '@/lib/csv';
import { useAuth } from '@/lib/auth-context';
import { isCompanyRole } from '@/lib/auth/roles';
import { useApiErrorMessage } from '@/lib/error-message';
import { ClaimColumnDef, ClaimImportReport, ClaimImportRowResult, ClaimImportWarning, CompanyListItem, Paginated } from '@/lib/types';

const PAGE_SIZE = 6; // pagination fixe 6/p — A.5

const WARNING_LABELS: Record<ClaimImportWarning['code'], TranslationKey> = {
  BAREME_NON_PUBLIE: 'import.warning.BAREME_NON_PUBLIE',
  CIRCONSTANCE_INVALIDE: 'import.warning.CIRCONSTANCE_INVALIDE',
  FORMULE_NEUTRALISEE: 'import.warning.FORMULE_NEUTRALISEE',
  DECLARATION_CORRIGEE: 'import.warning.DECLARATION_CORRIGEE',
};

function warningTone(code: ClaimImportWarning['code']): TagTone {
  return code === 'FORMULE_NEUTRALISEE' || code === 'DECLARATION_CORRIGEE' ? 'warn' : 'a';
}

export default function ImportPage() {
  const { t, locale } = useI18n();
  const { me, hasPrivilege } = useAuth();
  const { toast } = useToast();
  const errorMessage = useApiErrorMessage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [reportPage, setReportPage] = useState(1);
  const [warningsPage, setWarningsPage] = useState(1);
  const [journal, setJournal] = useState<ClaimImportReport[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  /** Rôle place : compagnie déclarante désignée explicitement (SEC-02, 400 COMPAGNIE_REQUISE sinon). */
  const [declaringCompany, setDeclaringCompany] = useState('');

  const canImport = hasPrivilege('import');
  // SEC-02 : un rôle compagnie importe pour SA compagnie (portée par le jeton) ;
  // un rôle place doit désigner la compagnie déclarante (`?company=`).
  const companyRole = isCompanyRole(me?.role);
  const placeImporter = !!me && canImport && !companyRole;
  const targetCompany = companyRole ? me?.company ?? '' : declaringCompany;
  const ready = canImport && !!targetCompany;

  // SEC-07/21 : lecture minimisée par rôle — `GET /referential/companies` n'est appelée que pour
  // un rôle place (qui choisit la compagnie déclarante), jamais pour un rôle compagnie (sa
  // compagnie est imposée par le jeton, voir `company.test.tsx` : aucun appel à cette route pour
  // ce rôle). La bannière "Compagnies admises" (capture) n'est donc affichée, elle aussi, que
  // pour un rôle place — elle réutilise la même liste que le sélecteur, pas un second appel.
  const companiesQuery = useQuery({
    queryKey: ['referential', 'companies', 'import-picker'],
    queryFn: () => apiGet<Paginated<CompanyListItem>>('/referential/companies', { page: 1, pageSize: 100 }),
    enabled: placeImporter,
  });
  const activeCompanies = (companiesQuery.data?.items ?? []).filter((c) => c.status === 'ACTIF');
  const companyOptions = activeCompanies;

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
      // Rôle compagnie : aucun paramètre, le backend retient la compagnie du jeton.
      return apiPostForm<ClaimImportReport>('/claims/import', form, placeImporter ? { company: declaringCompany } : undefined);
    },
    onSuccess: (report) => {
      setImportError(null);
      setJournal((prev) => [report, ...prev]);
      setReportPage(1);
      setWarningsPage(1);
      toast(t('import.toast.success'), 'ok');
    },
    onError: (err: unknown) => {
      const message = errorMessage(err, t('import.toast.error'));
      setImportError(message);
      toast(message, 'ko');
    },
  });

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!ready || !files || files.length === 0) return;
      importMutation.mutate(files[0]);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [ready, importMutation],
  );

  function onDownloadTemplate(version: 'v1' | 'v2') {
    const cols = version === 'v1' ? columnsQuery.data : columnsV2Query.data;
    if (!cols) return;
    downloadCsv(version === 'v1' ? 'modele-47-colonnes-IDA.csv' : `modele-v2-${cols.length}-colonnes-IDA.csv`, buildColumnsCsv(cols));
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
    { key: 'code', header: t('import.warnings.col.code'), render: (w) => <Tag tone={warningTone(w.code)}>{WARNING_LABELS[w.code] ? t(WARNING_LABELS[w.code]) : w.code}</Tag> },
    { key: 'message', header: t('import.warnings.col.message'), render: (w) => w.message },
  ];

  const reportColumns: Column<ClaimImportRowResult>[] = [
    { key: 'rowNumber', header: t('import.col.row'), render: (r) => <span className="mono">{r.rowNumber}</span> },
    {
      key: 'verdict',
      header: t('import.col.verdict'),
      render: (r) => (
        <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
          <Tag tone={r.verdict === 'ELIGIBLE_IDA' ? 'ok' : 'ko'}>{r.verdict === 'ELIGIBLE_IDA' ? t('import.verdict.eligible') : t('import.verdict.ineligible')}</Tag>
          {r.rejected ? <Tag tone="warn">{t('import.verdict.rejected')}</Tag> : null}
        </span>
      ),
    },
    {
      key: 'reasons',
      header: t('import.col.reasons'),
      render: (r) => (r.reasons.length > 0 ? r.reasons.join(' · ') : <span style={{ color: 'var(--ink-3)' }}>—</span>),
    },
  ];

  return (
    <>
      <FolioHeader
        badge="Module A · §6.3 · Art. 14"
        title={t('import.title')}
        subtitle={t('import.subtitle')}
        actions={
          <>
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
                title={t('import.template.note')}
                style={{ padding: '8px 16px', borderRadius: 'var(--k-r-s)', border: '1px solid var(--rule-strong)', background: 'var(--paper)', color: 'var(--ink)', font: 'inherit', cursor: data ? 'pointer' : 'not-allowed' }}
              >
                {label} ({data?.length ?? '…'} {t('import.template.columns')})
              </button>
            ))}
          </>
        }
      />

      {!canImport ? (
        <div className="note warn" role="alert" style={{ marginBottom: 'var(--s-5)' }}>
          <strong>{t('import.forbidden.title')}</strong>
          <span>{t('import.forbidden.body')}</span>
        </div>
      ) : null}

      {canImport ? (
        <div className="sheet" style={{ marginBottom: 'var(--s-5)' }}>
          <div className="sheet-body">
            {/* SEC-02 : compagnie déclarante — choisie par un rôle place, imposée par le jeton pour un rôle compagnie. */}
            <div style={{ marginBottom: 'var(--s-4)' }}>
              {placeImporter ? (
                companiesQuery.error ? (
                  <div className="note ko" role="alert">
                    <span>{t('common.error')}</span>
                    <button type="button" onClick={() => companiesQuery.refetch()}>
                      {t('common.retry')}
                    </button>
                  </div>
                ) : (
                  <>
                    <LabeledSelect
                      label={t('import.company.label')}
                      value={declaringCompany}
                      required
                      disabled={companiesQuery.isLoading || importMutation.isPending}
                      onChange={setDeclaringCompany}
                      options={[
                        { value: '', label: companiesQuery.isLoading ? t('common.loading') : t('import.company.placeholder') },
                        ...companyOptions.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` })),
                      ]}
                    />
                    <p style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)', margin: '4px 0 0' }}>{t('import.company.placeHint')}</p>
                  </>
                )
              ) : companyRole ? (
                <p style={{ fontSize: 'var(--k-fs-s)', margin: 0 }}>
                  {t('import.company.own')} <strong className="mono">{me?.company ?? '—'}</strong>
                </p>
              ) : null}
            </div>

            {/* Bandeau d'information (capture) — liste RÉELLE des compagnies actives
                (`GET /referential/companies`), jamais une liste figée en dur. Rôle place
                uniquement (même périmètre que le sélecteur ci-dessus, SEC-07/21). */}
            {placeImporter ? (
              <p className="note" role="note" style={{ fontSize: 'var(--k-fs-xs)', marginBottom: 'var(--s-4)' }}>
                {t('import.notice.companies')}{' '}
                {companiesQuery.isLoading ? t('import.notice.companiesLoading') : activeCompanies.map((c) => c.code).join(' · ') || '—'}
              </p>
            ) : null}

            {/* Zone de dépôt drag-drop (A.4, écran 3) — inactive tant que la compagnie déclarante n'est pas choisie. */}
            <div
                  role="button"
                  tabIndex={ready ? 0 : -1}
                  aria-disabled={!ready}
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
                  onClick={() => ready && fileInputRef.current?.click()}
                  onKeyDown={(e) => {
                    if (ready && (e.key === 'Enter' || e.key === ' ')) fileInputRef.current?.click();
                  }}
                  style={{
                    border: `2px dashed ${dragOver ? 'var(--k-pri)' : 'var(--rule-strong)'}`,
                    borderRadius: 'var(--k-r-l)',
                    padding: 'var(--s-8)',
                    textAlign: 'center',
                    cursor: ready ? 'pointer' : 'not-allowed',
                    opacity: ready ? 1 : 0.6,
                    background: dragOver ? 'var(--k-mint)' : 'var(--sheet)',
                  }}
                >
                  <strong style={{ display: 'block', marginBottom: 'var(--s-2)' }}>{t('import.dropzone.title')}</strong>
                  <p style={{ color: 'var(--ink-2)', marginBottom: 'var(--s-3)' }}>{ready ? t('import.dropzone.subtitle') : t('import.company.required')}</p>
                  <button
                    type="button"
                    disabled={!ready || importMutation.isPending}
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                    style={{ padding: '8px 16px', borderRadius: 'var(--k-r-s)', border: '1px solid var(--k-pri)', background: 'var(--k-pri)', color: '#fff', font: 'inherit', cursor: ready ? 'pointer' : 'not-allowed' }}
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
                ) : importError ? (
                  <p className="note ko" role="alert" style={{ marginTop: 'var(--s-3)' }}>
                    {importError}
                  </p>
                ) : null}
          </div>
        </div>
      ) : null}

      {/* "Aperçu des lignes importées" (capture) — verdict d'éligibilité IDA réel par ligne
          (API, ligne à ligne), pas de donnée recalculée côté front (C.1). */}
      <div className="sheet" style={{ marginBottom: 'var(--s-5)' }}>
        <div className="sheet-head">
          <span>{t('import.preview.title')}</span>
        </div>
        <div className="sheet-body">
          {!latestReport ? (
            <p style={{ color: 'var(--ink-3)' }}>{t('import.preview.empty')}</p>
          ) : (
            <>
              <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--s-3)', marginBottom: 'var(--s-4)' }}>
                <Field label={t('import.report.file')}>
                  <span className="mono">{latestReport.fileName}</span>
                </Field>
                <Field label={t('import.report.company')}>
                  <span className="mono">{latestReport.company ?? '—'}</span>
                </Field>
                <Field label={t('import.report.importedAt')}>{new Date(latestReport.importedAt).toLocaleString(locale)}</Field>
                <Field label={t('import.report.total')}>{latestReport.totalRows}</Field>
                <Field label={t('import.report.eligible')}>
                  <Tag tone="ok">{latestReport.eligibleCount}</Tag>
                </Field>
                <Field label={t('import.report.ineligible')}>
                  <Tag tone="ko">{latestReport.ineligibleCount}</Tag>
                </Field>
                <Field label={t('import.report.rejected')}>
                  <Tag tone={latestReport.rejectedCount > 0 ? 'warn' : 'a'}>{latestReport.rejectedCount ?? 0}</Tag>
                </Field>
              </dl>
              {latestReport.rejectedCount > 0 ? (
                <p className="note warn" role="status" style={{ fontSize: 'var(--k-fs-xs)' }}>
                  {t('import.report.rejectedNote')}
                </p>
              ) : null}

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

      {/* "Historique des lots importés" (capture) — journal de la session courante uniquement
          (pas de persistance back pour cet écran), un lot par import réussi. */}
      <div className="sheet">
        <div className="sheet-head">
          <span>{t('import.history.title')}</span>
        </div>
        <div className="sheet-body">
          {journal.length === 0 ? (
            <p style={{ color: 'var(--ink-3)' }}>{t('import.history.empty')}</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {journal.map((r, i) => (
                <li key={`${r.fileName}-${r.importedAt}-${i}`} style={{ fontSize: 'var(--k-fs-s)', color: 'var(--ink-2)', display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                  <span className="mono">
                    {r.fileName} · {r.company}
                  </span>
                  <span>{new Date(r.importedAt).toLocaleString(locale)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
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
