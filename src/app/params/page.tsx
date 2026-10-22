'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Info, Lock, LockOpen, Plus, RefreshCw, Save, Settings, Table2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { TruncationNote } from '@/components/ui/TruncationNote';
import { FolioHeader } from '@/components/FolioHeader';
import { CoChip } from '@/components/ui/CoChip';
import { Kpi, KpiRow } from '@/components/ui/Kpi';
import { LabeledSelect } from '@/components/referential/fields';
import { Modal } from '@/components/ui/Modal';
import { Table, Column } from '@/components/ui/Table';
import { Tabs } from '@/components/ui/Tabs';
import { Tag } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { TranslationKey } from '@/i18n/translations';
import { fetchAllPages } from '@/lib/paginate';
import { apiGet, apiPath, apiPost, apiPut } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { isCompanyRole } from '@/lib/auth/roles';
import { useCompanyEntry } from '@/lib/company-directory';
import { buildCsv, downloadCsv } from '@/lib/csv';
import { describeApiError } from '@/lib/error-message';
import { buildRecentPeriods } from '@/lib/period-options';
import { CompanyListItem, Paginated, PlaceMeteringSummary, PlaceUser, PriceGrid, RolesMatrixResponse } from '@/lib/types';
import { ParamsPriceGrid } from './ParamsPriceGrid';

/** SEC-44 : `companyId` d'un utilisateur est un CODE compagnie (même espace que `Claim.company`), pas un identifiant. */
const USER_COMPANY_CODE = /^[A-Z0-9][A-Z0-9_-]{1,15}$/;

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

/** Espace fine insécable (séparateur de milliers `fr`) : quasi invisible en Urbanist — remplacée par une espace insécable ordinaire, comme la maquette (« 1 017 250 DA »). */
const NARROW_NBSP = new RegExp(String.fromCharCode(0x202f), 'g');
const NBSP = String.fromCharCode(0xa0);

/** Entier localisé (séparateur de milliers), sans décimales. */
function formatInt(amount: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(amount).replace(NARROW_NBSP, NBSP);
  } catch {
    return amount.toLocaleString();
  }
}

/** Montant « 1 017 250 DA » (maquette : unité DA, comme les autres écrans). */
function formatDa(amount: number, locale: string): string {
  return `${formatInt(amount, locale)} DA`;
}

/**
 * Barre « Poids revenu » (maquette) : longueur relative au plus gros
 * inducteur du mois (la ligne la plus lourde remplit la piste), la part
 * réelle `revenueSharePct` restant affichée dans la colonne « % conso. ».
 */
function RevenueShareBar({ pct, max }: { pct: number; max: number }) {
  const width = max > 0 ? Math.max(0, Math.min(100, (pct / max) * 100)) : 0;
  return (
    <div className="pa-bar" aria-hidden="true">
      <div className="pa-bar-fill" style={{ width: `${width}%` }} />
    </div>
  );
}

/** Organisation de rattachement : la compagnie (nom du référentiel) pour un rôle compagnie, l'institution du rôle pour un rôle de place — même règle que le pied de la barre latérale (`shell.org.<ROLE>`). */
function OrgCell({ user }: { user: PlaceUser }) {
  const { t } = useI18n();
  const entry = useCompanyEntry(user.companyId ?? undefined);
  if (user.companyId) return <>{entry?.name ?? user.companyId}</>;
  const key = `shell.org.${user.role}` as TranslationKey;
  const label = t(key);
  return label === key ? <span className="pa-dash">—</span> : <>{label}</>;
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
        <FolioHeader badge="Module H · §5.1" title={t('params.title')} subtitle={t('params.subtitle')} />
        <p>{t('common.loading')}</p>
      </>
    );
  }

  if (!hasPrivilege('admin')) {
    return (
      <>
        <FolioHeader badge="Module H · §5.1" title={t('params.title')} subtitle={t('params.subtitle')} />
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
    <div className="pa">
      <FolioHeader badge="Module H · §5.1" title={t('params.title')} subtitle={t('params.subtitle')} />

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
    </div>
  );
}

/* ===================== Utilisateurs & accès ===================== */

type UserScope = 'TOUS' | 'PLACE' | 'COMPAGNIE';

function UsersTab() {
  const { t } = useI18n();
  const { me } = useAuth();
  // SEC-38 : un rôle compagnie ne peut proposer que SA compagnie.
  const lockedCompany = isCompanyRole(me?.role) ? me?.company ?? '' : undefined;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  // Séparation des comptes : la place (opérateur, Admin FinLab/UAR, commission, audit) / les assurances (correspondants, trésoriers).
  const [scope, setScope] = useState<UserScope>('TOUS');
  const [selected, setSelected] = useState<PlaceUser | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', role: '', companyId: '' });

  // Rôle compagnie : code compagnie obligatoire (400 sinon) ; rôle place : aucune compagnie rattachée.
  const formCompanyRole = isCompanyRole(form.role);
  const formCompany = lockedCompany ?? form.companyId;
  const createValid =
    !!form.name.trim() && !!form.email.trim() && !!form.role && (formCompanyRole ? USER_COMPANY_CODE.test(formCompany) : true);

  const companiesQuery = useQuery({
    queryKey: ['referential', 'companies', 'user-picker'],
    queryFn: () => apiGet<Paginated<CompanyListItem>>('/referential/companies', { page: 1, pageSize: 100 }),
    enabled: createOpen && formCompanyRole && lockedCompany === undefined,
  });

  const usersQuery = useQuery({
    queryKey: ['admin', 'users', scope, page],
    queryFn: () => apiGet<Paginated<PlaceUser>>('/admin/users', { page, pageSize: PAGE_SIZE, ...(scope === 'TOUS' ? {} : { scope }) }),
  });

  // KPIs (4 tuiles, capture de référence) : pas d'agrégat dédié côté API —
  // un second appel pleine page sert uniquement au décompte actif/suspendu
  // (et à l'export CSV), jamais affiché tel quel comme liste (même idiome que
  // `casesAllQuery` de `/fraude`, B.11 : la liste affichée reste la page
  // courante, paginée serveur).
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
      place: allUsers.filter((u) => !isCompanyRole(u.role)).length,
      companies: allUsers.filter((u) => isCompanyRole(u.role)).length,
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
    // 403 PRIVILEGE_RESERVE_PLACE, 400 (compagnie manquante ou invalide) : message traduit / du backend.
    onError: (err: unknown) => toast(describeApiError(err, t, t('params.users.toast.error')), 'ko'),
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
    mutationFn: (body: { active: boolean; grant: string[]; revoke: string[] }) => apiPut<PlaceUser>(apiPath`/admin/users/${selected!.id}`, body),
    onSuccess: (updated) => {
      setSelected(updated);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      toast(t('params.users.detail.saved'), 'ok');
    },
    onError: (err: unknown) => toast(describeApiError(err, t, t('params.users.detail.saveError')), 'ko'),
  });

  // Bascule actif/suspendu directement depuis la ligne (capture de
  // référence : bouton "Suspendre"/"Activer" dans le tableau, pas besoin
  // d'ouvrir la modale) — même mutation PUT que la fiche détail, mais
  // déclenchée avec l'utilisateur de la ligne plutôt que `selected`.
  const toggleActiveMutation = useMutation({
    mutationFn: (user: PlaceUser) => apiPut<PlaceUser>(apiPath`/admin/users/${user.id}`, { active: !user.active, grant: user.grant, revoke: user.revoke }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      toast(t('params.users.toast.toggled'), 'ok');
    },
    onError: (err: unknown) => toast(describeApiError(err, t, t('params.users.toast.error')), 'ko'),
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

  // Export CSV (« Export » de la maquette) — généré côté front depuis les
  // utilisateurs RÉELLEMENT chargés (aucun endpoint d'export côté API, même
  // convention que `/monitoring`) ; SEC-39 : échappement + neutralisation
  // des formules dans `buildCsv`.
  function exportUsers() {
    const users = usersAllQuery.data?.items ?? pageRows;
    const header = [t('params.users.col.name'), t('params.users.col.email'), t('params.users.col.role'), t('params.users.col.company'), t('params.users.col.status')];
    const rows = users.map((u) => [u.name, u.email, u.role, u.companyId ?? '', u.active ? t('params.users.status.active') : t('params.users.status.suspended')]);
    downloadCsv(`utilisateurs-${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(header, rows));
  }

  const columns: Column<PlaceUser>[] = [
    { key: 'name', header: t('params.users.col.name'), render: (r) => <span className="pa-strong">{r.name}</span> },
    ...(showEmail ? [{ key: 'email', header: t('params.users.col.email'), render: (r: PlaceUser) => <span className="mono">{r.email}</span> }] : []),
    { key: 'org', header: t('params.users.col.org'), render: (r) => <OrgCell user={r} /> },
    { key: 'role', header: t('params.users.col.role'), render: (r) => <span className="pa-role">{roleLabel(t, r.role)}</span> },
    { key: 'company', header: t('params.users.col.company'), render: (r) => (r.companyId ? <CoChip code={r.companyId} /> : <span className="pa-dash">—</span>) },
    {
      key: 'status',
      header: t('params.users.col.status'),
      render: (r) => <Tag tone={statusTone(r.active)}>{r.active ? t('params.users.status.active') : t('params.users.status.suspended')}</Tag>,
    },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <div className="pa-row-actions">
          <button
            type="button"
            className="pa-act"
            onClick={(e) => {
              e.stopPropagation();
              setSelected(r);
            }}
          >
            <Settings size={14} aria-hidden="true" />
            {t('params.users.action.edit')}
          </button>
          <button
            type="button"
            className={r.active ? 'pa-act ko' : 'pa-act ok'}
            disabled={toggleActiveMutation.isPending}
            onClick={(e) => {
              e.stopPropagation();
              toggleActiveMutation.mutate(r);
            }}
          >
            {r.active ? <Lock size={14} aria-hidden="true" /> : <LockOpen size={14} aria-hidden="true" />}
            {r.active ? t('params.users.action.suspend') : t('params.users.action.activate')}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className={showEmail ? 'pa-users pa-users--email' : 'pa-users'}>
      <KpiRow>
        <Kpi value={kpis.total} label={t('params.users.kpi.total')} />
        <Kpi value={kpis.active} label={t('params.users.kpi.active')} />
        <Kpi value={kpis.suspended} label={t('params.users.kpi.suspended')} />
        <Kpi value={kpis.roles} label={t('params.users.kpi.roles')} />
      </KpiRow>
      <TruncationNote truncated={usersAllQuery.data?.truncated} shown={usersAllQuery.data?.items.length ?? 0} total={usersAllQuery.data?.total ?? 0} />

      <div className="sheet">
        <div className="sheet-head">
          <span>{t('params.users.title')}</span>
          <div className="pa-head-actions">
            <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
              <Plus size={16} aria-hidden="true" />
              {t('params.users.create')}
            </button>
            <button type="button" className="btn-outline" onClick={exportUsers} disabled={usersQuery.isLoading} title={t('common.exportExcel.note')}>
              <Table2 size={16} aria-hidden="true" />
              {t('params.export')}
            </button>
            <button
              type="button"
              className="pa-eye"
              aria-pressed={showEmail}
              aria-label={showEmail ? t('params.users.hideEmail') : t('params.users.showEmail')}
              title={showEmail ? t('params.users.hideEmail') : t('params.users.showEmail')}
              onClick={() => setShowEmail((v) => !v)}
            >
              {showEmail ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
            </button>
          </div>
        </div>
        <div className="pa-scope">
          <Tabs
            items={[
              { key: 'TOUS', label: t('params.users.scope.all'), count: kpis.total },
              { key: 'PLACE', label: t('params.users.scope.place'), count: kpis.place },
              { key: 'COMPAGNIE', label: t('params.users.scope.companies'), count: kpis.companies },
            ]}
            activeKey={scope}
            onChange={(k) => {
              setScope(k as UserScope);
              setPage(1);
            }}
          />
          <p className="pa-scope-note">{t(`params.users.scope.note.${scope}` as TranslationKey)}</p>
        </div>
        <div className="sheet-body flush">
          {usersQuery.isLoading ? (
            <p className="pad">{t('common.loading')}</p>
          ) : usersQuery.error ? (
            <div className="note ko pa-pad-note" role="alert">
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
            <button type="button" className="btn-primary" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate({ active: editActive, grant: editGrant, revoke: editRevoke })}>
              {t('params.users.detail.save')}
            </button>
          }
        >
          {selected ? (
            <>
              <dl className="pa-detail">
                <Field label={t('params.users.col.email')}>
                  <span className="mono">{selected.email}</span>
                </Field>
                <Field label={t('params.users.col.role')}>
                  <span className="mono">{selected.role}</span>
                </Field>
                <Field label={t('params.users.col.company')}>{selected.companyId ?? '—'}</Field>
                <Field label={t('params.users.col.status')}>
                  <label className="pa-inline-check">
                    <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} />
                    <Tag tone={statusTone(editActive)}>{editActive ? t('params.users.status.active') : t('params.users.status.suspended')}</Tag>
                  </label>
                </Field>
              </dl>

              <strong className="pa-detail-h">{t('params.users.detail.grant')}</strong>
              <div className="pa-priv-list">
                {privileges.map((p) => (
                  <label key={p} className="mono">
                    <input type="checkbox" checked={editGrant.includes(p)} onChange={() => toggleIn(editGrant, setEditGrant, p)} />
                    {p}
                  </label>
                ))}
              </div>

              <strong className="pa-detail-h">{t('params.users.detail.revoke')}</strong>
              <div className="pa-priv-list">
                {privileges.map((p) => (
                  <label key={p} className="mono">
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
              className="btn-primary"
              disabled={createMutation.isPending || !createValid}
              onClick={() =>
                createMutation.mutate({ name: form.name.trim(), email: form.email.trim(), role: form.role, companyId: lockedCompany ?? (formCompanyRole ? form.companyId : undefined) })
              }
            >
              {t('params.users.field.submit')}
            </button>
          }
        >
          <div className="pa-form">
            <LabeledInput label={t('params.users.field.name')} value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
            <LabeledInput label={t('params.users.field.email')} value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} type="email" />
            <label className="pa-field">
              {t('params.users.field.role')}
              <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
                <option value="">—</option>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(t, r)}
                  </option>
                ))}
              </select>
            </label>
            {lockedCompany !== undefined ? (
              <LabeledInput label={t('params.users.field.companyRequired')} value={lockedCompany} disabled onChange={() => undefined} />
            ) : formCompanyRole ? (
              <LabeledSelect
                label={t('params.users.field.companyRequired')}
                value={form.companyId}
                required
                disabled={companiesQuery.isLoading}
                onChange={(v) => setForm((f) => ({ ...f, companyId: v }))}
                options={[{ value: '', label: '—' }, ...(companiesQuery.data?.items ?? []).map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }))]}
              />
            ) : form.role ? (
              <p className="pa-hint">{t('params.users.field.placeNoCompany')}</p>
            ) : null}
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
    onError: (err: unknown) => toast(describeApiError(err, t, t('params.roles.toast.error')), 'ko'),
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
    <div className="sheet pa-roles">
      <div className="sheet-head">
        <span>{t('params.roles.title')}</span>
        <div className="pa-head-actions">
          {/* Enregistrement explicite de la matrice (PUT /admin/roles/matrix) : n'apparaît qu'en présence de modifications. */}
          {dirty ? (
            <button type="button" className="btn-primary" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate(draft)}>
              <Save size={16} aria-hidden="true" />
              {t('params.roles.save')}
            </button>
          ) : null}
          {/* La liste des rôles est figée côté API (aucun endpoint de création) : le bouton de la maquette l'explique au lieu d'agir. */}
          <button type="button" className="btn-primary" aria-disabled="true" title={t('params.roles.custom.note')} onClick={() => toast(t('params.roles.custom.note'), 'warn')}>
            <Plus size={16} aria-hidden="true" />
            {t('params.roles.custom')}
          </button>
          <button type="button" className="btn-soft" disabled={saveMutation.isPending} onClick={() => setDraft(structuredClone(matrixQuery.data!.matrix))}>
            <RefreshCw size={14} aria-hidden="true" />
            {t('params.roles.reset')}
          </button>
        </div>
      </div>
      <div className="sheet-body flush">
        <div className="pa-info">
          <Info size={14} aria-hidden="true" />
          <span>{t('params.roles.auditorNote')}</span>
        </div>
        <div className="t-wrap">
          <table className="t pa-matrix">
            <thead>
              <tr>
                <th className="pa-matrix-priv">{t('params.roles.col.privilege')}</th>
                {roles.map((role) => (
                  <th key={role} className="pa-matrix-role">
                    <span className="pa-vert">{roleLabel(t, role)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {privileges.map((p) => (
                <tr key={p}>
                  <td>
                    <span className="pa-strong pa-block">{privilegeLabel(t, p)}</span>
                    <span className="pa-code">{p}</span>
                  </td>
                  {roles.map((role) => (
                    <td key={role} className="pa-center">
                      <input
                        type="checkbox"
                        className="pa-check"
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
      </div>
    </div>
  );
}

/* ===================== Coûts & tarification ===================== */

/** `simulated` est renvoyé par `GET /metering/place-summary/:period` (consommation simulée côté back) sans figurer dans le type partagé. */
type PlaceSummaryWithSource = PlaceMeteringSummary & { simulated?: boolean };

function CostsTab() {
  const { t, locale } = useI18n();
  const { hasPrivilege } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState(PERIODS[0]);
  const [showSource, setShowSource] = useState(false);
  const canEditGrid = hasPrivilege('grid');

  // Dashboard place entière (pas de sélecteur compagnie, écran 14,
  // sous-onglet Coûts & tarification) — `GET /metering/place-summary/
  // {period}`, additif, somme de la facture mock de chaque adhérent RÉEL
  // (voir `metering.service.ts` back, `placeSummary`). Remplace l'ancienne
  // vue "revenu par inducteur (compagnie sélectionnée)" + `CompanyPeriodPicker`
  // (toujours utilisé par `/metering`, pas retiré du composant partagé).
  const summaryQuery = useQuery({
    queryKey: ['metering', 'place-summary', period],
    queryFn: () => apiGet<PlaceSummaryWithSource>(apiPath`/metering/place-summary/${period}`),
    enabled: !!period,
  });

  const gridQuery = useQuery({
    queryKey: ['pricing', 'grid'],
    queryFn: () => apiGet<PriceGrid>('/pricing/grid'),
  });

  const saveGridMutation = useMutation({
    mutationFn: (next: PriceGrid) => apiPut<PriceGrid>('/pricing/grid', next),
    onSuccess: (next) => {
      // SEC-37 : nouvelle version à date d'effet — relue plutôt que substituée à la grille en vigueur.
      void queryClient.invalidateQueries({ queryKey: ['pricing', 'grid'] });
      toast(`${t('metering.toast.gridSaved')} ${next.version} — ${t('metering.grid.effectiveFrom')} ${next.effectiveFrom}`, 'ok');
    },
    onError: (err: unknown) => toast(describeApiError(err, t, t('metering.toast.gridError')), 'ko'),
  });

  const summary = summaryQuery.data;
  // Maquette : inducteurs classés par revenu décroissant (simple tri d'affichage).
  const lines = useMemo(() => [...(summary?.lines ?? [])].sort((a, b) => b.amountHT - a.amountHT), [summary]);
  const maxShare = lines.reduce((m, l) => Math.max(m, l.revenueSharePct), 0);

  // Export CSV des lignes réellement affichées (même convention que l'onglet Utilisateurs).
  function exportSummary() {
    if (!summary) return;
    const header = [t('params.costs.col.inducer'), t('metering.grid.col.unit'), t('params.costs.col.measured'), t('params.costs.col.billable'), t('params.costs.col.revenue'), t('params.costs.col.share')];
    const rows = lines.map((l) => [l.label, l.unit, l.measured, l.facturable, l.amountHT, l.revenueSharePct]);
    downloadCsv(`couts-utilisation-${summary.period}.csv`, buildCsv(header, rows));
  }

  return (
    <div className="pa-costs">
      <div className="sheet">
        <div className="sheet-head">
          <span className="pa-dash-title">
            {t('params.costs.dashboard.title')}{' '}
            <span className="pa-period-wrap">
              (
              <select className="pa-period" aria-label={t('metering.selector.period')} title={t('metering.selector.period')} value={period} onChange={(e) => setPeriod(e.target.value)}>
                {PERIODS.map((p) => (
                  <option key={p} value={p}>
                    {periodLabel(p, locale)}
                  </option>
                ))}
              </select>
              )
            </span>
          </span>
          <div className="pa-head-actions">
            <button type="button" className="btn-outline" onClick={exportSummary} disabled={!summary} title={t('common.exportExcel.note')}>
              <Table2 size={16} aria-hidden="true" />
              {t('params.export')}
            </button>
            <button
              type="button"
              className="pa-eye"
              aria-pressed={showSource}
              aria-label={showSource ? t('params.costs.hideSource') : t('params.costs.showSource')}
              title={showSource ? t('params.costs.hideSource') : t('params.costs.showSource')}
              onClick={() => setShowSource((v) => !v)}
            >
              {showSource ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
            </button>
          </div>
        </div>
        <div className="sheet-body flush">
          {summaryQuery.isLoading ? (
            <p className="pad">{t('common.loading')}</p>
          ) : summaryQuery.error || !summary ? (
            <div className="note ko pa-pad-note" role="alert">
              <span>{t('common.error')}</span>
              <button type="button" onClick={() => summaryQuery.refetch()}>
                {t('common.retry')}
              </button>
            </div>
          ) : (
            <>
              {/* Consommation simulée : toujours signalée (même règle que la facture SIMULÉE de /metering). */}
              {showSource || summary.simulated ? (
                <div className="pa-info">
                  <Info size={14} aria-hidden="true" />
                  <span>
                    {t('params.costs.source')} <span className="mono">{summary.gridVersion}</span>
                    {summary.simulated ? ` · ${t('params.costs.simulated')}` : null}
                  </span>
                </div>
              ) : null}
              <KpiRow>
                <Kpi
                  value={<>{formatDa(summary.revenueTotal, locale)}</>}
                  label={t('params.costs.kpi.revenue')}
                  title={summary.simulated ? t('params.costs.simulated') : undefined}
                  extra={<span className="pa-kchip">{periodLabel(summary.period, locale)}</span>}
                />
                <Kpi
                  value={<>{formatDa(summary.subscriptionTotal, locale)}</>}
                  label={t('params.costs.kpi.subscription')}
                  extra={<span className="pa-kchip">{`${summary.adherentCount} ${t('params.costs.kpi.adherents')}`}</span>}
                />
                <Kpi value={<>{formatDa(summary.consumptionTotal, locale)}</>} label={t('params.costs.kpi.consumption')} />
                <Kpi
                  value={summary.inducerCount}
                  label={t('params.costs.kpi.inducers')}
                  extra={<span className="pa-kchip">{summary.lines.map((l) => l.label).join(' · ')}</span>}
                />
              </KpiRow>

              <div className="t-wrap">
                <table className="t pa-cost-t">
                  <thead>
                    <tr>
                      <th>{t('params.costs.col.inducer')}</th>
                      <th className="pa-end">{t('params.costs.col.measured')}</th>
                      <th className="pa-end">{t('params.costs.col.billable')}</th>
                      <th>{t('params.costs.col.weight')}</th>
                      <th className="pa-end">{t('params.costs.col.revenue')}</th>
                      <th className="pa-end">{t('params.costs.col.share')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.metric}>
                        <td>
                          <span className="pa-strong pa-block">{l.label}</span>
                          <span className="pa-unit">{l.unit}</span>
                        </td>
                        <td className="mono pa-end">{l.measured.toLocaleString(locale)}</td>
                        <td className="mono pa-end">{l.facturable.toLocaleString(locale)}</td>
                        <td className="pa-bar-cell">
                          <RevenueShareBar pct={l.revenueSharePct} max={maxShare} />
                        </td>
                        <td className="mono pa-end">{formatDa(l.amountHT, locale)}</td>
                        <td className="mono pa-end pa-share">{l.revenueSharePct.toLocaleString(locale, { maximumFractionDigits: 1 })} %</td>
                      </tr>
                    ))}
                    <tr className="pa-total">
                      <td colSpan={4}>{t('params.costs.totalRow')}</td>
                      <td className="mono pa-end">{formatDa(summary.consumptionTotal, locale)}</td>
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
        <ParamsPriceGrid grid={gridQuery.data} canEdit={canEditGrid} onSave={(next) => saveGridMutation.mutateAsync(next)} saving={saveGridMutation.isPending} />
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
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="pa-dt">{label}</dt>
      <dd className="pa-dd">{children}</dd>
    </div>
  );
}

function LabeledInput({ label, value, onChange, type = 'text', disabled = false }: { label: string; value: string; onChange: (v: string) => void; type?: string; disabled?: boolean }) {
  return (
    <label className="pa-field">
      {label}
      <input type={type} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
