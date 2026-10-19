'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Column, Table } from '@/components/ui/Table';
import { Tag } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { TranslationKey } from '@/i18n/translations';
import { apiDelete, apiGet, apiPath, apiPost, apiPut } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { currentUtcYear, formatIsoDay } from '@/lib/iso-date';
import { CalendarHoliday, MobileHoliday, MobileHolidayKind, MobileHolidayKindOption, PlaceCalendar } from '@/lib/types';
import { apiErrorMessage, FormStack, Hint, LabeledInput, LabeledSelect, PrimaryButton, QueryState, RowAction, RowActions, SubTitle } from './fields';

const PAGE_SIZE = 6; // pagination fixe 6/p — A.5

interface HolidayForm {
  date: string;
  kind: MobileHolidayKind | '';
  hijriYear: string;
}

const EMPTY_HOLIDAY: HolidayForm = { date: '', kind: '', hijriYear: '' };

function MobileStatusTag({ holiday }: { holiday: MobileHoliday }) {
  const { t } = useI18n();
  if (holiday.status === 'CONFIRME') {
    return (
      <Tag tone="ok">
        {t('referential.calendar.mobile.status.CONFIRME')} {holiday.sourceRef}
      </Tag>
    );
  }
  return <Tag tone="warn">{t('referential.calendar.mobile.status.PREVISIONNEL')}</Tag>;
}

/**
 * « Calendrier ouvré » (écran 12), décision PO §2 : week-end légal, fériés
 * à date fixe et fériés mobiles saisis année par année (une ligne par jour
 * chômé, cycle PREVISIONNEL → CONFIRME avec référence obligatoire).
 */
export function CalendarSection() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const { hasPrivilege } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = hasPrivilege('params');

  const thisYear = currentUtcYear();
  const [year, setYear] = useState(thisYear);
  const [fixedPage, setFixedPage] = useState(1);
  const [mobilePage, setMobilePage] = useState(1);

  const calendarQuery = useQuery({
    queryKey: ['referential', 'calendar', year],
    queryFn: () => apiGet<PlaceCalendar>('/referential/calendar', { from: `${year}-01-01`, to: `${year}-12-31` }),
  });
  const mobileQuery = useQuery({
    queryKey: ['referential', 'mobile-holidays', year],
    queryFn: () => apiGet<MobileHoliday[]>('/referential/mobile-holidays', { year }),
  });
  const kindsQuery = useQuery({
    queryKey: ['referential', 'mobile-holiday-kinds'],
    queryFn: () => apiGet<MobileHolidayKindOption[]>('/referential/mobile-holiday-kinds'),
    enabled: canEdit,
  });

  const [holidayModal, setHolidayModal] = useState<{ mode: 'create' } | { mode: 'edit'; id: string } | null>(null);
  const [holidayForm, setHolidayForm] = useState<HolidayForm>(EMPTY_HOLIDAY);
  const [confirmTarget, setConfirmTarget] = useState<MobileHoliday | null>(null);
  const [confirmForm, setConfirmForm] = useState({ sourceRef: '', date: '' });
  const [deleteTarget, setDeleteTarget] = useState<MobileHoliday | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['referential', 'mobile-holidays'] });
    void queryClient.invalidateQueries({ queryKey: ['referential', 'calendar'] });
  };
  const onError = (err: unknown) => toast(apiErrorMessage(err, t('referential.toast.error'), t), 'ko');

  const saveHoliday = useMutation({
    mutationFn: (form: HolidayForm) => {
      const body = { date: form.date, kind: form.kind, hijriYear: form.hijriYear ? Number(form.hijriYear) : undefined };
      return holidayModal?.mode === 'edit' ? apiPut<MobileHoliday>(apiPath`/referential/mobile-holidays/${holidayModal.id}`, body) : apiPost<MobileHoliday>('/referential/mobile-holidays', body);
    },
    onSuccess: () => {
      refresh();
      toast(t('referential.toast.saved'), 'ok');
      setHolidayModal(null);
    },
    onError,
  });

  const confirmHoliday = useMutation({
    // SEC-30 : révision lue renvoyée ; la confirmation par l'auteur du férié est refusée (409 FOUR_EYES, message traduit).
    mutationFn: ({ id, sourceRef, date, revision }: { id: string; sourceRef: string; date: string; revision?: number }) =>
      apiPost<MobileHoliday>(apiPath`/referential/mobile-holidays/${id}/confirm`, { sourceRef: sourceRef.trim(), date: date || undefined, revision }),
    onSuccess: () => {
      refresh();
      toast(t('referential.calendar.mobile.toast.confirmed'), 'ok');
      setConfirmTarget(null);
    },
    onError,
  });

  const deleteHoliday = useMutation({
    mutationFn: (id: string) => apiDelete<{ id: string; deleted: true }>(apiPath`/referential/mobile-holidays/${id}`),
    onSuccess: () => {
      refresh();
      toast(t('referential.calendar.mobile.toast.deleted'), 'ok');
      setDeleteTarget(null);
    },
    onError,
  });

  const fixed = (calendarQuery.data?.holidays ?? []).filter((h) => h.type === 'FIXE');
  const mobile = mobileQuery.data ?? [];

  const fixedColumns: Column<CalendarHoliday>[] = [
    { key: 'date', header: t('referential.calendar.col.date'), render: (r) => formatIsoDay(r.date, locale) },
    { key: 'label', header: t('referential.calendar.col.label'), render: (r) => r.label },
  ];

  const mobileColumns: Column<MobileHoliday>[] = [
    { key: 'date', header: t('referential.calendar.col.date'), render: (r) => formatIsoDay(r.date, locale) },
    { key: 'kind', header: t('referential.calendar.mobile.col.kind'), render: (r) => r.label },
    { key: 'hijriYear', header: t('referential.calendar.mobile.col.hijriYear'), render: (r) => (r.hijriYear ? <span className="mono">{r.hijriYear}</span> : '—') },
    { key: 'status', header: t('referential.company.status'), render: (r) => <MobileStatusTag holiday={r} /> },
  ];
  if (canEdit) {
    mobileColumns.push({
      key: 'actions',
      header: t('referential.col.actions'),
      render: (r) =>
        r.status === 'PREVISIONNEL' ? (
          <RowActions>
            <RowAction
              onClick={() => {
                setHolidayForm({ date: r.date, kind: r.kind, hijriYear: r.hijriYear ? String(r.hijriYear) : '' });
                setHolidayModal({ mode: 'edit', id: r.id });
              }}
            >
              {t('referential.action.edit')}
            </RowAction>
            <RowAction
              onClick={() => {
                setConfirmForm({ sourceRef: '', date: '' });
                setConfirmTarget(r);
              }}
            >
              {t('referential.calendar.mobile.confirm')}
            </RowAction>
            <RowAction onClick={() => setDeleteTarget(r)}>{t('referential.calendar.mobile.delete')}</RowAction>
          </RowActions>
        ) : null,
    });
  }

  const kindOptions = [
    { value: '', label: '—', disabled: true },
    ...(kindsQuery.data ?? []).map((k) => ({ value: k.kind, label: k.label })),
  ];

  return (
    <div className="sheet">
      <div className="sheet-head">
        <span>{t('referential.nav.calendar.title')}</span>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)' }}>
          {t('referential.calendar.year')}
          <select
            value={year}
            onChange={(e) => {
              setYear(Number(e.target.value));
              setFixedPage(1);
              setMobilePage(1);
            }}
            style={{ font: 'inherit', border: '1px solid var(--rule-strong)', borderRadius: 'var(--k-r-s)', padding: '4px 8px', background: 'var(--paper)', color: 'var(--ink)' }}
          >
            {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="sheet-body">
        <QueryState isLoading={calendarQuery.isLoading} error={calendarQuery.error} onRetry={() => calendarQuery.refetch()}>
          <SubTitle>{t('referential.calendar.weekend.title')}</SubTitle>
          <p style={{ marginTop: 0, marginBottom: 'var(--s-4)' }}>
            {(calendarQuery.data?.weekendDays ?? []).map((d) => t(`referential.calendar.day.${d}` as TranslationKey)).join(' – ')}
          </p>

          <SubTitle>{t('referential.calendar.holidays.title')}</SubTitle>
          <Table
            columns={fixedColumns}
            rows={fixed.slice((fixedPage - 1) * PAGE_SIZE, fixedPage * PAGE_SIZE)}
            page={fixedPage}
            total={fixed.length}
            pageSize={PAGE_SIZE}
            onPageChange={setFixedPage}
            getRowKey={(r) => r.date}
          />
        </QueryState>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--s-2)', flexWrap: 'wrap', marginTop: 'var(--s-5)' }}>
          <SubTitle>
            {t('referential.calendar.mobile.title')} {year}
          </SubTitle>
          {canEdit ? (
            <PrimaryButton
              onClick={() => {
                setHolidayForm(EMPTY_HOLIDAY);
                setHolidayModal({ mode: 'create' });
              }}
            >
              {t('referential.calendar.mobile.create')}
            </PrimaryButton>
          ) : null}
        </div>
        <QueryState isLoading={mobileQuery.isLoading} error={mobileQuery.error} onRetry={() => mobileQuery.refetch()}>
          {mobile.length === 0 ? (
            <div className="note warn" role="status" style={{ marginBottom: 'var(--s-3)' }}>
              <span>{t('referential.calendar.mobile.banner').replace('{year}', String(year))}</span>
            </div>
          ) : null}
          <Table
            columns={mobileColumns}
            rows={mobile.slice((mobilePage - 1) * PAGE_SIZE, mobilePage * PAGE_SIZE)}
            page={mobilePage}
            total={mobile.length}
            pageSize={PAGE_SIZE}
            onPageChange={setMobilePage}
            getRowKey={(r) => r.id}
          />
        </QueryState>

        <Hint>{t('referential.calendar.mobileNote')}</Hint>
      </div>

      <Modal
        open={!!holidayModal}
        title={holidayModal?.mode === 'edit' ? t('referential.calendar.mobile.edit.title') : t('referential.calendar.mobile.create')}
        onClose={() => setHolidayModal(null)}
        footer={
          <PrimaryButton disabled={saveHoliday.isPending || !holidayForm.date || !holidayForm.kind} onClick={() => saveHoliday.mutate(holidayForm)}>
            {t('referential.action.save')}
          </PrimaryButton>
        }
      >
        <FormStack>
          <LabeledInput label={t('referential.calendar.col.date')} type="date" value={holidayForm.date} onChange={(v) => setHolidayForm((f) => ({ ...f, date: v }))} />
          <LabeledSelect
            label={t('referential.calendar.mobile.col.kind')}
            value={holidayForm.kind}
            options={kindOptions}
            onChange={(v) => setHolidayForm((f) => ({ ...f, kind: v as MobileHolidayKind }))}
          />
          <LabeledInput
            label={t('referential.calendar.mobile.field.hijriYear')}
            type="number"
            value={holidayForm.hijriYear}
            onChange={(v) => setHolidayForm((f) => ({ ...f, hijriYear: v }))}
          />
        </FormStack>
      </Modal>

      <Modal
        open={!!confirmTarget}
        title={t('referential.calendar.mobile.confirm.title')}
        onClose={() => setConfirmTarget(null)}
        footer={
          <PrimaryButton
            disabled={confirmHoliday.isPending || !confirmForm.sourceRef.trim()}
            onClick={() => confirmTarget && confirmHoliday.mutate({ id: confirmTarget.id, ...confirmForm, revision: confirmTarget.revision })}
          >
            {t('referential.calendar.mobile.confirm')}
          </PrimaryButton>
        }
      >
        {confirmTarget ? (
          <FormStack>
            <p style={{ margin: 0 }}>
              {confirmTarget.label} · {formatIsoDay(confirmTarget.date, locale)}
            </p>
            <LabeledInput label={t('referential.calendar.mobile.confirm.sourceRef')} value={confirmForm.sourceRef} required onChange={(v) => setConfirmForm((f) => ({ ...f, sourceRef: v }))} />
            <LabeledInput label={t('referential.calendar.mobile.confirm.date')} type="date" value={confirmForm.date} onChange={(v) => setConfirmForm((f) => ({ ...f, date: v }))} />
          </FormStack>
        ) : null}
      </Modal>

      <Modal
        open={!!deleteTarget}
        title={t('referential.calendar.mobile.delete.title')}
        onClose={() => setDeleteTarget(null)}
        footer={
          <PrimaryButton disabled={deleteHoliday.isPending} onClick={() => deleteTarget && deleteHoliday.mutate(deleteTarget.id)}>
            {t('referential.calendar.mobile.delete')}
          </PrimaryButton>
        }
      >
        {deleteTarget ? (
          <p style={{ margin: 0 }}>
            {deleteTarget.label} · {formatIsoDay(deleteTarget.date, locale)} — {t('referential.calendar.mobile.delete.body')}
          </p>
        ) : null}
      </Modal>
    </div>
  );
}
