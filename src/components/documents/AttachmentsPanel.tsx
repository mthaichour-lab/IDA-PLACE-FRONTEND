'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { apiGet, apiPostForm } from '@/lib/api-client';
import { ApiError } from '@/lib/api-error';
import { useAuth } from '@/lib/auth-context';
import { DocumentView } from '@/lib/types';

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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export function AttachmentsPanel({ recoursId, commissionCaseId }: AttachmentsPanelProps) {
  const { t, locale } = useI18n();
  const { hasPrivilege } = useAuth();
  const { toast } = useToast();
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
      return apiPostForm<DocumentView>('/documents/upload', form);
    },
    onSuccess: () => {
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      toast(t('documents.attachments.toast.uploadOk'), 'ok');
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (err: unknown) => {
      const message = err instanceof ApiError ? err.message : t('documents.attachments.toast.uploadError');
      toast(message || t('documents.attachments.toast.uploadError'), 'ko');
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
          {items.map((doc) => (
            <li key={doc.id} style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)', display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <span>
                <a href={doc.url} target="_blank" rel="noreferrer" className="mono">
                  {doc.filename}
                </a>
                <span style={{ color: 'var(--ink-3)' }}> · {formatSize(doc.sizeBytes)}</span>
              </span>
              <span style={{ color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
                {t('documents.attachments.uploadedBy')} {doc.uploadedBy} · {new Date(doc.uploadedAt).toLocaleString(locale)}
              </span>
            </li>
          ))}
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
