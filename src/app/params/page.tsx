'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { TruncationNote } from '@/components/ui/TruncationNote';
import { FolioHeader } from '@/components/FolioHeader';
import { PriceGridEditor } from '@/components/metering/PriceGridEditor';
import { Kpi, KpiRow } from '@/components/ui/Kpi';
import { Modal } from '@/components/ui/Modal';
import { Table, Column } from '@/components/ui/Table';
import { Tabs } from '@/components/ui/Tabs';
import { Tag } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { TranslationKey } from '@/i18n/translations';
import { fetchAllPages } from '@/lib/paginate';
import { apiGet, apiPost, apiPut } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { isCompanyRole } from '@/lib/auth/roles';
import { buildRecentPeriods } from '@/lib/period-options';
import { Paginated, PlaceMeteringSummary, PlaceUser, PriceGrid, RolesMatrixResponse } from '@/lib/types';

const PAGE_SIZE = 6; // pagination fixe 6/p — A.5
const PERIODS = buildRecentPeriods(12);

type ParamsTab = 'users' | 'roles' | 'costs';

function statusTone(active: boolean) {
  return active ? ('ok' as const) : ('warn' as const);
}

/** Libellé humain d'un rôle (`ROLES`, back `roles-privileges.ts`) — clé `params.role.<ROLE>` (B.7). Repli sur la clé brute si aucune traduction n'existe (ne jamais fabriquer de libellé). */
function roleLabel(t: (k: TranslationKey) => string, role: string): string {
  const key = `params.role.${role}` as TranslationKey;
  const label = t(key);
  return label === key ? role : label;
}

/** Libellé humain d'un privilège (`PRIVILEGES`, back `roles-privileges.ts`) — clé `params.privilege.<key>` (B.7). Même repli que `roleLabel`. */
function privilegeLabel(t: (k: TranslationKey) => string, priv: string): string {
  const key = `params.privilege.${priv}` as TranslationKey;
  const label = t(key);
  return label === key ? priv : label;
}

/** "Mois AAAA" localisé à partir d'une période `AAAA-MM` (dashboard coûts, écran 14) — `timeZone: 'UTC'` pour éviter tout écart SSR/client. */
function periodLabel(period: string, locale: string): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, (m || 1) - 1, 1));
  return d.toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Montant DA — même formateur que `/metering` (écran 10), dupliqué ici par cohérence avec le reste de l'app (pas de util partagé pour ça, voir HANDOFF.md). */
function formatDzd(amount: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'DZD', maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount.toLocaleString()} DA`;
  }
}

/** Barre horizontale non colorée (pas de seuil bon/mauvais, contrairement à `ScoreBar`) — "Poids revenu" du dashboard coûts place entière, sizée directement par `revenueSharePct` (0-100). */
function RevenueShareBar({ pct }: { pct: number }) {
  return (
    <div className="score-bar-track" style={{ minWidth: 100 }}>
      <div className="score-bar-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: 'var(--k-pri-2)' }} />
    </div>
  );
}

export default function ParamsPage() {
  const { t } = useI18n();
  const { me, isLoading, hasPrivilege } = useAuth();
  const [tab, setTab] = useState<ParamsTab>('users');

  // SEC-38 : décision prise sur l'identité réelle (`GET /me`), jamais avant
  // qu'elle soit connue ; le backend refuse de toute façon (403) chaque
  // appel /admin/* sans le privilège.
  if (isLoading && !me) {
    return (
      <>
        <FolioHeader badge="Admin · §5.1" title={t('params.title')} subtitle={t('params.subtitle')} />
        <p>{t('common.loading')}</p>
      </>
    );
  }

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
  const { me } = useAuth();
  // SEC-38 : un rôle compagnie ne peut proposer que SA compagnie.
  const lockedCompany = isCompanyRole(me?.role) ? me?.company ?? '' : undefined;
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

  // KPIs (4 tuiles, capture de référence) : pas d'agrégat dédié côté API —
  // un second appel pleine page sert uniquement au décompte actif/suspendu,
  // jamais affiché tel quel comme liste (même idiome que `casesAllQuery` de
  // `/fraude`, B.11 : la liste affichée reste la page courante, paginée serveur).
  const usersAllQuery = useQuery({
    queryKey: ['admin', 'users', 'all'],
    // SEC-13 : pages successives de 100 (plafond `FETCH_ALL_MAX_ITEMS`).
    queryFn: () => fetchAllPages<PlaceUser>('/admin/users'),
  });

  const matrixQuery = useQuery({
    queryKey: ['admin', 'roles', 'matrix'],
    queryFn: () => apiGet<RolesMatrixResponse>('/admin/roles/matrix'),
  });

  const kpis = useMemo(() => {
    const allUsers = usersAllQuery.data?.items ?? [];
    return {
      total: usersAllQuery.data?.total ?? usersQuery.data?.total ?? 0,
      active: allUsers.filter((u) => u.active).length,
      suspended: allUsers.filter((u) => !u.active).length,
      roles: matrixQuery.data?.roles.length ?? 0,
    };
  }, [usersAllQuery.data, usersQuery.data, matrixQuery.data]);

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

  // Bascule actif/suspendu directement depuis la ligne (capture de
  // référence : bouton "Suspendre"/"Activer" dans le tableau, pas besoin
  // d'ouvrir la modale) — même mutation PUT que la fiche détail, mais
  // déclenchée avec l'utilisateur de la ligne plutôt que `selected`.
  const toggleActiveMutation = useMutation({
    mutationFn: (user: PlaceUser) => apiPut<PlaceUser>(`/admin/users/${user.id}`, { active: !user.active, grant: user.grant, revoke: user.revoke }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      toast(t('params.users.toast.toggled'), 'ok');
    },
    onError: () => toast(t('params.users.toast.error'), 'ko'),
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
    { key: 'role', header: t('params.users.col.role'), render: (r) => <Tag tone="a">{roleLabel(t, r.role)}</Tag> },
    { key: 'company', header: t('params.users.col.company'), render: (r) => r.companyId ?? '—' },
    {
      key: 'status',
      header: t('params.users.col.status'),
      render: (r) => <Tag tone={statusTone(r.active)}>{r.active ? t('params.users.status.active') : t('params.users.status.suspended')}</Tag>,
    },
    {
      key: 'actions',
      header: t('params.users.col.actions'),
      render: (r) => (
        <button
          type="button"
          disabled={toggleActiveMutation.isPending}
          onClick={(e) => {
            e.stopPropagation();
            toggleActiveMutation.mutate(r);
          }}
          style={{
            padding: '4px 10px',
            borderRadius: 'var(--k-r-s)',
            border: `1px solid ${r.active ? 'var(--ko)' : 'var(--ok)'}`,
            background: 'var(--paper)',
            color: r.active ? 'var(--ko)' : 'var(--ok)',
            font: 'inherit',
            fontSize: 'var(--k-fs-xs)',
            cursor: 'pointer',
          }}
        >
          {r.active ? t('params.users.action.suspend') : t('params.users.action.activate')}
        </button>
      ),
    },
  ];

  return (
    <div>
      <KpiRow>
        <Kpi value={kpis.total} label={t('params.users.kpi.total')} />
        <Kpi value={kpis.active} label={t('params.users.kpi.active')} />
        <Kpi value={kpis.suspended} label={t('params.users.kpi.suspended')} />
        <Kpi value={kpis.roles} label={t('params.users.kpi.roles')} />
      </KpiRow>
      <TruncationNote truncated={usersAllQuery.data?.truncated} shown={usersAllQuery.data?.items.length ?? 0} total={usersAllQuery.data?.total ?? 0} />

      <div className="sheet" style={{ marginTop: 'var(--s-5)' }}>
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
              onClick={() => createMutation.mutate({ name: form.name, email: form.email, role: form.role, companyId: (lockedCompany ?? form.companyId) || undefined })}
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
                    {roleLabel(t, r)}
                  </option>
                ))}
              </select>
            </label>
            <LabeledInput
              label={t('params.users.field.company')}
              value={lockedCompany ?? form.companyId}
              disabled={lockedCompany !== undefined}
              onChange={(v) => setForm((f) => ({ ...f, companyId: v }))}
            />
          </div>
        </Modal>
      </div>
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
                <th>{t('params.roles.col.privilege')}</th>
                {roles.map((role) => (
                  <th key={role} style={{ textAlign: 'center' }}>
                    {roleLabel(t, role)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {privileges.map((p) => (
                <tr key={p}>
                  <td>
                    <strong style={{ display: 'block' }}>{privilegeLabel(t, p)}</strong>
                    <span className="mono" style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)' }}>
                      {p}
                    </span>
                  </td>
                  {roles.map((role) => (
                    <td key={role} style={{ textAlign: 'center' }}>
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
  const { t, locale } = useI18n();
  const { hasPrivilege } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState(PERIODS[0]);
  const canEditGrid = hasPrivilege('grid');

  // Dashboard place entière (pas de sélecteur compagnie, écran 14,
  // sous-onglet Coûts & tarification) — `GET /metering/place-summary/
  // {period}`, additif, somme de la facture mock de chaque adhérent RÉEL
  // (voir `metering.service.ts` back, `placeSummary`). Remplace l'ancienne
  // vue "revenu par inducteur (compagnie sélectionnée)" + `CompanyPeriodPicker`
  // (toujours utilisé par `/metering`, pas retiré du composant partagé).
  const summaryQuery = useQuery({
    queryKey: ['metering', 'place-summary', period],
    queryFn: () => apiGet<PlaceMeteringSummary>(`/metering/place-summary/${period}`),
    enabled: !!period,
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

  const summary = summaryQuery.data;

  return (
    <>
      <div className="sheet" style={{ marginBottom: 'var(--s-5)' }}>
        <div className="sheet-head">
          <span>
            {t('params.costs.dashboard.title')}
            {summary ? ` (${periodLabel(summary.period, locale)})` : null}
          </span>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)' }}>
            {t('metering.selector.period')}
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              style={{ font: 'inherit', border: '1px solid var(--rule-strong)', borderRadius: 'var(--k-r-s)', padding: '6px 10px', background: 'var(--paper)', color: 'var(--ink)' }}
            >
              {PERIODS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="sheet-body">
          {summaryQuery.isLoading ? (
            <p>{t('common.loading')}</p>
          ) : summaryQuery.error || !summary ? (
            <div className="note ko" role="alert">
              <span>{t('common.error')}</span>
              <button type="button" onClick={() => summaryQuery.refetch()}>
                {t('common.retry')}
              </button>
            </div>
          ) : (
            <>
              <KpiRow>
                <Kpi value={formatDzd(summary.revenueTotal, locale)} label={t('params.costs.kpi.revenue')} />
                <Kpi value={formatDzd(summary.subscriptionTotal, locale)} label={t('params.costs.kpi.subscription')} extra={`${summary.adherentCount} ${t('params.costs.kpi.adherents')}`} />
                <Kpi value={formatDzd(summary.consumptionTotal, locale)} label={t('params.costs.kpi.consumption')} />
                <Kpi value={summary.inducerCount} label={t('params.costs.kpi.inducers')} />
              </KpiRow>

              <div className="t-wrap" style={{ marginTop: 'var(--s-4)' }}>
                <table className="t">
                  <thead>
                    <tr>
                      <th>{t('params.costs.col.inducer')}</th>
                      <th>{t('params.costs.col.measured')}</th>
                      <th>{t('params.costs.col.billable')}</th>
                      <th>{t('params.costs.col.weight')}</th>
                      <th>{t('params.costs.col.revenue')}</th>
                      <th>{t('params.costs.col.share')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.lines.map((l) => (
                      <tr key={l.metric}>
                        <td>
                          <strong style={{ display: 'block' }}>{l.label}</strong>
                          <span className="mono" style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)' }}>
                            {l.unit}
                          </span>
                        </td>
                        <td className="mono">{l.measured.toLocaleString(locale)}</td>
                        <td className="mono">{l.facturable.toLocaleString(locale)}</td>
                        <td>
                          <RevenueShareBar pct={l.revenueSharePct} />
                        </td>
                        <td className="mono">{formatDzd(l.amountHT, locale)}</td>
                        <td className="mono">{l.revenueSharePct} %</td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={4} style={{ fontWeight: 600 }}>
                        {t('params.costs.totalRow')}
                      </td>
                      <td className="mono" style={{ fontWeight: 600 }}>
                        {formatDzd(summary.consumptionTotal, locale)}
                      </td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
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

function LabeledInput({ label, value, onChange, type = 'text', disabled = false }: { label: string; value: string; onChange: (v: string) => void; type?: string; disabled?: boolean }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)' }}>
      {label}
      <input
        type={type}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={{ padding: '6px 10px', border: '1px solid var(--rule-strong)', borderRadius: 'var(--k-r-s)', font: 'inherit', background: 'var(--paper)', color: 'var(--ink)' }}
      />
    </label>
  );
}
