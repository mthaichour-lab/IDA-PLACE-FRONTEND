import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeResponse, StatsSummary, WilayaPopulation, WilayaStat } from '@/lib/types';
import { mockFetchRouter, renderWithProviders } from '@/test/render';
import StatsPage from './page';

/**
 * Écran 11 — décisions PO §3 (« Pour 100 000 hab. ») et §4 (comparatif IRSAM).
 * `per100k` n'est calculé par le back que pour une année étudiée (`?year=`) ;
 * la référence IRSAM n'est comparée qu'une fois validée UAR. Aucune valeur en
 * dur (le « 74 j » de la maquette n'est jamais affiché).
 */

const YEAR = new Date().getUTCFullYear();
const ME: MeResponse = { user: { id: 'u', name: 'Opérateur', email: 'op@uar.dz' }, role: 'OPERATEUR_PLACE', privileges: [] };

function wilaya(code: string, name: string, col: number, overrides: Partial<WilayaStat> = {}): WilayaStat {
  return { code, name, col, row: 1, declarations: 0, montants: 0, per100k: null, populationRef: null, ...overrides };
}

const ALL_YEARS: WilayaStat[] = [wilaya('16', 'Alger', 1, { declarations: 120 }), wilaya('31', 'Oran', 2, { declarations: 80 })];

const FOR_YEAR: WilayaStat[] = [
  wilaya('16', 'Alger', 1, {
    declarations: 60,
    per100k: 1.83,
    populationRef: { population: 3_280_000, referenceYear: 2024, sourceType: 'ESTIMATION_ONS', sourceRef: 'ONS 2024' },
  }),
  wilaya('31', 'Oran', 2, { declarations: 40 }),
];

const POPULATION: WilayaPopulation = {
  id: 'p1',
  wilayaCode: '16',
  referenceYear: 2024,
  population: 3_280_000,
  sourceType: 'ESTIMATION_ONS',
  sourceRef: 'ONS 2024',
  createdBy: 'u-op',
  createdAt: '2026-10-18T00:00:00.000Z',
  valid: true,
};

const SUMMARY: StatsSummary = { declarations: 200, oppositionRatePct: 16, settledAmount: 1_000, avgSettlementDays: 24.5, irsam: null, irsamStatus: 'NON_RENSEIGNE' };

function mockStats({ populations = [] as WilayaPopulation[], summary = SUMMARY } = {}) {
  const wilayaCalls: string[] = [];
  mockFetchRouter((pathname, url) => {
    if (pathname === '/api/v1/me') return ME;
    if (pathname === '/api/v1/stats/summary') return summary;
    if (pathname === '/api/v1/stats/monthly') return [{ month: `${YEAR}-01`, declarations: 1, econstat: 1, autresCanaux: 0, annexes2: 0, oppositions: 0, indemnises: 0 }];
    if (pathname === '/api/v1/referential/wilaya-populations') return populations;
    if (pathname === '/api/v1/stats/wilayas') {
      const year = url.searchParams.get('year');
      wilayaCalls.push(year ?? '');
      return year ? FOR_YEAR : ALL_YEARS;
    }
    return undefined;
  });
  return { wilayaCalls };
}

describe('Écran 11 — « Pour 100 000 hab. » et comparatif IRSAM', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('Mesure « Pour 100 000 hab. » (§3)', () => {
    it('est désactivée, avec une explication, tant qu’aucune population n’est saisie', async () => {
      mockStats({ populations: [] });
      renderWithProviders(<StatsPage />);

      await waitFor(() => expect(screen.getByTitle(/16 — Alger : 120/)).toBeInTheDocument());
      await waitFor(() => expect(screen.getByText(/Aucune population de référence saisie/)).toBeInTheDocument());
      expect(screen.getByRole('tab', { name: 'Pour 100 000 hab.' })).toBeDisabled();
    });

    it('exige une année étudiée, puis passe `year` à l’API et active la mesure', async () => {
      const { wilayaCalls } = mockStats({ populations: [POPULATION] });
      renderWithProviders(<StatsPage />);
      const user = userEvent.setup();

      await waitFor(() => expect(screen.getByText(/Choisissez une année étudiée/)).toBeInTheDocument());
      expect(screen.getByRole('tab', { name: 'Pour 100 000 hab.' })).toBeDisabled();

      await user.selectOptions(screen.getByLabelText('Année étudiée'), String(YEAR));
      await waitFor(() => expect(wilayaCalls).toContain(String(YEAR)));
      await waitFor(() => expect(screen.getByRole('tab', { name: 'Pour 100 000 hab.' })).toBeEnabled());
      expect(screen.queryByText(/Choisissez une année étudiée/)).not.toBeInTheDocument();
    });

    it('hachure « n.d. » les wilayas sans population (hors échelle), légende n/total et infobulle source + année', async () => {
      mockStats({ populations: [POPULATION] });
      renderWithProviders(<StatsPage />);
      const user = userEvent.setup();

      await user.selectOptions(await screen.findByLabelText('Année étudiée'), String(YEAR));
      await waitFor(() => expect(screen.getByRole('tab', { name: 'Pour 100 000 hab.' })).toBeEnabled());
      await user.click(screen.getByRole('tab', { name: 'Pour 100 000 hab.' }));

      const alger = await screen.findByTitle(/16 — Alger : 1\.83/);
      expect(alger.getAttribute('title')).toMatch(/Estimation ONS 2024, ONS 2024/);
      expect(alger).not.toHaveAttribute('data-unavailable');

      const oran = screen.getByTitle(/31 — Oran : n\.d\. — sans population de référence/);
      expect(oran).toHaveAttribute('data-unavailable', 'true');
      expect(oran).toHaveTextContent('n.d.');
      // Aucune couleur en dur : la hachure n'utilise que des tokens.
      expect(oran.getAttribute('style')).toMatch(/var\(--rule-strong\)/);
      expect(oran.getAttribute('style')).not.toMatch(/#[0-9a-f]{3,6}|rgb\(/i);

      expect(screen.getByText('1/2 sans population de référence')).toBeInTheDocument();
    });

    it('revient à « Déclarations » si l’année est remise à « Toutes les années »', async () => {
      mockStats({ populations: [POPULATION] });
      renderWithProviders(<StatsPage />);
      const user = userEvent.setup();

      await user.selectOptions(await screen.findByLabelText('Année étudiée'), String(YEAR));
      await waitFor(() => expect(screen.getByRole('tab', { name: 'Pour 100 000 hab.' })).toBeEnabled());
      await user.click(screen.getByRole('tab', { name: 'Pour 100 000 hab.' }));
      await screen.findByTitle(/16 — Alger : 1\.83/);

      await user.selectOptions(screen.getByLabelText('Année étudiée'), '');
      await waitFor(() => expect(screen.getByTitle(/16 — Alger : 120/)).toBeInTheDocument());
      expect(screen.getByRole('tab', { name: 'Déclarations' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.queryByText(/sans population de référence$/)).not.toBeInTheDocument();
    });
  });

  describe('KPI délai moyen — comparatif IRSAM (§4)', () => {
    it('« Référence IRSAM non renseignée » sans référence saisie', async () => {
      mockStats({ summary: { ...SUMMARY, irsam: null, irsamStatus: 'NON_RENSEIGNE' } });
      renderWithProviders(<StatsPage />);

      expect(await screen.findByText('Référence IRSAM non renseignée')).toBeInTheDocument();
      expect(screen.queryByText(/vs IRSAM/)).not.toBeInTheDocument();
      expect(screen.queryByText(/74 j/)).not.toBeInTheDocument();
    });

    it('« en attente de validation UAR » quand la référence est saisie mais pas validée', async () => {
      mockStats({ summary: { ...SUMMARY, irsam: null, irsamStatus: 'EN_ATTENTE_VALIDATION' } });
      renderWithProviders(<StatsPage />);

      expect(await screen.findByText('Référence IRSAM en attente de validation UAR')).toBeInTheDocument();
      expect(screen.queryByText(/vs IRSAM/)).not.toBeInTheDocument();
      expect(screen.queryByText(/74 j/)).not.toBeInTheDocument();
    });

    it('affiche « vs IRSAM : Y j » (période, source) et l’écart quand la référence est validée', async () => {
      mockStats({
        summary: {
          ...SUMMARY,
          irsamStatus: 'VALIDE',
          irsam: {
            value: 30,
            periodFrom: '2025-01-01',
            periodTo: '2025-12-31',
            sourceRef: 'E-Recours 2025',
            measureDefinition: { startEvent: 'Envoi Annexe 2', endEvent: 'Règlement', scope: 'Recours matériels' },
            deltaDays: -5.5,
          },
        },
      });
      renderWithProviders(<StatsPage />);

      const extra = await screen.findByText(/vs IRSAM : 30 j/);
      expect(extra).toHaveTextContent('E-Recours 2025');
      expect(extra).toHaveTextContent('2025');
      expect(extra).toHaveTextContent('écart -5.5 j');
      expect(screen.queryByText(/74 j/)).not.toBeInTheDocument();
    });

    it('n’affiche pas d’écart quand aucun recours n’est encore réglé (deltaDays null)', async () => {
      mockStats({
        summary: {
          ...SUMMARY,
          avgSettlementDays: null,
          irsamStatus: 'VALIDE',
          irsam: { value: 30, periodFrom: '2025-01-01', periodTo: '2025-12-31', sourceRef: 'E-Recours 2025', measureDefinition: { startEvent: 'a', endEvent: 'b', scope: 'c' }, deltaDays: null },
        },
      });
      renderWithProviders(<StatsPage />);

      const extra = await screen.findByText(/vs IRSAM : 30 j/);
      expect(extra).not.toHaveTextContent('écart');
    });
  });
});
