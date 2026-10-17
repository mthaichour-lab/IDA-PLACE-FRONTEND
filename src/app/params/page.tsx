'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { FolioHeader } from '@/components/FolioHeader';
import { CompanyPeriodPicker } from '@/components/metering/CompanyPeriodPicker';
import { PriceGridEditor } from '@/components/metering/PriceGridEditor';
import { BarChart } from '@/components/ui/BarChart';
import { Modal } from '@/components/ui/Modal';
import { Table, Column } from '@/components/ui/Table';
import { Tabs } from '@/components/ui/Tabs';
import { Tag } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { apiGet, apiPost, apiPut } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { buildRecentPeriods } from '@/lib/period-options';
import { CompanyView, MeteringInvoice, Paginated, PlaceUser, PriceGrid, RolesMatrixResponse } from '@/lib/types';

const PAGE_SIZE = 7; // pagination fixe 7/p — A.5
const PERIODS = buildRecentPeriods(12);

type ParamsTab = 'users' | 'roles' | 'costs';

function statusTone(active: boolean) {
  return active ? ('ok' as const) : ('warn' as const);
}

export default function ParamsPage() {
  const { t } = useI18n();
  const { hasPrivilege } = useAuth();
  const [tab, setTab] = useState<ParamsTab>('users');

  if (!hasPrivilege('admin')) {
    return (
      <>
        <FolioHeader badge="Admin · §5.1" title={t('params.title')} subtitle={t('params.subtitle')} />
        <div className="note warn" role="alert">
          <div>
            <strong style={{ display: 'block', marginBottom: 4 }}>{t('params.forbidden.title')}</strong>
            <span>{t('params.forbidden.body')}</span>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <FolioHeader badge="Admin · §5.1" title={t('params.title')} subtitle={t('params.subtitle')} />

      <Tabs
        items={[
          { key: 'users', label: t('params.tab.users') },
          { key: 'roles', label: t('params.tab.roles') },
          { key: 'costs', label: t('params.tab.costs') },
        ]}
        activeKey={tab}
        onChange={(k) => setTab(k as ParamsTab)}
      />

      {tab === 'users' ? <UsersTab /> : tab === 'roles' ? <RolesTab /> : <CostsTab />}
    </>
  );
}

/* ===================== Utilisateurs & accès ===================== */

function UsersTab() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<PlaceUser | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', role: '', companyId: '' });

  const usersQuery = useQuery({
    queryKey: ['admin', 'users', page],
    queryFn: () => apiGet<Paginated<PlaceUser>>('/admin/users', { page, pageSize: PAGE_SIZE }),
  });

  const matrixQuery = useQuery({
    queryKey: ['admin', 'roles', 'matrix'],
    queryFn: () => apiGet<RolesMatrixResponse>('/admin/roles/matrix'),
  });

  const createMutation = useMutation({
    mutationFn: (body: Partial<PlaceUser>) => apiPost<PlaceUser>('/admin/users', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      toast(t('params.users.toast.created'), 'ok');
      setCreateOpen(false);
      setForm({ name: '', email: '', role: '', companyId: '' });
    },
    onError: () => toast(t('params.users.toast.error'), 'ko'),
  });

  const [editActive, setEditActive] = useState(true);
  const [editGrant, setEditGrant] = useState<string[]>([]);
  const [editRevoke, setEditRevoke] = useState<string[]>([]);

  useEffect(() => {
    if (!selected) return;
    setEditActive(selected.active);
    setEditGrant(selected.grant);
    setEditRevoke(selected.revoke);
  }, [selected?.id]);

  const updateMutation = useMutation({
    mutationFn: (body: { active: boolean; grant: string[]; revoke: string[] }) => apiPut<PlaceUser>(`/admin/users/${selected!.id}`, body),
    onSuccess: (updated) => {
      setSelected(updated);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      toast(t('params.users.detail.saved'), 'ok');
    },
    onError: () => toast(t('params.users.detail.saveError'), 'ko'),
  });

  function toggleIn(list: string[], setList: (v: string[]) => void, privilege: string) {
    setList(list.includes(privilege) ? list.filter((p) => p !== privilege) : [...list, privilege]);
  }

  const pageRows = usersQuery.data?.items ?? [];
  const roles = matrixQuery.data?.roles ?? [];
  const privileges = useMemo(
    () => (roles.length && matrixQuery.data ? Object.keys(matrixQuery.data.matrix[roles[0]] ?? {}) : []),
    [roles, matrixQuery.data],
  );

  const columns: Column<PlaceUser>[] = [
    { key: 'name', header: t('params.users.col.name'), render: (r) => r.name },
    { key: 'email', header: t('params.users.col.email'), render: (r) => <span className="mono">{r.email}</span> },
    { key: 'role', header: t('params.users.col.role'), render: (r) => <span className="mono">{r.role}</span> },
    { key: 'company', header: t('params.users.col.company'), render: (r) => r.companyId ?? '—' },
    {
      key: 'status',
      header: t('params.users.col.status'),
      render: (r) => <Tag tone={statusTone(r.active)}>{r.active ? t('params.users.status.active') : t('params.users.status.suspended')}</Tag>,
    },
  ];

  return (
    <div className="sheet">
      <div className="sheet-head">
        <span>{t('params.users.title')}</span>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          style={{ padding: '6px 12px', borderRadius: 'var(--k-r-s)', border: '1px solid var(--k-pri)', background: 'var(--k-pri)', color: '#fff', font: 'inherit', cursor: 'pointer' }}
        >
          {t('params.users.create')}
        </button>
      </div>
      <div className="sheet-body">
        {usersQuery.isLoading ? (
          <p>{t('common.loading')}</p>
        ) : usersQuery.error ? (
          <div className="note ko" role="alert">
            <span>{t('common.error')}</span>
            <button type="button" onClick={() => usersQuery.refetch()}>
              {t('common.retry')}
            </button>
          </div>
        ) : (
          <Table columns={columns} rows={pageRows} page={page} total={usersQuery.data?.total ?? 0} pageSize={PAGE_SIZE} onPageChange={setPage} onRowClick={setSelected} getRowKey={(r) => r.id} />
        )}
      </div>

      <Modal
        open={!!selected}
        title={`${t('params.users.detail.title')} — ${selected?.name ?? ''}`}
        onClose={() => setSelected(null)}
        footer={
          <button
            type="button"
            disabled={updateMutation.isPending}
            onClick={() => updateMutation.mutate({ active: editActive, grant: editGrant, revoke: editRevoke })}
            style={{ padding: '8px 16px', borderRadius: 'var(--k-r-s)', border: '1px solid var(--k-pri)', background: 'var(--k-pri)', color: '#fff', font: 'inherit', cursor: 'pointer' }}
          >
            {t('params.users.detail.save')}
          </button>
        }
      >
        {selected ? (
          <>
            <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 'var(--s-4)' }}>
              <Field label={t('params.users.col.email')}>
                <span className="mono">{selected.email}</span>
              </Field>
              <Field label={t('params.users.col.role')}>
                <span className="mono">{selected.role}</span>
              </Field>
              <Field label={t('params.users.col.company')}>{selected.companyId ?? '—'}</Field>
              <Field label={t('params.users.col.status')}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} />
                  <Tag tone={statusTone(editActive)}>{editActive ? t('params.users.status.active') : t('params.users.status.suspended')}</Tag>
                </label>
              </Field>
            </dl>

            <strong style={{ display: 'block', marginBottom: 'var(--s-2)', fontSize: 'var(--k-fs-s)' }}>{t('params.users.detail.grant')}</strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-2)', marginBottom: 'var(--s-4)' }}>
              {privileges.map((p) => (
                <label key={p} className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--k-fs-xs)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={editGrant.includes(p)} onChange={() => toggleIn(editGrant, setEditGrant, p)} />
                  {p}
                </label>
              ))}
            </div>

            <strong style={{ display: 'block', marginBottom: 'var(--s-2)', fontSize: 'var(--k-fs-s)' }}>{t('params.users.detail.revoke')}</strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-2)' }}>
              {privileges.map((p) => (
                <label key={p} className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--k-fs-xs)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={editRevoke.includes(p)} onChange={() => toggleIn(editRevoke, setEditRevoke, p)} />
                  {p}
                </label>
              ))}
            </div>
          </>
        ) : null}
      </Modal>

      <Modal
        open={createOpen}
        title={t('params.users.create.title')}
        onClose={() => setCreateOpen(false)}
        footer={
          <button
            type="button"
            disabled={createMutation.isPending || !form.name || !form.email || !form.role}
            onClick={() => createMutation.mutate({ name: form.name, email: form.email, role: form.role, companyId: form.companyId || undefined })}
            style={{ padding: '8px 16px', borderRadius: 'var(--k-r-s)', border: '1px solid var(--k-pri)', background: 'var(--k-pri)', color: '#fff', font: 'inherit', cursor: 'pointer' }}
          >
            {t('params.users.field.submit')}
          </button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
          <LabeledInput label={t('params.users.field.name')} value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
          <LabeledInput label={t('params.users.field.email')} value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} type="email" />
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)' }}>
            {t('params.users.field.role')}
            <select
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              style={{ font: 'inherit', border: '1px solid var(--rule-strong)', borderRadius: 'var(--k-r-s)', padding: '6px 10px', background: 'var(--paper)', color: 'var(--ink)' }}
            >
              <option value="">—</option>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <LabeledInput label={t('params.users.field.company')} value={form.companyId} onChange={(v) => setForm((f) => ({ ...f, companyId: v }))} />
        </div>
      </Modal>
    </div>
  );
}

/* ===================== Rôles & privilèges ===================== */

function RolesTab() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, Record<string, boolean>> | null>(null);

  const matrixQuery = useQuery({
    queryKey: ['admin', 'roles', 'matrix'],
    queryFn: () => apiGet<RolesMatrixResponse>('/admin/roles/matrix'),
  });

  useEffect(() => {
    if (matrixQuery.data && draft === null) setDraft(structuredClone(matrixQuery.data.matrix));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matrixQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (matrix: Record<string, Record<string, boolean>>) => apiPut<RolesMatrixResponse>('/admin/roles/matrix', { matrix }),
    onSuccess: (res) => {
      queryClient.setQueryData(['admin', 'roles', 'matrix'], res);
      setDraft(structuredClone(res.matrix));
      toast(t('params.roles.toast.saved'), 'ok');
    },
    onError: () => toast(t('params.roles.toast.error'), 'ko'),
  });

  const roles = matrixQuery.data?.roles ?? [];
  const privileges = useMemo(() => (roles.length && matrixQuery.data ? Object.keys(matrixQuery.data.matrix[roles[0]] ?? {}) : []), [roles, matrixQuery.data]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(matrixQuery.data?.matrix), [draft, matrixQuery.data]);

  function toggle(role: string, priv: string) {
    if (role === 'AUDITEUR_CSA') return; // toujours lecture seule côté API, inutile d'éditer (B.7)
    setDraft((prev) => (prev ? { ...prev, [role]: { ...prev[role], [priv]: !prev[role][priv] } } : prev));
  }

  if (matrixQuery.isLoading) return <p>{t('common.loading')}</p>;
  if (matrixQuery.error || !matrixQuery.data || !draft) {
    return (
      <div className="note ko" role="alert">
        <span>{t('common.error')}</span>
        <button type="button" onClick={() => matrixQuery.refetch()}>
          {t('common.retry')}
        </button>
      </div>
    );
  }

  return (
    <div className="sheet">
      <div className="sheet-head">
        <span>{t('params.roles.title')}</span>
        <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
          <button
            type="button"
            disabled={!dirty || saveMutation.isPending}
            onClick={() => setDraft(structuredClone(matrixQuery.data!.matrix))}
            style={{ padding: '6px 12px', borderRadius: 'var(--k-r-s)', border: '1px solid var(--rule-strong)', background: 'var(--paper)', color: 'var(--ink)', font: 'inherit', cursor: dirty ? 'pointer' : 'not-allowed' }}
          >
            {t('params.roles.reset')}
          </button>
          <button
            type="button"
            disabled={!dirty || saveMutation.isPending}
            onClick={() => saveMutation.mutate(draft)}
            style={{ padding: '6px 12px', borderRadius: 'var(--k-r-s)', border: '1px solid var(--k-pri)', background: 'var(--k-pri)', color: '#fff', font: 'inherit', cursor: dirty ? 'pointer' : 'not-allowed' }}
          >
            {t('params.roles.save')}
          </button>
        </div>
      </div>
      <div className="sheet-body">
        <p className="note warn" style={{ fontSize: 'var(--k-fs-xs)' }}>
          {t('params.roles.auditorNote')}
        </p>
        <div className="t-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Rôle</th>
                {privileges.map((p) => (
                  <th key={p} className="mono" style={{ textAlign: 'center' }}>
                    {p}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <tr key={role}>
                  <td className="mono">{role}</td>
                  {privileges.map((p) => (
                    <td key={p} style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={!!draft[role]?.[p]}
                        disabled={role === 'AUDITEUR_CSA'}
                        onChange={() => toggle(role, p)}
                        aria-label={`${role} × ${p}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button
          type="button"
          disabled
          title={t('params.roles.custom.note')}
          style={{ marginTop: 'var(--s-4)', padding: '6px 12px', borderRadius: 'var(--k-r-s)', border: '1px solid var(--rule-strong)', background: 'var(--paper)', color: 'var(--ink-3)', font: 'inherit', cursor: 'not-allowed' }}
        >
          {t('params.roles.custom')}
        </button>
        <p style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)', marginTop: 'var(--s-2)' }}>{t('params.roles.custom.note')}</p>
      </div>
    </div>
  );
}

/* ===================== Coûts & tarification ===================== */

function CostsTab() {
  const { t } = useI18n();
  const { hasPrivilege } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [company, setCompany] = useState('CAAT');
  const [period, setPeriod] = useState(PERIODS[0]);
  const canEditGrid = hasPrivilege('grid');

  const companiesQuery = useQuery({
    queryKey: ['referential', 'companies', 'all'],
    queryFn: () => apiGet<Paginated<CompanyView>>('/referential/companies', { page: 1, pageSize: 50 }),
  });

  const invoiceQuery = useQuery({
    queryKey: ['metering', 'invoice', company, period],
    queryFn: () => apiGet<MeteringInvoice>(`/metering/${company}/${period}`),
    enabled: !!company && !!period,
  });

  const gridQuery = useQuery({
    queryKey: ['pricing', 'grid'],
    queryFn: () => apiGet<PriceGrid>('/pricing/grid'),
  });

  const saveGridMutation = useMutation({
    mutationFn: (next: PriceGrid) => apiPut<PriceGrid>('/pricing/grid', next),
    onSuccess: (next) => {
      queryClient.setQueryData(['pricing', 'grid'], next);
      toast(t('metering.toast.gridSaved'), 'ok');
    },
    onError: () => toast(t('metering.toast.gridError'), 'ko'),
  });

  const companies = companiesQuery.data?.items ?? [];
  const invoice = invoiceQuery.data;

  return (
    <>
      <div className="sheet" style={{ marginBottom: 'var(--s-5)' }}>
        <div className="sheet-head">
          <span>{t('params.costs.revenue.title')}</span>
          <CompanyPeriodPicker companies={companies} company={company} onCompanyChange={setCompany} period={period} onPeriodChange={setPeriod} periods={PERIODS} />
        </div>
        <div className="sheet-body">
          <p style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)', marginTop: 0 }}>{t('params.costs.revenue.note')}</p>
          {invoiceQuery.isLoading ? (
            <p>{t('common.loading')}</p>
          ) : invoiceQuery.error || !invoice ? (
            <div className="note ko" role="alert">
              <span>{t('common.error')}</span>
              <button type="button" onClick={() => invoiceQuery.refetch()}>
                {t('common.retry')}
              </button>
            </div>
          ) : (
            <BarChart data={invoice.lines.map((l) => ({ label: l.label, value: l.amount }))} />
          )}
        </div>
      </div>

      {gridQuery.data ? (
        <PriceGridEditor grid={gridQuery.data} canEdit={canEditGrid} onSave={(next) => saveGridMutation.mutateAsync(next)} saving={saveGridMutation.isPending} />
      ) : gridQuery.isLoading ? (
        <p>{t('common.loading')}</p>
      ) : (
        <div className="note ko" role="alert">
          <span>{t('common.error')}</span>
          <button type="button" onClick={() => gridQuery.refetch()}>
            {t('common.retry')}
          </button>
        </div>
      )}
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

function LabeledInput({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)' }}>
      {label}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ padding: '6px 10px', border: '1px solid var(--rule-strong)', borderRadius: 'var(--k-r-s)', font: 'inherit', background: 'var(--paper)', color: 'var(--ink)' }}
      />
    </label>
  );
}
