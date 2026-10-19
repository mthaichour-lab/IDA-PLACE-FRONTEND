import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PipelineSection } from '@/components/settlement/PipelineSection';
import { MeResponse, QuarterlyPipeline } from '@/lib/types';
import { mockFetchRequests, renderWithProviders } from '@/test/render';
import MonthlyPage from './page';

/**
 * SEC-19 / SEC-26 / SEC-34 — compensation : la synthèse mensuelle ne compte
 * que les recours réglés, la clôture d'une période non échue (409
 * PERIODE_NON_ECHUE) est expliquée, et l'auteur/la note d'une étape du lot
 * trimestriel sont absents pour un rôle compagnie.
 */

const OPERATEUR: MeResponse = { user: { id: 'u-op', name: 'Op.', email: 'op@uar.dz' }, role: 'OPERATEUR_PLACE', privileges: ['synth', 'closeQuarter'] };
const TRESORIER: MeResponse = { user: { id: 'u-t', name: 'Trés.', email: 't@caat.dz' }, role: 'TRESORIER', privileges: ['synth'], company: 'CAAT' };

describe('Compensation — périodes non échues et minimisation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('cycle mensuel : colonne « Recours réglés » et 409 PERIODE_NON_ECHUE traduit à la clôture', async () => {
    mockFetchRequests((req) => {
      if (req.pathname === '/api/v1/me') return { body: OPERATEUR };
      if (req.method === 'POST' && req.pathname.endsWith('/close')) return { status: 409, body: { code: 'PERIODE_NON_ECHUE', message: 'x' } };
      if (req.pathname.endsWith('/summary')) return { body: { period: '2026-10', settledCount: 3, totalAmount: 1, excludedOppositionCount: 0, insertionDeadline: '2026-11-05' } };
      if (req.pathname.endsWith('/annexe7')) return { body: { period: '2026-10', pairs: [] } };
      if (req.pathname.startsWith('/api/v1/settlement/monthly/'))
        return { body: { period: '2026-10', companies: [{ code: 'CAAT', claimsCount: 3, resolvedCount: 3, totalAmount: 450_000, status: 'EN_COURS' }] } };
      return undefined;
    });
    renderWithProviders(<MonthlyPage />);
    const user = userEvent.setup();

    expect(await screen.findByRole('columnheader', { name: 'Recours réglés' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /bordereau/i }));
    expect(await screen.findByText('La période n’est pas échue : elle ne peut pas encore être clôturée.')).toBeInTheDocument();
  });

  it('lot trimestriel, rôle compagnie : étape réalisée sans auteur ni note (date seule)', async () => {
    const pipeline: QuarterlyPipeline = {
      quarter: '2026-Q3',
      steps: [
        { step: 'SAISIE', label: 'Saisie', article: 'Art. 16', status: 'DONE', dueDate: '2026-10-05', overdue: false, completedAt: '2026-10-04T08:00:00.000Z' },
        { step: 'SYNTHESE_ANNEXE_7', label: 'Synthèse', article: 'Art. 16', status: 'EN_COURS', dueDate: '2026-10-10', overdue: false },
        { step: 'TRANSMISSION_ANNEXE_8', label: 'Transmission', article: 'Art. 16', status: 'A_VENIR', dueDate: '2026-10-15', overdue: false },
        { step: 'SYNTHESE_GLOBALE_REUNION', label: 'Réunion', article: 'Art. 17', status: 'A_VENIR', dueDate: '2026-10-20', overdue: false },
        { step: 'PV_REGLEMENT', label: 'PV', article: 'Art. 18', status: 'A_VENIR', dueDate: '2026-10-28', overdue: false },
      ],
    };
    mockFetchRequests((req) => {
      if (req.pathname === '/api/v1/me') return { body: TRESORIER };
      if (req.pathname === '/api/v1/settlement/quarter/2026-Q3/pipeline') return { body: pipeline };
      return undefined;
    });
    renderWithProviders(<PipelineSection quarter="2026-Q3" />);

    const step = await screen.findByTestId('pipeline-step-SAISIE');
    expect(within(step).getByText(/Réalisée le/)).toBeInTheDocument();
    expect(within(step).queryByText(/Réalisée par/)).not.toBeInTheDocument();
    expect(step).not.toHaveTextContent('—');
  });

  it('clôture trimestrielle : 409 PERIODE_NON_ECHUE traduit', async () => {
    const steps = (['SAISIE', 'SYNTHESE_ANNEXE_7', 'TRANSMISSION_ANNEXE_8', 'SYNTHESE_GLOBALE_REUNION'] as const).map((s) => ({
      step: s,
      label: s,
      article: 'Art. 16',
      status: 'DONE' as const,
      dueDate: '2026-12-01',
      overdue: false,
      completedAt: '2026-10-01T08:00:00.000Z',
      completedBy: 'Op.',
    }));
    mockFetchRequests((req) => {
      if (req.pathname === '/api/v1/me') return { body: OPERATEUR };
      if (req.method === 'POST' && req.pathname === '/api/v1/settlement/quarter/2026-Q4/close') return { status: 409, body: { code: 'PERIODE_NON_ECHUE', message: 'x' } };
      if (req.pathname === '/api/v1/settlement/quarter/2026-Q4/pipeline')
        return { body: { quarter: '2026-Q4', steps: [...steps, { step: 'PV_REGLEMENT', label: 'PV', article: 'Art. 18', status: 'EN_COURS', dueDate: '2027-01-28', overdue: false }] } };
      return undefined;
    });
    renderWithProviders(<PipelineSection quarter="2026-Q4" />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Clôturer le trimestre' }));
    await user.click(screen.getByRole('button', { name: 'Confirmer la clôture' }));
    expect(await screen.findByText('La période n’est pas échue : elle ne peut pas encore être clôturée.')).toBeInTheDocument();
  });
});
