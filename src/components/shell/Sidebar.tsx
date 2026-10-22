'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, LogOut } from 'lucide-react';
import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/provider';
import { TranslationKey } from '@/i18n/translations';
import { apiGet, apiPath } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { isCompanyActor } from '@/lib/recours-actions';
import { clearDevRole } from '@/lib/auth/dev-role';
import { useRealtime, useRealtimeConnected } from '@/lib/realtime';
import { CommissionSummary, MatchCounters, SettlementMonthlySummary } from '@/lib/types';
import { FinLabMark } from './Brand';
import { initials } from './Topbar';
import { NavBadgeSource, visibleNavItems } from './nav-items';

const BADGE_POLL_MS = 30_000;

/** Période mensuelle courante `AAAA-MM` (cycle mensuel Art. 16). */
function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Rattachement affiché sous le nom : la compagnie pour un rôle compagnie, l'institution du rôle pour un rôle de place. */
function organisation(t: (k: TranslationKey) => string, role: string, company: string | undefined): string {
  if (company) return company;
  const key = `shell.org.${role}` as TranslationKey;
  const label = t(key);
  return label === key ? '' : label;
}

/**
 * Barre latérale (A.3) : 14 écrans avec icône, pastilles de compteurs RÉELS
 * (voir `NavBadgeSource`), et pied d'identité (utilisateur, cycle mensuel en
 * cours et son échéance Art. 16 réelle, état réel du flux temps réel).
 */
export function Sidebar({ collapsed, onNavigate }: { collapsed: boolean; onNavigate: () => void }) {
  const pathname = usePathname();
  const { t, locale } = useI18n();
  const { me, mode, logout, hasPrivilege } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [aboutOpen, setAboutOpen] = useState(false);
  const enabled = !!me;

  // Abonnement temps réel au niveau de la coque : invalide les requêtes de
  // tous les écrans et alimente l'indicateur « Flux temps réel actif ».
  useRealtime(['claim.ingested', 'match.updated', 'recours.timer', 'metering.tick', 'ledger.appended']);
  const live = useRealtimeConnected();

  const matching = useQuery({
    queryKey: ['matching', 'counters'],
    queryFn: () => apiGet<MatchCounters>('/matching/queue/counters'),
    enabled,
    refetchInterval: BADGE_POLL_MS,
  });
  const recours = useQuery({
    queryKey: ['recours', 'counters'],
    queryFn: () => apiGet<Record<string, number>>('/recours/counters'),
    enabled,
    refetchInterval: BADGE_POLL_MS,
  });
  const commission = useQuery({
    queryKey: ['commission', 'summary'],
    queryFn: () => apiGet<CommissionSummary>('/commission/summary'),
    enabled,
    refetchInterval: BADGE_POLL_MS,
  });
  const period = currentPeriod();
  const monthly = useQuery({
    queryKey: ['settlement', 'monthly', period, 'summary'],
    queryFn: () => apiGet<SettlementMonthlySummary>(apiPath`/settlement/monthly/${period}/summary`),
    enabled,
  });

  const badgeValue = (source: NavBadgeSource): number => {
    if (source === 'matching') return matching.data?.A_CONFIRMER ?? 0;
    if (source === 'exchanges') return recours.data?.EN_ATTENTE ?? 0;
    return commission.data?.pendingCount ?? 0;
  };

  const deadline = monthly.data?.insertionDeadline
    ? new Date(`${monthly.data.insertionDeadline}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : undefined;

  const onLogout = () => {
    if (mode === 'keycloak') {
      logout();
      return;
    }
    // Mode développement : aucune session à fermer — on revient à l'identité configurée.
    clearDevRole();
    void queryClient.resetQueries();
    toast(t('shell.devLogout'), 'ok');
  };

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`} aria-label={t('shell.navigation')}>
      <nav className="side-nav">
        {visibleNavItems(isCompanyActor(me), hasPrivilege).map((item) => {
          const active = !!pathname?.startsWith(item.href);
          const Icon = item.icon;
          const count = item.badge ? badgeValue(item.badge) : 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`side-item${active ? ' active' : ''}`}
              aria-current={active ? 'page' : undefined}
              title={collapsed ? t(item.labelKey) : undefined}
              onClick={onNavigate}
            >
              <Icon className="side-icon" size={18} strokeWidth={1.7} aria-hidden="true" />
              <span className="side-label">{t(item.labelKey)}</span>
              {item.badge && count > 0 ? (
                <span className={`side-badge ${item.badge}`} aria-label={`${count}`}>
                  {count}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="side-foot">
        {me ? (
          <div className="side-user">
            <div className="side-user-head">
              <span className="side-avatar" aria-hidden="true">
                {initials(me.user.name)}
              </span>
              <strong>{me.user.name}</strong>
            </div>
            <div className="side-meta">{organisation(t, me.role, me.company)}</div>
            <div className="side-meta">
              {t('shell.monthlyCycle')} · <span className="mono">{period}</span>
            </div>
            {deadline ? (
              <div className="side-meta">
                <span className="mono-chip">Art. 16</span> <span className="mono">{deadline}</span>
              </div>
            ) : null}
            <div className="side-meta">
              <span className={`live-dot${live ? ' on' : ''}`} aria-hidden="true" /> {live ? t('shell.liveOn') : t('shell.liveOff')}
            </div>
          </div>
        ) : null}
        <button type="button" className="side-link" onClick={() => setAboutOpen(true)}>
          <Info size={15} strokeWidth={1.8} aria-hidden="true" />
          <span className="side-label">{t('shell.about')}</span>
        </button>
        <button type="button" className="side-link" onClick={onLogout}>
          <LogOut size={15} strokeWidth={1.8} aria-hidden="true" />
          <span className="side-label">{t('shell.logout')}</span>
        </button>
        <div className="side-powered">
          <FinLabMark size={14} />
          <span className="side-label">{t('shell.poweredBy')}</span>
        </div>
      </div>

      <Modal open={aboutOpen} title={t('shell.about')} onClose={() => setAboutOpen(false)}>
        <p style={{ marginTop: 0 }}>{t('shell.aboutText')}</p>
        <p style={{ marginBottom: 0, color: 'var(--ink-2)', fontSize: 'var(--k-fs-s)' }}>{t('shell.poweredBy')}</p>
      </Modal>
    </aside>
  );
}
