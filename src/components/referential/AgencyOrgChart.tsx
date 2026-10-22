'use client';

import { useQuery } from '@tanstack/react-query';
import { Building2, MapPin, Plus, Store, UserRound } from 'lucide-react';
import { CoChip } from '@/components/ui/CoChip';
import { useI18n } from '@/i18n/provider';
import type { TranslationKey } from '@/i18n/translations';
import { buildOrgChart } from '@/lib/agency-org';
import { fetchAllPages } from '@/lib/paginate';
import { AgencyType, AgencyView, CompanyListItem } from '@/lib/types';

/** Ajout d'une entité positionnée dans l'organisation : niveau et rattachement pré-remplis. */
export type OrgAddRequest = { type: AgencyType; parentId?: string };

/**
 * Organigramme d'une compagnie : Direction générale → Directions régionales
 * → agences, construit sur la liste RÉELLE de ses agences (`GET
 * /referential/agencies?companyId=`). Les boutons « + » ouvrent le
 * formulaire avec le niveau et le rattachement déjà choisis ; les entités
 * sans rattachement valide sont signalées à part, jamais placées au hasard.
 */
export function AgencyOrgChart({
  company,
  canEdit,
  onAdd,
  onEdit,
}: {
  company: CompanyListItem;
  canEdit: boolean;
  onAdd: (req: OrgAddRequest) => void;
  onEdit: (a: AgencyView) => void;
}) {
  const { t } = useI18n();
  const query = useQuery({
    queryKey: ['referential', 'agencies', 'org', company.id],
    queryFn: () => fetchAllPages<AgencyView>('/referential/agencies', { companyId: company.id }),
  });

  if (query.isLoading) return <p>{t('common.loading')}</p>;
  if (query.error || !query.data) {
    return (
      <div className="note ko" role="alert">
        <span>{t('common.error')}</span>
        <button type="button" onClick={() => query.refetch()}>
          {t('common.retry')}
        </button>
      </div>
    );
  }

  const org = buildOrgChart(query.data.items);
  const counts = { DR: org.regions.length, AG: query.data.items.filter((a) => a.type === 'AG').length };

  return (
    <div className="org" aria-label={`${t('referential.org.title')} ${company.code}`}>
      <div className="org-company">
        <CoChip code={company.code} color={company.color} />
        <div>
          <strong>{company.name}</strong>
          <span className="org-company-meta">
            {org.dg ? 1 : 0} {t('referential.org.count.DG')} · {counts.DR} {t('referential.org.count.DR')} · {counts.AG} {t('referential.org.count.AG')}
          </span>
        </div>
      </div>

      {org.dg ? (
        <div className="org-root">
          <OrgNode agency={org.dg} canEdit={canEdit} onEdit={onEdit} icon={<Building2 size={16} aria-hidden="true" />} />
          {canEdit ? (
            <div className="org-actions">
              <AddButton label={t('referential.org.add.DR')} onClick={() => onAdd({ type: 'DR', parentId: org.dg!.id })} />
              <AddButton label={t('referential.org.add.AGdirect')} onClick={() => onAdd({ type: 'AG', parentId: org.dg!.id })} />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="org-empty">
          <p>{t('referential.org.noDg')}</p>
          {canEdit ? <AddButton label={t('referential.org.add.DG')} onClick={() => onAdd({ type: 'DG' })} /> : null}
        </div>
      )}

      {org.dg && (org.regions.length > 0 || org.directAgencies.length > 0) ? (
        <ol className="org-branches" aria-label={t('referential.org.branches')}>
          {org.regions.map(({ dr, agencies }) => (
            <li key={dr.id} className="org-branch">
              <OrgNode agency={dr} canEdit={canEdit} onEdit={onEdit} icon={<MapPin size={15} aria-hidden="true" />} />
              <ul className="org-leaves">
                {agencies.map((a) => (
                  <li key={a.id}>
                    <OrgNode agency={a} canEdit={canEdit} onEdit={onEdit} compact icon={<Store size={14} aria-hidden="true" />} />
                  </li>
                ))}
                {agencies.length === 0 ? <li className="org-none">{t('referential.org.noAgency')}</li> : null}
              </ul>
              {canEdit ? <AddButton label={t('referential.org.add.AG')} onClick={() => onAdd({ type: 'AG', parentId: dr.id })} /> : null}
            </li>
          ))}
          {org.directAgencies.length > 0 ? (
            <li className="org-branch org-branch-direct">
              <div className="org-branch-title">{t('referential.org.direct')}</div>
              <ul className="org-leaves">
                {org.directAgencies.map((a) => (
                  <li key={a.id}>
                    <OrgNode agency={a} canEdit={canEdit} onEdit={onEdit} compact icon={<Store size={14} aria-hidden="true" />} />
                  </li>
                ))}
              </ul>
            </li>
          ) : null}
        </ol>
      ) : null}

      {org.unattached.length > 0 ? (
        <div className="org-unattached note warn">
          <strong>{t('referential.org.unattached')}</strong>
          <span>{t('referential.org.unattached.hint')}</span>
          <ul className="org-leaves">
            {org.unattached.map((a) => (
              <li key={a.id}>
                <OrgNode agency={a} canEdit={canEdit} onEdit={onEdit} compact icon={<Store size={14} aria-hidden="true" />} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function OrgNode({ agency, canEdit, onEdit, icon, compact = false }: { agency: AgencyView; canEdit: boolean; onEdit: (a: AgencyView) => void; icon: React.ReactNode; compact?: boolean }) {
  const { t } = useI18n();
  const body = (
    <>
      <span className={`org-node-type org-type-${agency.type}`}>{agency.type}</span>
      <span className="org-node-main">
        <span className="org-node-name">
          {icon}
          {agency.name}
        </span>
        <span className="org-node-meta mono">
          {agency.code}
          {agency.wilayaCode ? ` · ${t('referential.org.wilaya')} ${agency.wilayaCode}` : ''}
        </span>
        {!compact && agency.manager ? (
          <span className="org-node-meta">
            <UserRound size={12} aria-hidden="true" /> {agency.manager}
          </span>
        ) : null}
      </span>
      {agency.status !== 'ACTIF' ? <span className="org-node-status">{t(`referential.status.${agency.status}` as TranslationKey)}</span> : null}
    </>
  );
  const cls = `org-node${compact ? ' compact' : ''}${agency.status !== 'ACTIF' ? ' inactive' : ''}`;
  return canEdit ? (
    <button type="button" className={cls} onClick={() => onEdit(agency)} aria-label={`${t('referential.agency.edit.title')} ${agency.code}`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="org-add" onClick={onClick}>
      <Plus size={14} strokeWidth={2.2} aria-hidden="true" />
      {label}
    </button>
  );
}
