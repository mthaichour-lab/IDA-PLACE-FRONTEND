'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { API_BASE_URL, apiGet, apiGetBlob, apiPath, apiPostForm } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { useApiErrorMessage } from '@/lib/error-message';
import { safeDocumentUrl } from '@/lib/safe-values';
import { DocumentUploadResult, DocumentView } from '@/lib/types';

/** Types acceptés côté UI — simple indication (`accept`), la VRAIE validation est serveur (QUESTIONS_UAR.md §9). */
const ACCEPT_HINT = '.pdf,.jpg,.jpeg,.png,.webp';

/**
 * `AttachmentsPanel` — composant transverse pour les pièces manuelles
 * (Annexe 2/3/4, PV de commission) attachées à un `Recours` (écran 4,
 * `/exchanges`) ou un `CommissionCase` (écran 7, `/commission`).
 *
 * QUESTIONS_UAR.md §9, décision Product Owner 2026-10-18 : un document est
 * attaché à AU PLUS UN des deux dossiers, jamais les deux à la fois — ce
 * type union impose ce choix exclusif dès la compilation, avant même
 * d'atteindre l'API (qui le revalide de toute façon côté serveur, règle
 * d'or C.1).
 */
type AttachmentsPanelProps = { recoursId: string; commissionCaseId?: never } | { recoursId?: never; commissionCaseId: string };

/**
 * SEC-10 : URL S3 pré-signée (https, hors de l'origine de l'API) — ouvrable
 * telle quelle. Toute autre URL (route API `/documents/:id/download`, qui
 * exige le jeton, ou adresse non sûre) passe par le téléchargement
 * authentifié par identifiant : jamais par un simple lien.
 */
function presignedExternalUrl(raw: string): string | undefined {
  const href = safeDocumentUrl(raw);
  if (!href || !href.startsWith('https:')) return undefined;
  try {
    if (API_BASE_URL && new URL(href).origin === new URL(API_BASE_URL).origin) return undefined;
  } catch {
    return undefined;
  }
  return href;
}

/** Enregistre un Blob sous son nom de fichier (lien `blob:` éphémère, révoqué aussitôt après). */
function saveBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1_000);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export function AttachmentsPanel({ recoursId, commissionCaseId }: AttachmentsPanelProps) {
  const { t, locale } = useI18n();
  const { hasPrivilege } = useAuth();
  const { toast } = useToast();
  const errorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const canUpload = hasPrivilege('insert');

  const query = recoursId ? { recoursId } : { commissionCaseId };
  const queryKey = recoursId ? ['documents', 'recours', recoursId] : ['documents', 'commissionCase', commissionCaseId];

  const listQuery = useQuery({
    queryKey,
    queryFn: () => apiGet<DocumentView[]>('/documents', query),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      if (recoursId) form.append('recoursId', recoursId);
      else form.append('commissionCaseId', commissionCaseId as string);
      // SEC-10 : la réponse porte l'`id` du document (plus de `key`) ; la liste est relue.
      return apiPostForm<DocumentUploadResult>('/documents/upload', form);
    },
    onSuccess: () => {
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      toast(t('documents.attachments.toast.uploadOk'), 'ok');
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (err: unknown) => {
      toast(errorMessage(err, t('documents.attachments.toast.uploadError')), 'ko');
    },
  });

  // SEC-10/11 : `GET /documents/:id/download` est authentifiée — récupérée avec le jeton puis enregistrée.
  const downloadMutation = useMutation({
    mutationFn: (doc: DocumentView) => apiGetBlob(apiPath`/documents/${doc.id}/download`),
    onSuccess: (blob, doc) => saveBlob(blob, doc.filename),
    onError: (err: unknown) => {
      toast(errorMessage(err, t('documents.attachments.toast.downloadError')), 'ko');
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFile) return;
    uploadMutation.mutate(selectedFile);
  }

  const items = listQuery.data ?? [];

  return (
    // `aria-label` (plutôt qu'un <strong> visible en doublon) : l'écran appelant
    // (/exchanges, /commission) porte déjà son propre titre de section
    // (`exchanges.detail.attachments`/`commission.detail.attachments`, même
    // style que "Fil d'échanges") juste au-dessus de ce composant transverse.
    <div aria-label={t('documents.attachments.title')}>
      {listQuery.isLoading ? (
        <p>{t('common.loading')}</p>
      ) : listQuery.error ? (
        <div className="note ko" role="alert">
          <span>{t('common.error')}</span>
          <button type="button" onClick={() => listQuery.refetch()}>
            {t('common.retry')}
          </button>
        </div>
      ) : items.length === 0 ? (
        <p style={{ color: 'var(--ink-3)' }}>{t('documents.attachments.empty')}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8, marginBottom: canUpload ? 'var(--s-3)' : 0 }}>
          {items.map((doc) => {
            // SEC-50 : seule une URL S3 pré-signée https est rendue en lien ; sinon téléchargement authentifié par id.
            const href = presignedExternalUrl(doc.url);
            const downloading = downloadMutation.isPending && downloadMutation.variables?.id === doc.id;
            return (
              <li key={doc.id} style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)', display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <span>
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="mono">
                      {doc.filename}
                    </a>
                  ) : (
                    <button
                      type="button"
                      className="mono"
                      onClick={() => downloadMutation.mutate(doc)}
                      disabled={downloading}
                      aria-label={`${t('documents.attachments.download')} ${doc.filename}`}
                      style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', color: 'var(--k-pri)', textDecoration: 'underline', cursor: downloading ? 'progress' : 'pointer' }}
                    >
                      {doc.filename}
                    </button>
                  )}
                  {downloading ? <span role="status"> · {t('documents.attachments.downloading')}</span> : null}
                  <span style={{ color: 'var(--ink-3)' }}> · {formatSize(doc.sizeBytes)}</span>
                </span>
                <span style={{ color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
                  {t('documents.attachments.uploadedBy')} {doc.uploadedBy} · {new Date(doc.uploadedAt).toLocaleString(locale)}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {canUpload ? (
        <form onSubmit={onSubmit}>
          <label htmlFor={`attachments-file-${recoursId ?? commissionCaseId}`} style={{ display: 'block', fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)', marginBottom: 4 }}>
            {t('documents.attachments.uploadLabel')}
          </label>
          <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              id={`attachments-file-${recoursId ?? commissionCaseId}`}
              ref={fileInputRef}
              type="file"
              accept={ACCEPT_HINT}
              disabled={uploadMutation.isPending}
              onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
              style={{ font: 'inherit' }}
            />
            <button
              type="submit"
              className="tag a"
              style={{ border: 'none', cursor: selectedFile && !uploadMutation.isPending ? 'pointer' : 'not-allowed' }}
              disabled={!selectedFile || uploadMutation.isPending}
            >
              {t('documents.attachments.uploadButton')}
            </button>
          </div>
          {uploadMutation.isPending ? (
            <p role="status" style={{ marginTop: 'var(--s-2)', fontSize: 'var(--k-fs-xs)' }}>
              {t('documents.attachments.uploading')}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
