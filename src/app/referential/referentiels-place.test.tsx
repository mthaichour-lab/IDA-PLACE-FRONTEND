import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DICTIONARIES } from '@/i18n/translations';
import {
  ConstatCircumstance,
  EligibilityMotif,
  IrsamBenchmark,
  MeResponse,
  MobileHoliday,
  OppositionMotif,
  PlaceCalendar,
  PopulationImportReport,
  WilayaPopulation,
} from '@/lib/types';
import { FetchRequest, mockFetchRequests, renderWithProviders } from '@/test/render';
import ReferentialPage from './page';

/**
 * Écran 12 — référentiels de place, décisions PO §1 à §4 et arbitrages du
 * Tech Lead : trois blocs « Barème & motifs », fériés mobiles, populations
 * (saisie + import CSV), référence IRSAM. Saisie `params`, validation UAR
 * `validateRef`, 409 « quatre yeux » affiché tel que renvoyé par le backend.
 */

const YEAR = new Date().getUTCFullYear();

const ME_READER: MeResponse = { user: { id: 'u-audit', name: 'Auditeur', email: 'a@csa.dz' }, role: 'AUDITEUR_CSA', privileges: [] };
const ME_OPERATOR: MeResponse = { user: { id: 'u-op', name: 'Opérateur', email: 'op@uar.dz' }, role: 'OPERATEUR_PLACE', privileges: ['refedit', 'params'] };
const ME_ADMIN_UAR: MeResponse = { user: { id: 'u-admin', name: 'Admin UAR', email: 'admin@uar.dz' }, role: 'ADMIN_UAR', privileges: ['refedit', 'params', 'validateRef'] };

const ELIGIBILITY: EligibilityMotif[] = Array.from({ length: 11 }, (_, i) => ({ article: `Art. ${i + 3}`, label: `Motif moteur ${i + 1}` }));

const CIRCUMSTANCES: ConstatCircumstance[] = Array.from({ length: 17 }, (_, i) => ({
  number: i + 1,
  labelFr: `circonstance ${i + 1}`,
  status: i === 0 ? 'VALIDE_UAR' : 'STANDARD_A_CONFIRMER',
  createdBy: 'system:seed',
}));

const NON_DECLARATION: OppositionMotif = {
  code: 'NON_DECLARATION',
  label: 'Non-déclaration du sinistre',
  forbidden: true,
  sourceRef: 'Guide pédagogique UAR, diapo 10 (Art. 10)',
  status: 'SAISI',
  createdBy: 'system:seed',
  createdAt: '2026-10-18T00:00:00.000Z',
};

const CALENDAR: PlaceCalendar = {
  weekendDays: ['FRIDAY', 'SATURDAY'],
  fixedHolidays: [],
  holidays: [{ date: `${YEAR}-01-12`, label: 'Yennayer', type: 'FIXE', status: 'LEGAL' }],
};

function mobileHoliday(overrides: Partial<MobileHoliday> = {}): MobileHoliday {
  return {
    id: 'mh-1',
    date: `${YEAR}-03-20`,
    kind: 'AID_EL_FITR',
    label: 'Aïd el-Fitr',
    status: 'PREVISIONNEL',
    createdBy: 'u-op',
    createdAt: `${YEAR}-01-05T09:00:00.000Z`,
    ...overrides,
  };
}

const IRSAM_SAISI: IrsamBenchmark = {
  id: 'ir-1',
  indicator: 'DELAI_MOYEN_REGLEMENT_RECOURS_JOURS',
  value: 41,
  periodFrom: '2025-01-01',
  periodTo: '2025-12-31',
  measureDefinition: { startEvent: 'Envoi de la demande de recours', endEvent: 'Règlement inter-compagnies', scope: 'Recours matériels E-Recours' },
  sourceRef: 'Rapport E-Recours 2025',
  status: 'SAISI',
  createdBy: 'u-op',
  createdAt: '2026-10-18T10:00:00.000Z',
};

interface ApiState {
  me: MeResponse;
  mobileHolidays?: MobileHoliday[];
  oppositionMotifs?: OppositionMotif[];
  populations?: WilayaPopulation[];
  irsam?: IrsamBenchmark[];
  importReport?: PopulationImportReport;
  /** Réponse forcée pour une écriture donnée (`METHOD pathname`). */
  writeResponses?: Record<string, { status: number; body: unknown }>;
}

function mockReferentialApi(state: ApiState) {
  const writes: FetchRequest[] = [];
  const fetchMock = mockFetchRequests((req) => {
    if (req.method !== 'GET') {
      writes.push(req);
      const forced = state.writeResponses?.[`${req.method} ${req.pathname}`];
      if (forced) return forced;
      if (req.pathname === '/api/v1/referential/wilaya-populations/import') return { body: state.importReport };
      return { body: { ok: true } };
    }
    switch (req.pathname) {
      case '/api/v1/me':
        return { body: state.me };
      case '/api/v1/referential/companies':
        return { body: { page: 1, total: 0, items: [] } };
      case '/api/v1/referential/agencies':
      case '/api/v1/referential/experts':
        return { body: { page: 1, total: 0, items: [] } };
      case '/api/v1/referential/convention':
        return { body: { version: 'v1', silenceDays: 10, oppositionDays: 15, forclusionMonths: 6, maxAmountDA: 500_000 } };
      case '/api/v1/referential/motifs':
        return { body: ELIGIBILITY };
      case '/api/v1/referential/calendar':
        return { body: CALENDAR };
      case '/api/v1/referential/mobile-holidays':
        return { body: state.mobileHolidays ?? [] };
      case '/api/v1/referential/mobile-holiday-kinds':
        return {
          body: [
            { kind: 'AID_EL_FITR', label: 'Aïd el-Fitr' },
            { kind: 'AID_EL_ADHA', label: 'Aïd el-Adha' },
          ],
        };
      case '/api/v1/referential/constat-circumstances':
        return { body: CIRCUMSTANCES };
      case '/api/v1/referential/opposition-motifs':
        return { body: state.oppositionMotifs ?? [NON_DECLARATION] };
      case '/api/v1/referential/wilaya-populations':
        return { body: state.populations ?? [] };
      case '/api/v1/referential/wilayas':
        return { body: [{ code: '16', name: 'Alger' }] };
      case '/api/v1/referential/irsam-benchmarks':
        return { body: state.irsam ?? [] };
      default:
        return undefined;
    }
  });
  return { fetchMock, writes };
}

async function openSection(title: string) {
  renderWithProviders(<ReferentialPage />);
  const nav = await screen.findByRole('navigation', { name: /référentiel de place/i });
  const user = userEvent.setup();
  await user.click(within(nav).getByText(title));
  return user;
}

describe('Écran 12 — référentiels de place (décisions PO §1 à §4)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('Barème & motifs (§1)', () => {
    it('affiche les trois blocs avec leurs badges et n’affiche jamais « RG-01 »', async () => {
      mockReferentialApi({ me: ME_READER });
      await openSection('Barème & motifs');

      expect(await screen.findByText("Motifs d'inéligibilité appliqués par le moteur (11)")).toBeInTheDocument();
      expect(await screen.findByText('Circonstances du constat amiable (17 cases)')).toBeInTheDocument();
      expect(screen.getByText("Motifs d'opposition")).toBeInTheDocument();

      // Badge « à confirmer » tant que la circonstance n'est pas VALIDE_UAR (5 non validées sur la 1re page de 6).
      const circumstances = screen.getByRole('region', { name: 'Circonstances du constat amiable' });
      expect(within(circumstances).getAllByText('Libellé standard — à confirmer UAR')).toHaveLength(5);
      expect(within(circumstances).getByText('Validé UAR')).toBeInTheDocument();

      const opposition = screen.getByRole('region', { name: "Motifs d'opposition" });
      expect(await within(opposition).findByText('Non-déclaration du sinistre')).toBeInTheDocument();
      expect(within(opposition).getByText('Interdit — Art. 10')).toBeInTheDocument();

      expect(document.body.textContent).not.toMatch(/RG-01/);
      for (const dictionary of Object.values(DICTIONARIES)) {
        expect(Object.values(dictionary).some((v) => v.includes('RG-01'))).toBe(false);
      }
    });

    it('lecture seule sans privilège : ni saisie ni validation', async () => {
      mockReferentialApi({ me: ME_READER });
      await openSection('Barème & motifs');

      await screen.findByText('circonstance 2');
      expect(screen.queryByRole('button', { name: 'Modifier' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Valider (UAR)' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: "Ajouter un motif d'opposition" })).not.toBeInTheDocument();
    });

    it('privilège params seul : saisie visible, validation UAR masquée', async () => {
      mockReferentialApi({ me: ME_OPERATOR });
      await openSection('Barème & motifs');

      await screen.findByText('circonstance 2');
      expect(screen.getAllByRole('button', { name: 'Modifier' }).length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: "Ajouter un motif d'opposition" })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Valider (UAR)' })).not.toBeInTheDocument();
    });

    it('validateRef : bouton de validation, et le 409 « quatre yeux » s’affiche en toast avec le message du backend', async () => {
      const fourEyes = 'Règle des quatre yeux : la validation doit être faite par une autre personne que l’auteur de la saisie.';
      const { writes } = mockReferentialApi({
        me: ME_ADMIN_UAR,
        writeResponses: { 'POST /api/v1/referential/constat-circumstances/2/validate': { status: 409, body: { code: 'FOUR_EYES', message: fourEyes } } },
      });
      const user = await openSection('Barème & motifs');

      const row = (await screen.findByText('circonstance 2')).closest('tr')!;
      // La circonstance 1, déjà validée, n'a pas de bouton de validation.
      expect(within(screen.getByText('circonstance 1').closest('tr')!).queryByRole('button', { name: 'Valider (UAR)' })).not.toBeInTheDocument();
      await user.click(within(row).getByRole('button', { name: 'Valider (UAR)' }));

      expect(await screen.findByText(fourEyes)).toBeInTheDocument();
      expect(writes.map((w) => `${w.method} ${w.pathname}`)).toEqual(['POST /api/v1/referential/constat-circumstances/2/validate']);
    });

    it('ajoute un motif d’opposition (params) avec son code, son libellé et le drapeau interdit', async () => {
      const { writes } = mockReferentialApi({ me: ME_OPERATOR });
      const user = await openSection('Barème & motifs');

      await user.click(await screen.findByRole('button', { name: "Ajouter un motif d'opposition" }));
      const dialog = screen.getByRole('dialog');
      await user.type(within(dialog).getByLabelText('Code (majuscules, chiffres et _)'), 'montant_conteste');
      await user.type(within(dialog).getByLabelText('Motif'), 'Montant contesté');
      await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));

      await waitFor(() => expect(writes).toHaveLength(1));
      expect(writes[0]).toMatchObject({ method: 'POST', pathname: '/api/v1/referential/opposition-motifs', body: { code: 'MONTANT_CONTESTE', label: 'Montant contesté', forbidden: false } });
    });
  });

  describe('Calendrier ouvré — fériés mobiles (§2)', () => {
    it('affiche la bannière quand aucun férié mobile n’est saisi pour l’année affichée', async () => {
      mockReferentialApi({ me: ME_READER, mobileHolidays: [] });
      await openSection('Calendrier ouvré');

      expect(await screen.findByText(`Fériés mobiles ${YEAR} non saisis — délais en jours ouvrés provisoires`)).toBeInTheDocument();
      expect(screen.getByText('Yennayer')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Saisir un férié mobile' })).not.toBeInTheDocument();
    });

    it('affiche les badges « Prévisionnel » et « Confirmé · réf. », sans bannière', async () => {
      mockReferentialApi({
        me: ME_READER,
        mobileHolidays: [
          mobileHoliday(),
          mobileHoliday({ id: 'mh-2', date: `${YEAR}-05-27`, kind: 'AID_EL_ADHA', label: 'Aïd el-Adha', status: 'CONFIRME', sourceRef: 'Communiqué MAR n° 12' }),
        ],
      });
      await openSection('Calendrier ouvré');

      expect(await screen.findByText('Prévisionnel')).toBeInTheDocument();
      expect(screen.getByText(/Confirmé · réf\. Communiqué MAR n° 12/)).toBeInTheDocument();
      // Date AAAA-MM-JJ affichée en UTC (jamais la veille).
      expect(screen.getByText(`20 mars ${YEAR}`)).toBeInTheDocument();
      expect(screen.queryByText(/non saisis — délais en jours ouvrés provisoires/)).not.toBeInTheDocument();
    });

    it('saisit un férié mobile prévisionnel (params)', async () => {
      const { writes } = mockReferentialApi({ me: ME_OPERATOR });
      const user = await openSection('Calendrier ouvré');

      await user.click(await screen.findByRole('button', { name: 'Saisir un férié mobile' }));
      const dialog = screen.getByRole('dialog');
      await user.type(within(dialog).getByLabelText('Date'), `${YEAR}-06-16`);
      await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Aïd el-Adha' })).toBeInTheDocument());
      await user.selectOptions(within(dialog).getByLabelText('Fête'), 'AID_EL_ADHA');
      await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));

      await waitFor(() => expect(writes).toHaveLength(1));
      expect(writes[0]).toMatchObject({ method: 'POST', pathname: '/api/v1/referential/mobile-holidays', body: { date: `${YEAR}-06-16`, kind: 'AID_EL_ADHA' } });
    });

    it('la confirmation exige la référence du communiqué ou du décret', async () => {
      const { writes } = mockReferentialApi({ me: ME_OPERATOR, mobileHolidays: [mobileHoliday()] });
      const user = await openSection('Calendrier ouvré');

      const row = (await screen.findByText('Aïd el-Fitr')).closest('tr')!;
      await user.click(within(row).getByRole('button', { name: 'Confirmer' }));
      const dialog = screen.getByRole('dialog');
      const submit = within(dialog).getByRole('button', { name: 'Confirmer' });
      expect(submit).toBeDisabled();

      await user.type(within(dialog).getByLabelText('Référence du communiqué ou du décret (obligatoire)'), 'Décret 26-101');
      expect(submit).toBeEnabled();
      await user.click(submit);

      await waitFor(() => expect(writes).toHaveLength(1));
      expect(writes[0]).toMatchObject({ method: 'POST', pathname: '/api/v1/referential/mobile-holidays/mh-1/confirm', body: { sourceRef: 'Décret 26-101' } });
    });

    it('modifie puis supprime un férié prévisionnel ; un férié confirmé n’a plus d’action', async () => {
      const { writes } = mockReferentialApi({
        me: ME_OPERATOR,
        mobileHolidays: [mobileHoliday(), mobileHoliday({ id: 'mh-2', date: `${YEAR}-05-27`, kind: 'AID_EL_ADHA', label: 'Aïd el-Adha', status: 'CONFIRME', sourceRef: 'Réf. 9' })],
      });
      const user = await openSection('Calendrier ouvré');

      const confirmedRow = (await screen.findByText('Aïd el-Adha')).closest('tr')!;
      expect(within(confirmedRow).queryByRole('button')).not.toBeInTheDocument();

      const row = screen.getByText('Aïd el-Fitr').closest('tr')!;
      await user.click(within(row).getByRole('button', { name: 'Modifier' }));
      let dialog = screen.getByRole('dialog');
      await user.clear(within(dialog).getByLabelText('Date'));
      await user.type(within(dialog).getByLabelText('Date'), `${YEAR}-03-21`);
      await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
      await waitFor(() => expect(writes).toHaveLength(1));
      expect(writes[0]).toMatchObject({ method: 'PUT', pathname: '/api/v1/referential/mobile-holidays/mh-1', body: { date: `${YEAR}-03-21`, kind: 'AID_EL_FITR' } });

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await user.click(within(screen.getByText('Aïd el-Fitr').closest('tr')!).getByRole('button', { name: 'Supprimer' }));
      dialog = screen.getByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Supprimer' }));
      await waitFor(() => expect(writes).toHaveLength(2));
      expect(writes[1]).toMatchObject({ method: 'DELETE', pathname: '/api/v1/referential/mobile-holidays/mh-1' });
    });
  });

  describe('Populations de référence (§3)', () => {
    it('état vide explicite, et aucune saisie sans privilège params', async () => {
      mockReferentialApi({ me: ME_READER, populations: [] });
      await openSection('Populations de référence');

      expect(await screen.findByText(/Aucune population de référence saisie/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Saisir une population' })).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Fichier CSV')).not.toBeInTheDocument();
    });

    it('liste les populations avec leur validité au regard du périmètre', async () => {
      mockReferentialApi({
        me: ME_READER,
        populations: [
          { id: 'p1', wilayaCode: '16', referenceYear: 2008, population: 2_988_145, sourceType: 'RECENSEMENT_RGPH', sourceRef: 'RGPH 2008', createdBy: 'u-op', createdAt: '2026-10-18T00:00:00.000Z', valid: true },
          {
            id: 'p2',
            wilayaCode: '59',
            referenceYear: 2008,
            population: 120_000,
            sourceType: 'AUTRE',
            sourceRef: 'Estimation interne',
            createdBy: 'u-op',
            createdAt: '2026-10-18T00:00:00.000Z',
            valid: false,
            invalidReason: 'Année antérieure au périmètre actuel de la wilaya 59',
          },
        ],
      });
      await openSection('Populations de référence');

      expect(await screen.findByText('RGPH 2008')).toBeInTheDocument();
      expect(screen.getByText('Recensement (RGPH)')).toBeInTheDocument();
      expect(screen.getByText('Valide')).toBeInTheDocument();
      expect(screen.getByText('Invalide — Année antérieure au périmètre actuel de la wilaya 59')).toBeInTheDocument();
    });

    it('saisit une population avec sa source (params)', async () => {
      const { writes } = mockReferentialApi({ me: ME_OPERATOR });
      const user = await openSection('Populations de référence');

      await user.click(await screen.findByRole('button', { name: 'Saisir une population' }));
      const dialog = screen.getByRole('dialog');
      await waitFor(() => expect(within(dialog).getByRole('option', { name: '16 — Alger' })).toBeInTheDocument());
      await user.selectOptions(within(dialog).getByLabelText('Wilaya'), '16');
      await user.type(within(dialog).getByLabelText('Année de référence'), '2008');
      await user.type(within(dialog).getByLabelText('Population'), '2988145');
      await user.selectOptions(within(dialog).getByLabelText('Type de source'), 'ESTIMATION_ONS');
      const save = within(dialog).getByRole('button', { name: 'Enregistrer' });
      expect(save).toBeDisabled(); // source obligatoire
      await user.type(within(dialog).getByLabelText('Référence de la source'), 'ONS 2008');
      await user.click(save);

      await waitFor(() => expect(writes).toHaveLength(1));
      expect(writes[0]).toMatchObject({
        method: 'POST',
        pathname: '/api/v1/referential/wilaya-populations',
        body: { wilayaCode: '16', referenceYear: 2008, population: 2_988_145, sourceType: 'ESTIMATION_ONS', sourceRef: 'ONS 2008' },
      });
    });

    it('import CSV : affiche le rapport ligne par ligne et signale qu’aucune ligne n’est écrite (tout ou rien)', async () => {
      const { writes } = mockReferentialApi({
        me: ME_OPERATOR,
        importReport: {
          fileName: 'populations.csv',
          totalRows: 2,
          acceptedCount: 1,
          rejectedCount: 1,
          written: false,
          writtenCount: 0,
          rows: [
            { line: 2, status: 'ACCEPTEE', wilayaCode: '16', referenceYear: 2008, population: 2_988_145 },
            { line: 3, status: 'REJETEE', reason: 'Wilaya "99" introuvable.', wilayaCode: '99', referenceYear: 2008 },
          ],
        },
      });
      const user = await openSection('Populations de référence');

      const file = new File(['code;annee;population;source_type;source_ref\n16;2008;2988145;RECENSEMENT_RGPH;RGPH'], 'populations.csv', { type: 'text/csv' });
      await user.upload(await screen.findByLabelText('Fichier CSV'), file);
      await user.click(screen.getByRole('button', { name: 'Importer' }));

      await waitFor(() => expect(writes).toHaveLength(1));
      expect(writes[0]).toMatchObject({ method: 'POST', pathname: '/api/v1/referential/wilaya-populations/import' });
      const report = await screen.findByRole('region', { name: "Rapport d'import" });
      expect(within(report).getByText(/1 acceptée\(s\), 1 rejetée\(s\) sur 2/)).toBeInTheDocument();
      expect(within(report).getAllByText(/Aucune ligne écrite \(import tout ou rien\)/).length).toBeGreaterThan(0);
      expect(within(report).getByText('Wilaya "99" introuvable.')).toBeInTheDocument();
      expect(within(report).getByText('Rejetée')).toBeInTheDocument();
      expect(within(report).getByText('Acceptée')).toBeInTheDocument();
    });
  });

  describe('Référence IRSAM (§4)', () => {
    it('état vide explicite', async () => {
      mockReferentialApi({ me: ME_READER, irsam: [] });
      await openSection('Référence IRSAM');

      expect(await screen.findByText(/Aucune référence IRSAM saisie/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Saisir une référence IRSAM' })).not.toBeInTheDocument();
    });

    it('params : saisie avec sa définition de mesure, sans bouton de validation', async () => {
      const { writes } = mockReferentialApi({ me: ME_OPERATOR, irsam: [IRSAM_SAISI] });
      const user = await openSection('Référence IRSAM');

      expect(await screen.findByText('Saisi — en attente de validation UAR')).toBeInTheDocument();
      expect(screen.getByText(/Envoi de la demande de recours → Règlement inter-compagnies/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Valider (UAR)' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Archiver' })).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Saisir une référence IRSAM' }));
      const dialog = screen.getByRole('dialog');
      await user.type(within(dialog).getByLabelText('Valeur (jours)'), '38');
      await user.type(within(dialog).getByLabelText('Début de période'), '2025-01-01');
      await user.type(within(dialog).getByLabelText('Fin de période'), '2025-12-31');
      await user.type(within(dialog).getByLabelText('Événement de départ'), 'Envoi Annexe 2');
      await user.type(within(dialog).getByLabelText("Événement d'arrivée"), 'Règlement');
      const save = within(dialog).getByRole('button', { name: 'Enregistrer' });
      expect(save).toBeDisabled(); // périmètre et source obligatoires
      await user.type(within(dialog).getByLabelText('Périmètre'), 'Recours matériels');
      await user.type(within(dialog).getByLabelText('Référence de la source'), 'E-Recours 2025');
      await user.click(save);

      await waitFor(() => expect(writes).toHaveLength(1));
      expect(writes[0]).toMatchObject({
        method: 'POST',
        pathname: '/api/v1/referential/irsam-benchmarks',
        body: {
          indicator: 'DELAI_MOYEN_REGLEMENT_RECOURS_JOURS',
          value: 38,
          periodFrom: '2025-01-01',
          periodTo: '2025-12-31',
          measureDefinition: { startEvent: 'Envoi Annexe 2', endEvent: 'Règlement', scope: 'Recours matériels' },
          sourceRef: 'E-Recours 2025',
        },
      });
    });

    it('validateRef : valide puis archive ; le 409 « quatre yeux » s’affiche en toast', async () => {
      const { writes } = mockReferentialApi({
        me: ME_ADMIN_UAR,
        irsam: [IRSAM_SAISI, { ...IRSAM_SAISI, id: 'ir-0', status: 'ARCHIVE', value: 50 }],
        writeResponses: { 'POST /api/v1/referential/irsam-benchmarks/ir-1/validate': { status: 409, body: { code: 'FOUR_EYES', message: 'Règle des quatre yeux (IRSAM).' } } },
      });
      const user = await openSection('Référence IRSAM');

      const row = (await screen.findByText('41 jours')).closest('tr')!;
      const archivedRow = screen.getByText('50 jours').closest('tr')!;
      expect(within(archivedRow).queryByRole('button')).not.toBeInTheDocument();

      await user.click(within(row).getByRole('button', { name: 'Valider (UAR)' }));
      expect(await screen.findByText('Règle des quatre yeux (IRSAM).')).toBeInTheDocument();

      await user.click(within(row).getByRole('button', { name: 'Archiver' }));
      await waitFor(() => expect(writes).toHaveLength(2));
      expect(writes.map((w) => `${w.method} ${w.pathname}`)).toEqual([
        'POST /api/v1/referential/irsam-benchmarks/ir-1/validate',
        'POST /api/v1/referential/irsam-benchmarks/ir-1/archive',
      ]);
    });
  });
});
