'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { FolioHeader } from '@/components/FolioHeader';
import { BarChart, Sparkline } from '@/components/ui/BarChart';
import { Kpi, KpiRow } from '@/components/ui/Kpi';
import { Tag } from '@/components/ui/Tag';
import { useI18n } from '@/i18n/provider';
import { apiGet } from '@/lib/api-client';
import { CockpitSummary } from '@/lib/types';
import { useRealtime } from '@/lib/realtime';

// Polling de repli (A.1/B.12) : tant que le back n'émet que `metering.tick`
// (voir HANDOFF §1), on rafraîchit aussi toutes les 20s par TanStack Query,
// en plus de l'abonnement temps réel ci-dessous. Les deux mécanismes
// coexistent sans se gêner (le WS déclenche juste un `refetch()` anticipé).
const POLL_INTERVAL_MS = 20_000;

function formatDzd(amount: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'DZD', maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount.toLocaleString()} DA`;
  }
}

export default function CockpitPage() {
  const { t, locale } = useI18n();
  const [live, setLive] = useState(false);

  const query = useQuery({
    queryKey: ['cockpit', 'summary'],
    queryFn: () => apiGet<CockpitSummary>('/cockpit/summary'),
    refetchInterval: POLL_INTERVAL_MS,
  });

  const onRealtimeEvent = useCallback(() => {
    setLive(true);
    void query.refetch();
  }, [query]);

  useRealtime(['claim.ingested', 'match.updated', 'metering.tick'], onRealtimeEvent);

  const data = query.data;

  return (
    <>
      <FolioHeader
        badge="Module I"
        title={t('cockpit.title')}
        subtitle={t('cockpit.subtitle')}
        actions={<Tag tone={live ? 'ok' : 'a'}>{live ? t('cockpit.live.on') : t('cockpit.live.off')}</Tag>}
      />

      {query.isLoading ? (
        <p>{t('common.loading')}</p>
      ) : query.error || !data ? (
        <div className="note ko" role="alert">
          <span>{t('common.error')}</span>
          <button type="button" onClick={() => query.refetch()}>
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <>
          <KpiRow>
            <Kpi value={data.kpis.dossiersDuJour} label={t('cockpit.kpi.dossiersDuJour')} />
            <Kpi value={data.kpis.aApparier} label={t('cockpit.kpi.aApparier')} extra={t('cockpit.shortcuts.matching')} />
            <Kpi value={data.kpis.enRetard} label={t('cockpit.kpi.enRetard')} />
            <Kpi value={formatDzd(data.kpis.compensationAVenir, locale)} label={t('cockpit.kpi.compensationAVenir')} />
          </KpiRow>

          <div className="grid g-side2" style={{ marginTop: 'var(--s-5)' }}>
            <div className="sheet">
              <div className="sheet-head">
                <span>{t('cockpit.sparkline.title')}</span>
              </div>
              <div className="sheet-body">
                <Sparkline values={data.sparklineDeclarations} />
              </div>
            </div>

            <div className="sheet" style={{ gridColumn: 'span 2' }}>
              <div className="sheet-head">
                <span>{t('cockpit.barres.title')}</span>
              </div>
              <div className="sheet-body">
                <BarChart data={data.barresNettes.map((b) => ({ label: b.company, value: b.net }))} />
                <div style={{ display: 'flex', gap: 'var(--s-4)', flexWrap: 'wrap', marginTop: 'var(--s-3)' }}>
                  {data.barresNettes.map((b) => (
                    <span key={b.company} className="mono" style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-2)' }}>
                      {b.company} · {formatDzd(b.net, locale)}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="sheet" style={{ marginTop: 'var(--s-5)' }}>
            <div className="sheet-head">
              <span>{t('cockpit.shortcuts.title')}</span>
              <span style={{ fontSize: 'var(--k-fs-xs)', color: 'var(--ink-3)', fontWeight: 400 }}>
                {t('cockpit.updatedAt')} {new Date(data.updatedAt).toLocaleString(locale)}
              </span>
            </div>
            <div className="sheet-body" style={{ display: 'flex', gap: 'var(--s-3)', flexWrap: 'wrap' }}>
              <Link href="/matching" style={shortcutStyle}>
                {t('cockpit.shortcuts.matching')}
              </Link>
              <Link href="/import" style={shortcutStyle}>
                {t('cockpit.shortcuts.import')}
              </Link>
            </div>
          </div>
        </>
      )}
    </>
  );
}

const shortcutStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  border: '1px solid var(--rule-strong)',
  borderRadius: 'var(--k-r-s)',
  padding: '8px 14px',
  textDecoration: 'none',
  color: 'var(--k-pri)',
  fontWeight: 600,
  fontSize: 'var(--k-fs-s)',
};
