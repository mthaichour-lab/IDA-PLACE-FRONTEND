'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { FolioHeader } from '@/components/FolioHeader';
import { Download, FileText, ShieldCheck, Upload } from 'lucide-react';
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


  // Boutons d'en-tête : v2 (modèle complet, barème Art. 14) en primaire, v1 en bouton fantôme —
  // emplacement des « Modèle Excel / Modèle CSV » de la capture ; les deux sont des CSV d'en-têtes.
  const templates = [
    { version: 'v2', label: t('import.template.v2.short'), data: columnsV2Query.data, primary: true },
    { version: 'v1', label: t('import.template.v1.short'), data: columnsQuery.data, primary: false },
  ] as const;

  return (
    <div className="im-screen">
      <FolioHeader
        badge="Module A · §6.3 · Art. 14"
        title={t('import.title')}
        subtitle={t('import.subtitle')}
        actions={
          <>
            {templates.map(({ version, label, data, primary }) => (
              <button
                key={version}
                type="button"
                className={primary ? 'btn-primary im-btn' : 'im-ghost'}
                onClick={() => onDownloadTemplate(version)}
                disabled={!data}
                title={`${data?.length ?? '…'} ${t('import.template.columns')} — ${t('import.template.note')}`}
              >
                <Download size={15} strokeWidth={2} aria-hidden="true" />
                {label}
              </button>
            ))}
          </>
        }
      />

      {!canImport ? (
        <div className="note warn im-forbidden" role="alert">
          <strong>{t('import.forbidden.title')}</strong>
          <span>{t('import.forbidden.body')}</span>
        </div>
      ) : null}

      {canImport ? (
        <div className="sheet im-upload">
          <div className="sheet-body">
            {/* SEC-02 : compagnie déclarante — choisie par un rôle place, imposée par le jeton pour un rôle compagnie. */}
            <div className="im-company">
              {placeImporter ? (
                companiesQuery.error ? (
                  <div className="note ko" role="alert">
                    <span>{t('common.error')}</span>
                    <button type="button" onClick={() => companiesQuery.refetch()}>
                      {t('common.retry')}
                    </button>
                  </div>
                ) : (
                  <label className="im-field">
                    <span className="im-field-label">{t('import.company.label')}</span>
                    <select
                      className="im-select"
                      value={declaringCompany}
                      required
                      disabled={companiesQuery.isLoading || importMutation.isPending}
                      onChange={(e) => setDeclaringCompany(e.target.value)}
                    >
                      <option value="">{companiesQuery.isLoading ? t('common.loading') : t('import.company.placeholder')}</option>
                      {companyOptions.map((c) => (
                        <option key={c.code} value={c.code}>
                          {`${c.code} — ${c.name}`}
                        </option>
                      ))}
                    </select>
                  </label>
                )
              ) : companyRole ? (
                <p className="im-own">
                  {t('import.company.own')} <strong className="mono">{me?.company ?? '—'}</strong>
                </p>
              ) : null}
            </div>

            {/* Bandeau d'information (capture) — liste RÉELLE des compagnies actives
                (`GET /referential/companies`), jamais une liste figée en dur. Rôle place
                uniquement (même périmètre que le sélecteur ci-dessus, SEC-07/21). Volontairement
                SANS « fichier lu localement / aucun envoi réseau » : le fichier est transmis à
                l'API (`POST /claims/import`) — la règle d'attribution SEC-02 la remplace. */}
            {placeImporter ? (
              <p className="im-notice" role="note">
                <ShieldCheck size={15} strokeWidth={2} aria-hidden="true" />
                <span>
                  {t('import.company.placeHint')} {t('import.notice.companies')}{' '}
                  {companiesQuery.isLoading ? t('import.notice.companiesLoading') : activeCompanies.map((c) => c.code).join(' · ') || '—'}
                </span>
              </p>
            ) : null}

            {/* Zone de dépôt drag-drop (A.4, écran 3) — inactive tant que la compagnie déclarante n'est pas choisie. */}
            <div
              role="button"
              tabIndex={ready ? 0 : -1}
              aria-disabled={!ready}
              aria-label={t('import.dropzone.title')}
              className={`im-drop${dragOver ? ' is-over' : ''}${ready ? '' : ' is-disabled'}`}
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
            >
              <Upload className="im-drop-icon" size={24} strokeWidth={1.8} aria-hidden="true" />
              <strong className="im-drop-title">{t('import.dropzone.title')}</strong>
              <p className="im-drop-sub">{ready ? t('import.dropzone.subtitle') : t('import.company.required')}</p>
              <button
                type="button"
                className="btn-primary im-btn"
                disabled={!ready || importMutation.isPending}
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
              >
                <FileText size={15} strokeWidth={2} aria-hidden="true" />
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
              <p role="status" className="im-status">
                {t('import.uploading')}
              </p>
            ) : importError ? (
              <p className="note ko im-status" role="alert">
                {importError}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* "Aperçu des lignes importées" (capture) — verdict d'éligibilité IDA réel par ligne
          (API, ligne à ligne), pas de donnée recalculée côté front (C.1). */}
      <div className="sheet im-preview">
        <div className="sheet-head">
          <span>{t('import.preview.title')}</span>
        </div>
        <div className="sheet-body">
          {!latestReport ? (
            <p className="im-empty">{t('import.preview.empty')}</p>
          ) : (
            <>
              <dl className="im-report">
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
                <p className="note warn im-note" role="status">
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
                <section aria-label={t('import.warnings.title')} className="im-warnings">
                  <strong className="im-warnings-title">
                    {t('import.warnings.title')} ({warnings.length})
                  </strong>
                  <p className="im-warnings-note">{t('import.warnings.note')}</p>
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
      <div className="sheet im-history">
        <div className="sheet-head">
          <span>{t('import.history.title')}</span>
        </div>
        <div className="sheet-body">
          {journal.length === 0 ? (
            <p className="im-empty">{t('import.history.empty')}</p>
          ) : (
            <ul className="im-history-list">
              {journal.map((r, i) => (
                <li key={`${r.fileName}-${r.importedAt}-${i}`}>
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
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="im-report-label">{label}</dt>
      <dd className="im-report-value">{children}</dd>
    </div>
  );
}
