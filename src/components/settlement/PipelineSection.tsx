'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Tag, TagTone } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { TranslationKey } from '@/i18n/translations';
import { apiGet, apiPost } from '@/lib/api-client';
import { ApiError } from '@/lib/api-error';
import { useAuth } from '@/lib/auth-context';
import { MANUAL_PIPELINE_STEPS, PipelineStep, PipelineStepStatus, QuarterlyPipeline } from '@/lib/types';

const POLL_INTERVAL_MS = 30_000;

const pipelineQueryKey = (quarter: string) => ['settlement', 'quarter', quarter, 'pipeline'];

function statusTone(status: PipelineStepStatus): TagTone {
  if (status === 'DONE') return 'ok';
  if (status === 'EN_COURS') return 'warn';
  return 'a';
}

function formatIsoDate(iso: string, locale: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString(locale, { timeZone: 'UTC' });
}

export function PipelineSection({ quarter }: { quarter: string }) {
  const { t, locale } = useI18n();
  const { hasPrivilege } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);

  const canComplete = hasPrivilege('closeQuarter');

  const pipelineQuery = useQuery({
    queryKey: pipelineQueryKey(quarter),
    queryFn: () => apiGet<QuarterlyPipeline>(`/settlement/quarter/${quarter}/pipeline`),
    refetchInterval: POLL_INTERVAL_MS,
  });

  const completeMutation = useMutation({
    mutationFn: (step: PipelineStep) => apiPost<QuarterlyPipeline>(`/settlement/quarter/${quarter}/pipeline/${step}/complete`, { note: note.trim() || undefined }),
    onSuccess: () => {
      setNote('');
      toast(t('quarter.pipeline.toast.ok'), 'ok');
      void queryClient.invalidateQueries({ queryKey: pipelineQueryKey(quarter) });
    },
    onError: (err: unknown) => toast(err instanceof ApiError && err.message ? err.message : t('quarter.pipeline.toast.error'), 'ko'),
  });

  const closeMutation = useMutation({
    mutationFn: () => apiPost(`/settlement/quarter/${quarter}/close`, {}),
    onSuccess: () => {
      setConfirmClose(false);
      toast(t('quarter.pipeline.close.ok'), 'ok');
      void queryClient.invalidateQueries({ queryKey: ['settlement'] });
    },
    onError: (err: unknown) => toast(err instanceof ApiError && err.message ? err.message : t('quarter.pipeline.close.error'), 'ko'),
  });

  return (
    <div className="sheet" style={{ marginTop: 'var(--s-5)' }}>
      <div className="sheet-head">
        <span>{t('quarter.pipeline.title')}</span>
      </div>
      <div className="sheet-body">
        {pipelineQuery.isLoading ? (
          <p>{t('common.loading')}</p>
        ) : pipelineQuery.error || !pipelineQuery.data ? (
          <div className="note ko" role="alert">
            <span>{t('common.error')}</span>
            <button type="button" onClick={() => pipelineQuery.refetch()}>
              {t('common.retry')}
            </button>
          </div>
        ) : (
          <ol aria-label={t('quarter.pipeline.title')} style={{ margin: 0, paddingInlineStart: 'var(--s-5)', display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
            {pipelineQuery.data.steps.map((s) => {
              const manual = MANUAL_PIPELINE_STEPS.includes(s.step);
              return (
                <li key={s.step} data-testid={`pipeline-step-${s.step}`} style={{ paddingBottom: 'var(--s-3)', borderBottom: '1px solid var(--rule)' }}>
                  <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap', alignItems: 'center' }}>
                    <strong>{s.label}</strong>
                    <span className="mono" style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)' }}>
                      {s.article}
                    </span>
                    <Tag tone={statusTone(s.status)}>{t(`quarter.pipeline.status.${s.status}` as TranslationKey)}</Tag>
                    {s.overdue ? <Tag tone="ko">{t('quarter.pipeline.overdue')}</Tag> : null}
                  </div>
                  <p style={{ margin: 'var(--s-1) 0 0', fontSize: 'var(--k-fs-s)', color: 'var(--ink-2)' }}>
                    {t('quarter.pipeline.dueDate')} : <span className="mono">{formatIsoDate(s.dueDate, locale)}</span>
                    {s.completedAt ? (
                      <>
                        {' · '}
                        {t('quarter.pipeline.completedBy')} {s.completedBy ?? '—'} · {new Date(s.completedAt).toLocaleString(locale)}
                      </>
                    ) : null}
                    {s.note ? ` — ${s.note}` : null}
                  </p>
                  {!manual ? <p style={{ margin: 'var(--s-1) 0 0', fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)' }}>{t('quarter.pipeline.closureStep')}</p> : null}
                  {!manual && s.status === 'EN_COURS' && canComplete ? (
                    <button
                      type="button"
                      className="tag ok"
                      style={{ border: 'none', cursor: 'pointer', marginTop: 'var(--s-2)' }}
                      onClick={() => setConfirmClose(true)}
                    >
                      {t('quarter.pipeline.close.button')}
                    </button>
                  ) : null}
                  {manual && s.status === 'EN_COURS' && canComplete ? (
                    <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 'var(--s-2)' }}>
                      <div>
                        <label htmlFor="pipeline-note" style={{ display: 'block', fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)', marginBottom: 4 }}>
                          {t('quarter.pipeline.note')}
                        </label>
                        <input
                          id="pipeline-note"
                          type="text"
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          style={{ padding: '6px 10px', border: '1px solid var(--rule-strong)', borderRadius: 'var(--k-r-s)', font: 'inherit', background: 'var(--paper)', color: 'var(--ink)' }}
                        />
                      </div>
                      <button
                        type="button"
                        className="tag ok"
                        style={{ border: 'none', cursor: completeMutation.isPending ? 'not-allowed' : 'pointer' }}
                        disabled={completeMutation.isPending}
                        onClick={() => completeMutation.mutate(s.step)}
                      >
                        {t('quarter.pipeline.complete')}
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </div>
      <Modal
        open={confirmClose}
        title={t('quarter.pipeline.close.title')}
        onClose={() => setConfirmClose(false)}
        footer={
          <>
            <button type="button" className="tag" style={{ border: 'none', cursor: 'pointer' }} onClick={() => setConfirmClose(false)}>
              {t('quarter.pipeline.close.cancel')}
            </button>
            <button
              type="button"
              className="tag ok"
              style={{ border: 'none', cursor: closeMutation.isPending ? 'not-allowed' : 'pointer' }}
              disabled={closeMutation.isPending}
              onClick={() => closeMutation.mutate()}
            >
              {t('quarter.pipeline.close.confirm')}
            </button>
          </>
        }
      >
        <p style={{ margin: 0 }}>{t('quarter.pipeline.close.warning')}</p>
      </Modal>
    </div>
  );
}
