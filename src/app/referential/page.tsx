'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Building2,
  CalendarDays,
  Car,
  ChevronLeft,
  ChevronRight,
  Download,
  FileCheck2,
  Gauge,
  List,
  MapPin,
  Network,
  Plus,
  Scale,
  Settings,
  ShieldCheck,
  UserSearch,
  UsersRound,
  X,
} from 'lucide-react';
import { FolioHeader } from '@/components/FolioHeader';
import { AgencyDialog, AgencyDialogTarget } from '@/components/referential/AgencyDialog';
import { AgencyOrgChart, OrgAddRequest } from '@/components/referential/AgencyOrgChart';
import { BaremeSection } from '@/components/referential/BaremeSection';
import { CalendarSection } from '@/components/referential/CalendarSection';
import { ExpertDialog, ExpertDialogTarget, useExpertStatusMutation } from '@/components/referential/ExpertDialog';
import { apiErrorMessage, LabeledInput, LabeledSelect, RowAction, RowActions } from '@/components/referential/fields';
import { GovernancePanel } from '@/components/referential/GovernancePanel';
import { IrsamSection } from '@/components/referential/IrsamSection';
import { MotifsSection } from '@/components/referential/MotifsSection';
import { PopulationSection } from '@/components/referential/PopulationSection';
import { CoChip } from '@/components/ui/CoChip';
import { Modal } from '@/components/ui/Modal';
import { Table, Column } from '@/components/ui/Table';
import { Tag, TagTone } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { TranslationKey } from '@/i18n/translations';
import { apiGet, apiPath, apiPost, apiPut } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { buildCsv, downloadCsv } from '@/lib/csv';
import { isCompanyActor } from '@/lib/recours-actions';
import { AgencyView, CompanyKind, CompanyListItem, CompanyStatus, CompanyView, ConventionParams, EligibilityMotif, ExpertView, FeedMode, Paginated } from '@/lib/types';

const PAGE_SIZE = 6; // pagination fixe 6/p — A.5

type SectionKey = 'companies' | 'agencies' | 'experts' | 'convention' | 'calendar' | 'motifs' | 'bareme' | 'population' | 'irsam';

function statusTone(status: string): TagTone {
  if (status === 'ACTIF') return 'ok';
  if (status === 'SUSPENDU' || status === 'EN_RETRAIT') return 'warn';
  return 'ko';
}

function statusLabel(status: string, t: (k: TranslationKey) => string): string {
  const key = `referential.status.${status}` as TranslationKey;
  const label = t(key);
  return label === key ? status : label; // repli : statut non couvert par le dictionnaire (ne devrait pas arriver, les 5 valeurs réelles sont toutes mappées).
}

interface CompanyForm {
  code: string;
  name: string;
  nameAr: string;
  color: string;
  kind: CompanyKind;
  feedMode: FeedMode;
  status: CompanyStatus;
  correspondentName: string;
  correspondentPhone: string;
  correspondentEmail: string;
}

const EMPTY_FORM: CompanyForm = {
  code: '',
  name: '',
  nameAr: '',
  color: '#1F4FA3',
  kind: 'INSURER',
  feedMode: 'IMPORT',
  status: 'ACTIF',
  correspondentName: '',
  correspondentPhone: '',
  correspondentEmail: '',
};

/** Création (`POST /referential/companies`, privilège `onboardCompany`) : la gouvernance initiale fait partie de la fiche. */
function toFormBody(f: CompanyForm) {
  return {
    code: f.code,
    name: f.name,
    nameAr: f.nameAr || undefined,
    color: f.color,
    kind: f.kind,
    feedMode: f.feedMode,
    status: f.status,
    correspondentName: f.correspondentName || undefined,
    correspondentPhone: f.correspondentPhone || undefined,
    correspondentEmail: f.correspondentEmail || undefined,
  };
}

/**
 * Mise à jour du PROFIL (`PUT /referential/companies/:id`) — SEC-04 : jamais
 * `status`, `delayOverrides`, `kind` ni `feedMode` (403 GOUVERNANCE_RESERVEE),
 * qui passent par une demande de changement de gouvernance (quatre yeux).
 */
function toProfileBody(f: CompanyForm) {
  return {
    name: f.name,
    nameAr: f.nameAr || undefined,
    color: f.color,
    correspondentName: f.correspondentName || undefined,
    correspondentPhone: f.correspondentPhone || undefined,
    correspondentEmail: f.correspondentEmail || undefined,
  };
}

/**
 * Écran de référence RÉEL — Module X "Référentiel de place" (écran 12).
 * Layout maître-détail (nav de 6 sections à gauche, contenu à droite),
 * reconstruit sur la capture de référence du guide illustré. Branché sur
 * l'API réelle du back-end (`GET /referential/companies|agencies|experts|
 * convention|calendar|motifs`) via TanStack Query — voir HANDOFF.md pour
 * les écarts assumés avec la capture ("performance" des experts).
 *
 * Décisions PO §1 à §5 (2026-10-18) : « Barème & motifs » en trois blocs,
 * fériés mobiles dans « Calendrier ouvré », sections « Barème Art. 14 »,
 * « Populations de référence » et « Référence IRSAM ». Saisie : privilège
 * `params` ; validation UAR : `validateRef` (le backend renvoie 409
 * « quatre yeux »).
 */
export default function ReferentialPage() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const { me, hasPrivilege } = useAuth();
  const queryClient = useQueryClient();

  const [section, setSection] = useState<SectionKey>('companies');
  const [companiesPage, setCompaniesPage] = useState(1);
  const [agenciesPage, setAgenciesPage] = useState(1);
  const [expertsPage, setExpertsPage] = useState(1);
  /** Action « Agences » d'une compagnie : section Agences filtrée sur cette compagnie (`?companyId=`, filtre réel de l'API). */
  const [agencyCompany, setAgencyCompany] = useState<CompanyListItem | null>(null);

  const [editCompany, setEditCompany] = useState<CompanyListItem | null>(null);
  const [governanceCompany, setGovernanceCompany] = useState<CompanyListItem | null>(null);
  const [editForm, setEditForm] = useState<CompanyForm>(EMPTY_FORM);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CompanyForm>(EMPTY_FORM);
  const [agencyTarget, setAgencyTarget] = useState<AgencyDialogTarget | null>(null);
  /** Compagnie de l'organigramme d'où part un ajout (rôle place) — pré-sélectionnée dans le formulaire. */
  const [agencyDialogCompanyId, setAgencyDialogCompanyId] = useState<string | undefined>(undefined);
  const [expertTarget, setExpertTarget] = useState<ExpertDialogTarget | null>(null);

  const companiesQuery = useQuery({
    queryKey: ['referential', 'companies', companiesPage],
    // SEC-26 : un rôle compagnie reçoit ses concurrentes en projection publique (identité et statut seulement).
    queryFn: () => apiGet<Paginated<CompanyListItem>>('/referential/companies', { page: companiesPage, pageSize: PAGE_SIZE }),
  });

  // Carte id→compagnie complète (toutes pages confondues) — sert au rattachement compagnie↔agence sur la section Agences (l'API /referential/agencies ne renvoie que `companyId`).
  const companiesMapQuery = useQuery({
    queryKey: ['referential', 'companies', 'all'],
    queryFn: () => apiGet<Paginated<CompanyListItem>>('/referential/companies', { page: 1, pageSize: 100 }),
  });

  const agenciesQuery = useQuery({
    queryKey: ['referential', 'agencies', agenciesPage, agencyCompany?.id ?? null],
    queryFn: () => apiGet<Paginated<AgencyView>>('/referential/agencies', { page: agenciesPage, pageSize: PAGE_SIZE, companyId: agencyCompany?.id }),
  });

  // Total non filtré pour le sous-titre de navigation pendant qu'un filtre compagnie est actif.
  const agenciesTotalQuery = useQuery({
    queryKey: ['referential', 'agencies', 'total'],
    queryFn: () => apiGet<Paginated<AgencyView>>('/referential/agencies', { page: 1, pageSize: 1 }),
    enabled: !!agencyCompany,
  });

  const expertsQuery = useQuery({
    queryKey: ['referential', 'experts', expertsPage],
    queryFn: () => apiGet<Paginated<ExpertView>>('/referential/experts', { page: expertsPage, pageSize: PAGE_SIZE }),
  });

  const conventionQuery = useQuery({
    queryKey: ['referential', 'convention'],
    queryFn: () => apiGet<ConventionParams>('/referential/convention'),
  });

  const motifsQuery = useQuery({
    queryKey: ['referential', 'motifs'],
    queryFn: () => apiGet<EligibilityMotif[]>('/referential/motifs'),
  });

  const companyById = useMemo(() => new Map((companiesMapQuery.data?.items ?? []).map((c) => [c.id, c])), [companiesMapQuery.data]);

  const createMutation = useMutation({
    mutationFn: (body: ReturnType<typeof toFormBody>) => apiPost<CompanyView>('/referential/companies', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['referential', 'companies'] });
      toast(t('referential.company.toast.created'), 'ok');
      setCreateOpen(false);
      setCreateForm(EMPTY_FORM);
    },
    onError: (err: unknown) => toast(apiErrorMessage(err, t('referential.company.toast.error'), t), 'ko'),
  });

  const updateMutation = useMutation({
    mutationFn: (body: ReturnType<typeof toProfileBody>) => apiPut<CompanyView>(apiPath`/referential/companies/${editCompany!.id}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['referential', 'companies'] });
      toast(t('referential.company.toast.updated'), 'ok');
      setEditCompany(null);
    },
    onError: (err: unknown) => toast(apiErrorMessage(err, t('referential.company.toast.error'), t), 'ko'),
  });

  useEffect(() => {
    if (!editCompany) return;
    setEditForm({
      code: editCompany.code,
      name: editCompany.name,
      nameAr: editCompany.nameAr ?? '',
      color: editCompany.color,
      kind: editCompany.kind,
      feedMode: editCompany.feedMode ?? 'IMPORT',
      status: editCompany.status,
      correspondentName: editCompany.correspondentName ?? '',
      correspondentPhone: editCompany.correspondentPhone ?? '',
      correspondentEmail: editCompany.correspondentEmail ?? '',
    });
  }, [editCompany]);

  // B.7 : un rôle compagnie ne modifie que le profil de SA compagnie ; création : privilège `onboardCompany`.
  const companyActor = isCompanyActor(me);
  const canEditCompany = (c: CompanyListItem) => hasPrivilege('refedit') && (!companyActor || c.code === me?.company);
  const canCreate = hasPrivilege('onboardCompany') && !companyActor;
  // SEC-04 : la gouvernance (demandes, quatre yeux) est consultable par les rôles place.
  const canSeeGovernance = !!me && !companyActor;
  const canDecideGovernance = canSeeGovernance && hasPrivilege('validateRef');

  // Agences et experts : `@Privileges('refedit')` (POST/PUT). Miroir d'AFFICHAGE de B.7/SEC-14 — un
  // rôle compagnie n'agit que sur SA compagnie ; l'API reste seule juge et ses refus sont affichés.
  const canRefEdit = hasPrivilege('refedit');
  const ownCompany = companyActor ? (companiesMapQuery.data?.items ?? []).find((c) => c.code === me?.company) : undefined;
  const canCreateAgency = canRefEdit && (!companyActor || !!ownCompany);
  const canEditAgency = (a: AgencyView) => canRefEdit && (!companyActor || a.companyId === ownCompany?.id);
  const canCreateExpert = canRefEdit && (!companyActor || !!me?.company);
  const canEditExpert = (e: ExpertView) => canRefEdit && (!companyActor || (!!me?.company && e.companies.includes(me.company)));
  // SEC-14 : le statut d'un expert (suspension) est commun à toute la place — rôles place seulement.
  const canSetExpertStatus = canRefEdit && !companyActor;

  const navItems: { key: SectionKey; icon: LucideIcon; title: string; subtitle: string }[] = [
    {
      key: 'companies',
      icon: Building2,
      title: t('referential.nav.companies.title'),
      subtitle: `${companiesQuery.data?.total ?? '…'} ${t('referential.nav.companies.unit')} · ${t('referential.nav.companies.subtitleSuffix')}`,
    },
    {
      key: 'agencies',
      icon: MapPin,
      title: t('referential.nav.agencies.title'),
      subtitle: `${(agencyCompany ? agenciesTotalQuery.data?.total : agenciesQuery.data?.total) ?? '…'} ${t('referential.nav.agencies.unit')} · ${t('referential.nav.agencies.subtitleSuffix')}`,
    },
    {
      key: 'experts',
      icon: UserSearch,
      title: t('referential.nav.experts.title'),
      subtitle: `${expertsQuery.data?.total ?? '…'} ${t('referential.nav.experts.unit')} · ${t('referential.nav.experts.subtitleSuffix')}`,
    },
    {
      key: 'convention',
      icon: Settings,
      title: t('referential.nav.convention.title'),
      subtitle: `${t('referential.nav.convention.subtitleSuffix')} · ${conventionQuery.data?.version ?? '…'}`,
    },
    {
      key: 'calendar',
      icon: CalendarDays,
      title: t('referential.nav.calendar.title'),
      subtitle: t('referential.nav.calendar.subtitleSuffix'),
    },
    {
      key: 'motifs',
      icon: Scale,
      title: t('referential.nav.motifs.title'),
      subtitle: `${motifsQuery.data?.length ?? '…'} ${t('referential.nav.motifs.unit')} · ${t('referential.nav.motifs.subtitleSuffix')}`,
    },
    {
      key: 'bareme',
      icon: Car,
      title: t('referential.nav.bareme.title'),
      subtitle: t('referential.nav.bareme.subtitleSuffix'),
    },
    {
      key: 'population',
      icon: UsersRound,
      title: t('referential.nav.population.title'),
      subtitle: t('referential.nav.population.subtitleSuffix'),
    },
    {
      key: 'irsam',
      icon: Gauge,
      title: t('referential.nav.irsam.title'),
      subtitle: t('referential.nav.irsam.subtitleSuffix'),
    },
  ];

  return (
    <>
      <FolioHeader badge="§3.1" title={t('referential.title')} subtitle={t('referential.subtitle')} />

      <div className="grid g-ref rf-layout">
        <div className="sheet rf-nav-card">
          <div className="rf-nav-head">
            <span className="rf-nav-logo" aria-hidden="true">
              <FileCheck2 size={26} strokeWidth={2} />
            </span>
            <span className="rf-nav-head-text">
              <span className="rf-nav-head-title">{t('referential.title')}</span>
              <span className="rf-nav-head-sub">{t('referential.nav.header.sub')}</span>
            </span>
          </div>
          <nav className="ref-nav rf-nav" aria-label={t('referential.title')}>
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  className={`ref-nav-item${section === item.key ? ' active' : ''}`}
                  onClick={() => {
                    if (item.key === 'agencies' && section !== 'agencies') {
                      setAgencyCompany(null);
                      setAgenciesPage(1);
                    }
                    setSection(item.key);
                  }}
                  aria-current={section === item.key ? 'true' : undefined}
                >
                  <span className="ref-nav-icon" aria-hidden="true">
                    <Icon size={16} strokeWidth={1.8} />
                  </span>
                  <span className="ref-nav-text">
                    <span className="ref-nav-title">{item.title}</span>
                    <span className="ref-nav-sub">{item.subtitle}</span>
                  </span>
                  <span className="ref-nav-chevron" aria-hidden="true">
                    <ChevronRight size={16} strokeWidth={2} />
                  </span>
                </button>
              );
            })}
          </nav>
        </div>

        {section === 'companies' ? (
          <CompaniesPanel
            query={companiesQuery}
            page={companiesPage}
            onPageChange={setCompaniesPage}
            canCreate={canCreate}
            canEdit={canEditCompany}
            onCreate={() => {
              setCreateForm(EMPTY_FORM);
              setCreateOpen(true);
            }}
            onEdit={setEditCompany}
            onGovernance={canSeeGovernance ? setGovernanceCompany : undefined}
            onAgencies={(c) => {
              setAgencyCompany(c);
              setAgenciesPage(1);
              setSection('agencies');
            }}
            exportRows={companiesMapQuery.data?.items}
          />
        ) : section === 'agencies' ? (
          <AgenciesPanel
            query={agenciesQuery}
            page={agenciesPage}
            onPageChange={setAgenciesPage}
            companyById={companyById}
            filterCompany={agencyCompany}
            onClearFilter={() => {
              setAgencyCompany(null);
              setAgenciesPage(1);
            }}
            onCreate={canCreateAgency ? () => setAgencyTarget({ mode: 'create' }) : undefined}
            canEdit={canEditAgency}
            onEdit={(agency) => setAgencyTarget({ mode: 'edit', agency })}
            companies={companiesMapQuery.data?.items ?? []}
            lockedCompany={companyActor ? ownCompany : undefined}
            canEditOrg={(c) => canRefEdit && (!companyActor || c.id === ownCompany?.id)}
            onAddInOrg={(companyId, preset) => {
              setAgencyDialogCompanyId(companyId);
              setAgencyTarget({ mode: 'create', preset });
            }}
          />
        ) : section === 'experts' ? (
          <ExpertsPanel
            query={expertsQuery}
            page={expertsPage}
            onPageChange={setExpertsPage}
            showRib={!companyActor}
            onCreate={canCreateExpert ? () => setExpertTarget({ mode: 'create' }) : undefined}
            canEdit={canEditExpert}
            onEdit={(expert) => setExpertTarget({ mode: 'edit', expert })}
            canSetStatus={canSetExpertStatus}
          />
        ) : section === 'convention' ? (
          <ConventionPanel query={conventionQuery} />
        ) : section === 'calendar' ? (
          <CalendarSection />
        ) : section === 'motifs' ? (
          <MotifsSection eligibilityQuery={motifsQuery} />
        ) : section === 'bareme' ? (
          <BaremeSection />
        ) : section === 'population' ? (
          <PopulationSection />
        ) : (
          <IrsamSection />
        )}
      </div>

      <Modal
        open={!!editCompany}
        title={`${t('referential.company.edit.title')} — ${editCompany?.name ?? ''}`}
        onClose={() => setEditCompany(null)}
        footer={
          <button
            type="button"
            disabled={updateMutation.isPending}
            onClick={() => updateMutation.mutate(toProfileBody(editForm))}
            style={{ padding: '8px 16px', borderRadius: 'var(--k-r-s)', border: '1px solid var(--k-pri)', background: 'var(--k-pri)', color: '#fff', font: 'inherit', cursor: 'pointer' }}
          >
            {t('referential.company.field.submit')}
          </button>
        }
      >
        <CompanyFormFields form={editForm} setForm={setEditForm} t={t} profileOnly />
      </Modal>

      <Modal
        open={!!governanceCompany}
        title={`${t('referential.governance.title')} — ${governanceCompany?.name ?? ''}`}
        onClose={() => setGovernanceCompany(null)}
      >
        {governanceCompany ? <GovernancePanel company={governanceCompany} canDecide={canDecideGovernance} /> : null}
      </Modal>

      <Modal
        open={createOpen}
        title={t('referential.company.create.title')}
        onClose={() => setCreateOpen(false)}
        footer={
          <button
            type="button"
            disabled={createMutation.isPending || !createForm.code || !createForm.name || !createForm.color}
            onClick={() => createMutation.mutate(toFormBody(createForm))}
            style={{ padding: '8px 16px', borderRadius: 'var(--k-r-s)', border: '1px solid var(--k-pri)', background: 'var(--k-pri)', color: '#fff', font: 'inherit', cursor: 'pointer' }}
          >
            {t('referential.company.field.submit')}
          </button>
        }
      >
        <CompanyFormFields form={createForm} setForm={setCreateForm} t={t} />
      </Modal>

      <AgencyDialog
        target={agencyTarget}
        companies={companiesMapQuery.data?.items ?? []}
        lockedCompanyId={companyActor ? ownCompany?.id : undefined}
        defaultCompanyId={agencyDialogCompanyId ?? agencyCompany?.id}
        onClose={() => {
          setAgencyTarget(null);
          setAgencyDialogCompanyId(undefined);
        }}
      />

      <ExpertDialog
        target={expertTarget}
        companies={companiesMapQuery.data?.items ?? []}
        ownCompany={companyActor ? me?.company : undefined}
        onClose={() => setExpertTarget(null)}
      />
    </>
  );
}

/* ===================== Compagnies adhérentes ===================== */

function CompaniesPanel({
  query,
  page,
  onPageChange,
  canCreate,
  canEdit,
  onCreate,
  onEdit,
  onGovernance,
  onAgencies,
  exportRows,
}: {
  query: ReturnType<typeof useQuery<Paginated<CompanyListItem>>>;
  page: number;
  onPageChange: (p: number) => void;
  canCreate: boolean;
  canEdit: (c: CompanyListItem) => boolean;
  onCreate: () => void;
  onEdit: (c: CompanyListItem) => void;
  onGovernance?: (c: CompanyListItem) => void;
  onAgencies: (c: CompanyListItem) => void;
  /** Toutes les compagnies visibles (toutes pages) pour l'export « Excel ». */
  exportRows?: CompanyListItem[];
}) {
  const { t, locale } = useI18n();

  function sinceLabel(c: CompanyListItem): string | null {
    return c.createdAt ? new Date(c.createdAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) : null;
  }

  /** SEC-26 : projection publique d'une concurrente — date d'adhésion, réseau et correspondant absents. */
  function metaLine(c: CompanyListItem): string {
    const parts: string[] = [];
    const since = sinceLabel(c);
    if (since) parts.push(`${t('referential.company.card.since')} ${since}`);
    if (c.agencyCounts) {
      parts.push(`${c.agencyCounts.DG} DG`);
      parts.push(`${c.agencyCounts.DR} DR`);
      parts.push(`${c.agencyCounts.AG} ${t('referential.company.card.agencies')}`);
    }
    if (c.correspondentName) parts.push(`${t('referential.company.card.correspondent')} ${c.correspondentName}`);
    if (!c.agencyCounts && !c.createdAt) parts.push(t('referential.company.card.public'));
    return parts.join(' · ');
  }

  // Export CSV (« ⤓ Excel » de la maquette) — généré côté front depuis les seules
  // données renvoyées par l'API (projection publique SEC-26 : champs absents laissés vides).
  function exportCsv() {
    const rows = exportRows ?? query.data?.items ?? [];
    const header = [
      t('referential.company.col.code'),
      t('referential.company.col.name'),
      t('referential.company.col.nameAr'),
      t('referential.company.status'),
      t('referential.company.col.since'),
      'DG',
      'DR',
      t('referential.company.card.agenciesBadge'),
      t('referential.company.col.correspondent'),
    ];
    downloadCsv(
      t('referential.company.export.file'),
      buildCsv(
        header,
        rows.map((c) => [
          c.code,
          c.name,
          c.nameAr ?? '',
          statusLabel(c.status, t),
          c.createdAt ? c.createdAt.slice(0, 10) : '',
          c.agencyCounts?.DG ?? '',
          c.agencyCounts?.DR ?? '',
          c.agencyCounts?.AG ?? '',
          c.correspondentName ?? '',
        ]),
      ),
    );
  }

  return (
    <div className="sheet rf-panel">
      <div className="sheet-head">
        <span>{t('referential.nav.companies.title')}</span>
        <span className="rf-head-actions">
          {query.data && query.data.items.length > 0 ? (
            <button type="button" className="rf-xl" onClick={exportCsv}>
              <Download size={15} strokeWidth={2} aria-hidden="true" />
              {t('common.exportExcel')}
            </button>
          ) : null}
          {canCreate ? (
            <button type="button" className="btn-primary" onClick={onCreate}>
              <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
              {t('referential.company.create')}
            </button>
          ) : null}
        </span>
      </div>
      <div className="sheet-body flush">
        {query.isLoading ? (
          <p className="pad">{t('common.loading')}</p>
        ) : query.error || !query.data ? (
          <div className="pad">
            <div className="note ko" role="alert">
              <span>{t('common.error')}</span>
              <button type="button" onClick={() => query.refetch()}>
                {t('common.retry')}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="co-card-list">
              {query.data.items.length === 0 ? (
                <p className="pad" style={{ color: 'var(--ink-3)' }}>
                  {t('common.noData')}
                </p>
              ) : (
                query.data.items.map((c) => (
                  <div className="co-card" key={c.id}>
                    <span className="rf-logo">
                      <CoChip code={c.code} color={c.color} />
                    </span>
                    <div className="co-card-id">
                      <div className="co-card-name">
                        {c.name} <span className="rf-code">{c.code}</span>
                      </div>
                      <div className="co-card-meta">
                        {c.nameAr ? (
                          <span dir="rtl" lang="ar">
                            {c.nameAr}
                          </span>
                        ) : null}
                        {c.nameAr ? ' · ' : null}
                        {metaLine(c)}
                      </div>
                    </div>
                    {c.agencyCounts ? (
                      <button type="button" className="rf-act" onClick={() => onAgencies(c)} aria-label={`${t('referential.company.agencies.open')} ${c.code}`}>
                        <MapPin size={14} strokeWidth={2} aria-hidden="true" />
                        {c.agencyCounts.AG} {t('referential.company.card.agenciesBadge')}
                      </button>
                    ) : (
                      <span className="rf-act rf-act-muted">—</span>
                    )}
                    {canEdit(c) ? (
                      <button type="button" className="rf-act" onClick={() => onEdit(c)} aria-label={`${t('referential.company.edit')} ${c.code}`}>
                        <Settings size={14} strokeWidth={2} aria-hidden="true" />
                        {t('referential.company.edit')}
                      </button>
                    ) : null}
                    {onGovernance ? (
                      <button
                        type="button"
                        className="rf-act rf-icon-btn"
                        onClick={() => onGovernance(c)}
                        aria-label={`${t('referential.governance.open')} ${c.code}`}
                        title={t('referential.governance.open')}
                      >
                        <ShieldCheck size={15} strokeWidth={2} aria-hidden="true" />
                      </button>
                    ) : null}
                    <span className="rf-status">
                      <Tag tone={statusTone(c.status)}>{statusLabel(c.status, t)}</Tag>
                    </span>
                  </div>
                ))
              )}
            </div>
            {query.data.total > PAGE_SIZE ? <Pager page={page} total={query.data.total} pageSize={PAGE_SIZE} onPageChange={onPageChange} t={t} /> : null}
          </>
        )}
      </div>
    </div>
  );
}

function CompanyFormFields({
  form,
  setForm,
  t,
  profileOnly = false,
}: {
  form: CompanyForm;
  setForm: (f: (prev: CompanyForm) => CompanyForm) => void;
  t: (k: TranslationKey) => string;
  /** SEC-04 : en modification, code et champs de gouvernance en lecture seule (demande de changement dédiée). */
  profileOnly?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
      <LabeledInput label={t('referential.company.field.code')} value={form.code} disabled={profileOnly} onChange={(v) => setForm((f) => ({ ...f, code: v.toUpperCase() }))} />
      <LabeledInput label={t('referential.company.field.name')} value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
      <LabeledInput label={t('referential.company.field.nameAr')} value={form.nameAr} onChange={(v) => setForm((f) => ({ ...f, nameAr: v }))} />
      <LabeledInput label={t('referential.company.field.color')} value={form.color} onChange={(v) => setForm((f) => ({ ...f, color: v }))} type="color" />
      <LabeledSelect label={t('referential.company.field.kind')} value={form.kind} disabled={profileOnly} onChange={(v) => setForm((f) => ({ ...f, kind: v as CompanyKind }))} options={['INSURER', 'MUTUAL', 'SUBSIDIARY']} />
      <LabeledSelect label={t('referential.company.field.feedMode')} value={form.feedMode} disabled={profileOnly} onChange={(v) => setForm((f) => ({ ...f, feedMode: v as FeedMode }))} options={['ERP', 'ECONSTAT', 'IMPORT', 'API']} />
      <LabeledSelect
        label={t('referential.company.status')}
        value={form.status}
        disabled={profileOnly}
        onChange={(v) => setForm((f) => ({ ...f, status: v as CompanyStatus }))}
        options={['ACTIF', 'SUSPENDU', 'EN_RETRAIT', 'EXCLU']}
      />
      {profileOnly ? <p style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)', margin: 0 }}>{t('referential.governance.readonlyHint')}</p> : null}
      <LabeledInput label={t('referential.company.field.correspondentName')} value={form.correspondentName} onChange={(v) => setForm((f) => ({ ...f, correspondentName: v }))} />
      <LabeledInput label={t('referential.company.field.correspondentPhone')} value={form.correspondentPhone} onChange={(v) => setForm((f) => ({ ...f, correspondentPhone: v }))} />
      <LabeledInput label={t('referential.company.field.correspondentEmail')} value={form.correspondentEmail} onChange={(v) => setForm((f) => ({ ...f, correspondentEmail: v }))} type="email" />
    </div>
  );
}

/* ===================== Agences ===================== */

function AgenciesPanel({
  query,
  page,
  onPageChange,
  companyById,
  filterCompany,
  onClearFilter,
  onCreate,
  canEdit,
  onEdit,
  companies,
  lockedCompany,
  canEditOrg,
  onAddInOrg,
}: {
  companies: CompanyListItem[];
  /** Rôle compagnie : l'organigramme est celui de SA compagnie. */
  lockedCompany?: CompanyListItem;
  canEditOrg: (c: CompanyListItem) => boolean;
  onAddInOrg: (companyId: string, preset: OrgAddRequest) => void;
  query: ReturnType<typeof useQuery<Paginated<AgencyView>>>;
  page: number;
  onPageChange: (p: number) => void;
  companyById: Map<string, CompanyListItem>;
  filterCompany: CompanyListItem | null;
  onClearFilter: () => void;
  /** `POST /referential/agencies` — absent sans le privilège `refedit`. */
  onCreate?: () => void;
  canEdit: (a: AgencyView) => boolean;
  onEdit: (a: AgencyView) => void;
}) {
  const { t } = useI18n();
  const editable = (query.data?.items ?? []).some(canEdit);
  // Correspondant : son organigramme d'abord ; place : la liste, puis l'organigramme d'une compagnie choisie.
  const [view, setView] = useState<'list' | 'chart'>(lockedCompany ? 'chart' : 'list');
  const [orgCompanyId, setOrgCompanyId] = useState<string>('');
  const orgCompany = lockedCompany ?? filterCompany ?? companies.find((c) => c.id === orgCompanyId);

  const columns: Column<AgencyView>[] = [
    { key: 'code', header: t('referential.agency.col.code'), render: (r) => r.code },
    { key: 'name', header: t('referential.agency.col.name'), render: (r) => r.name },
    { key: 'type', header: t('referential.agency.col.type'), render: (r) => r.type },
    {
      key: 'company',
      header: t('referential.agency.col.company'),
      render: (r) => {
        const c = companyById.get(r.companyId);
        return c ? <CoChip code={c.code} color={c.color} /> : '—';
      },
    },
    { key: 'wilaya', header: t('referential.agency.col.wilaya'), render: (r) => r.wilayaCode ?? '—' },
    { key: 'status', header: t('referential.company.status'), render: (r) => <Tag tone={statusTone(r.status)}>{statusLabel(r.status, t)}</Tag> },
    ...(editable
      ? [
          {
            key: 'actions',
            header: t('referential.col.actions'),
            render: (r: AgencyView) =>
              canEdit(r) ? (
                <RowAction ariaLabel={`${t('referential.agency.edit.title')} ${r.code}`} onClick={() => onEdit(r)}>
                  {t('referential.action.edit')}
                </RowAction>
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <div className="sheet rf-panel">
      <div className="sheet-head">
        <span>{t('referential.nav.agencies.title')}</span>
        <span className="org-view" role="group" aria-label={t('referential.org.title')}>
          {(['list', 'chart'] as const).map((v) => (
            <button key={v} type="button" className={view === v ? 'on' : ''} aria-pressed={view === v} onClick={() => setView(v)}>
              {v === 'list' ? <List size={14} aria-hidden="true" /> : <Network size={14} aria-hidden="true" />}
              {t(`referential.org.view.${v}` as TranslationKey)}
            </button>
          ))}
        </span>
        {filterCompany || onCreate ? (
          <span className="rf-head-actions">
            {filterCompany ? (
              <>
                <span className="rf-filter" aria-label={`${t('referential.agency.filter.company')} ${filterCompany.code}`}>
                  <CoChip code={filterCompany.code} color={filterCompany.color} />
                </span>
                <button type="button" className="rf-xl" onClick={onClearFilter}>
                  <X size={14} strokeWidth={2} aria-hidden="true" />
                  {t('referential.agency.filter.clear')}
                </button>
              </>
            ) : null}
            {onCreate ? (
              <button type="button" className="btn-primary" onClick={onCreate}>
                <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
                {t('referential.agency.create')}
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      <div className="sheet-body">
        {query.isLoading ? (
          <p>{t('common.loading')}</p>
        ) : query.error || !query.data ? (
          <div className="note ko" role="alert">
            <span>{t('common.error')}</span>
            <button type="button" onClick={() => query.refetch()}>
              {t('common.retry')}
            </button>
          </div>
        ) : (
          view === 'chart' ? (
            <>
              {!lockedCompany && !filterCompany ? (
                <div className="org-picker">
                  <LabeledSelect
                    label={t('referential.org.chooseCompany')}
                    value={orgCompanyId}
                    options={[{ value: '', label: '—', disabled: true }, ...companies.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }))]}
                    onChange={setOrgCompanyId}
                  />
                </div>
              ) : null}
              {orgCompany ? (
                <AgencyOrgChart company={orgCompany} canEdit={canEditOrg(orgCompany)} onAdd={(req) => onAddInOrg(orgCompany.id, req)} onEdit={onEdit} />
              ) : (
                <p className="muted">{t('referential.org.pickCompany')}</p>
              )}
            </>
          ) : (
            <Table columns={columns} rows={query.data.items} page={page} total={query.data.total} pageSize={PAGE_SIZE} onPageChange={onPageChange} getRowKey={(r) => r.id} />
          )
        )}
      </div>
    </div>
  );
}

/* ===================== Experts agréés ===================== */

function ExpertsPanel({
  query,
  page,
  onPageChange,
  showRib,
  onCreate,
  canEdit,
  onEdit,
  canSetStatus,
}: {
  query: ReturnType<typeof useQuery<Paginated<ExpertView>>>;
  page: number;
  onPageChange: (p: number) => void;
  /** SEC-14 : RIB masqué publié aux seuls rôles place (jamais en clair). */
  showRib: boolean;
  /** `POST /referential/experts` — absent sans le privilège `refedit`. */
  onCreate?: () => void;
  canEdit: (e: ExpertView) => boolean;
  onEdit: (e: ExpertView) => void;
  /** SEC-14 : suspension / réactivation (statut global) réservée aux rôles place. */
  canSetStatus: boolean;
}) {
  const { t } = useI18n();
  const statusMutation = useExpertStatusMutation();
  const editable = (query.data?.items ?? []).some(canEdit);

  const columns: Column<ExpertView>[] = [
    { key: 'name', header: t('referential.expert.col.name'), render: (r) => r.name },
    { key: 'firm', header: t('referential.expert.col.firm'), render: (r) => r.firm ?? '—' },
    { key: 'wilayas', header: t('referential.expert.col.wilayas'), render: (r) => r.wilayas.join(', ') },
    { key: 'companies', header: t('referential.expert.col.companies'), render: (r) => r.companies.join(', ') || '—' },
    ...(showRib ? [{ key: 'rib', header: t('referential.expert.col.rib'), render: (r: ExpertView) => <span className="mono">{r.ribMasked ?? '—'}</span> }] : []),
    { key: 'status', header: t('referential.company.status'), render: (r) => <Tag tone={statusTone(r.status)}>{statusLabel(r.status, t)}</Tag> },
    ...(editable
      ? [
          {
            key: 'actions',
            header: t('referential.col.actions'),
            render: (r: ExpertView) =>
              canEdit(r) ? (
                <RowActions>
                  <RowAction ariaLabel={`${t('referential.expert.edit.title')} ${r.name}`} onClick={() => onEdit(r)}>
                    {t('referential.action.edit')}
                  </RowAction>
                  {canSetStatus && r.status !== 'RADIE' ? (
                    <RowAction
                      ariaLabel={`${t(r.status === 'ACTIF' ? 'referential.expert.action.suspend' : 'referential.expert.action.reactivate')} ${r.name}`}
                      disabled={statusMutation.isPending}
                      onClick={() => statusMutation.mutate({ id: r.id, status: r.status === 'ACTIF' ? 'SUSPENDU' : 'ACTIF' })}
                    >
                      {t(r.status === 'ACTIF' ? 'referential.expert.action.suspend' : 'referential.expert.action.reactivate')}
                    </RowAction>
                  ) : null}
                </RowActions>
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <div className="sheet rf-panel">
      <div className="sheet-head">
        <span>{t('referential.nav.experts.title')}</span>
        {onCreate ? (
          <span className="rf-head-actions">
            <button type="button" className="btn-primary" onClick={onCreate}>
              <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
              {t('referential.expert.create')}
            </button>
          </span>
        ) : null}
      </div>
      <div className="sheet-body">
        {query.isLoading ? (
          <p>{t('common.loading')}</p>
        ) : query.error || !query.data ? (
          <div className="note ko" role="alert">
            <span>{t('common.error')}</span>
            <button type="button" onClick={() => query.refetch()}>
              {t('common.retry')}
            </button>
          </div>
        ) : (
          <Table columns={columns} rows={query.data.items} page={page} total={query.data.total} pageSize={PAGE_SIZE} onPageChange={onPageChange} getRowKey={(r) => r.id} />
        )}
      </div>
    </div>
  );
}

/* ===================== Paramètres de la convention ===================== */

function ConventionPanel({ query }: { query: ReturnType<typeof useQuery<ConventionParams>> }) {
  const { t, locale } = useI18n();

  return (
    <div className="sheet rf-panel">
      <div className="sheet-head">
        <span>{t('referential.nav.convention.title')}</span>
      </div>
      <div className="sheet-body">
        {query.isLoading ? (
          <p>{t('common.loading')}</p>
        ) : query.error || !query.data ? (
          <div className="note ko" role="alert">
            <span>{t('common.error')}</span>
            <button type="button" onClick={() => query.refetch()}>
              {t('common.retry')}
            </button>
          </div>
        ) : (
          <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s-4)' }}>
            <Field label={t('referential.convention.version')}>
              <span className="mono">{query.data.version}</span>
            </Field>
            <Field label={t('referential.convention.art4')}>{query.data.maxAmountDA.toLocaleString(locale)} DA</Field>
            <Field label={t('referential.convention.art10')}>
              {query.data.silenceDays} {t('referential.convention.unit.days')}
            </Field>
            <Field label={t('referential.convention.art12')}>
              {query.data.oppositionDays} {t('referential.convention.unit.days')}
            </Field>
            <Field label={t('referential.convention.art19')}>
              {query.data.forclusionMonths} {t('referential.convention.unit.months')}
            </Field>
          </dl>
        )}
      </div>
    </div>
  );
}

/* ===================== Utilitaires partagés ===================== */

function Pager({ page, total, pageSize, onPageChange, t }: { page: number; total: number; pageSize: number; onPageChange: (p: number) => void; t: (k: TranslationKey) => string }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pager">
      <span>
        {total === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} {t('common.of')} {total} · {t('common.page')} {page} / {pageCount}
      </span>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" aria-label={t('common.previous')} disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
        </button>
        <button type="button" aria-label={t('common.next')} disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
          <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>
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
