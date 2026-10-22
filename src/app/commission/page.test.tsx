import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { FetchRequest, mockFetchRequests, mockFetchRouter, renderWithProviders } from '@/test/render';
import { CommissionCase, CommissionPenaltyResult, CommissionSummary, CompanyView, MeResponse, MembershipRequest, Sanction } from '@/lib/types';
import CommissionPage from './page';

/**
 * Depuis le passage à un panneau de détail PERSISTANT (plus de `Modal`,
 * fidélité à la capture écran 7 : rôle des affaires à gauche + détail à
 * droite, détail toujours rempli par défaut — voir l'effet d'auto-sélection
 * dans `page.tsx`), le n° de recours et son état apparaissent à la fois
 * dans le registre ET dans l'en-tête du panneau de détail : les assertions
 * qui portaient sur le registre seul sont donc scopées à la table
 * (`within(table())`), sinon `getByText` échoue en trouvant deux
 * correspondances légitimes.
 */
function table(): HTMLElement {
  return screen.getByRole('table');
}

const ME_WITH_BOTH: MeResponse = {
  user: { id: 'dev-commission', name: 'Membre Commission (dev)', email: 'commission@uar.dz' },
  role: 'MEMBRE_COMMISSION',
  privileges: ['penaltyOrder', 'pvSign'],
};

const ME_WITHOUT_PENALTY: MeResponse = {
  user: { id: 'dev-auditeur', name: 'Auditeur CSA (dev)', email: 'auditeur@csa.dz' },
  role: 'AUDITEUR_CSA',
  privileges: [],
};

function commissionCase(overrides: Partial<CommissionCase> = {}): CommissionCase {
  return {
    id: 'cc-1',
    reference: 'CSC-2026-011',
    recoursId: 'r-1',
    claimId: 'c-1',
    companyA: 'CAAT',
    companyB: 'SAA',
    amount: 300_000,
    motif: 'Désaccord sur la responsabilité',
    status: 'EN_DELIBERE',
    scheduledAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const SUMMARY: CommissionSummary = {
  pendingCount: 5,
  overdue15dCount: 2,
  recoursFondesCount: 2,
  oppositionsFondeesCount: 2,
};

function sanction(overrides: Partial<Sanction> = {}): Sanction {
  return {
    id: 'san-1',
    commissionCaseId: 'cc-1',
    companyCode: 'CAAT',
    type: 'AVERTISSEMENT',
    amount: undefined,
    reason: 'Retard de saisie',
    orderedAt: new Date().toISOString(),
    orderedBy: 'Membre Commission (dev)',
    status: 'PRONONCEE',
    ...overrides,
  };
}

function mockCommissionApi(
  me: MeResponse,
  cases: CommissionCase[],
  onPenalty?: (id: string) => CommissionPenaltyResult,
  sanctions: Sanction[] = [],
) {
  mockFetchRouter((pathname) => {
    if (pathname === '/api/v1/me') return me;
    if (pathname === '/api/v1/commission/summary') return SUMMARY;
    if (pathname === '/api/v1/commission/cases') return { page: 1, total: cases.length, items: cases };
    if (pathname === '/api/v1/commission/sanctions') return { page: 1, total: sanctions.length, items: sanctions };
    const penaltyMatch = /^\/api\/v1\/commission\/cases\/(.+)\/penalty$/.exec(pathname);
    if (penaltyMatch && onPenalty) return onPenalty(penaltyMatch[1]);
    const pvMatch = /^\/api\/v1\/commission\/cases\/(.+)\/pv-sign$/.exec(pathname);
    if (pvMatch) return { ...cases.find((c) => c.id === pvMatch[1])!, pv: { signedBy: 'dev-commission', signedAt: new Date().toISOString(), ref: 'PV-2026-1' } };
    // AttachmentsPanel (QUESTIONS_UAR.md §9) — aucune pièce jointe dans ces tests, pas le sujet ici.
    if (pathname === '/api/v1/documents') return [];
    return undefined;
  });
}

/**
 * Écran Commission (/commission, écran 7, Module E §6.7) — prononcé de
 * pénalité (privilège `penaltyOrder`) et signature du PV (privilège
 * `pvSign`), tous deux refusables indépendamment (B.7).
 */
describe('Écran Commission (/commission)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('affiche la référence CSC du dossier et la référence REC du recours, l’UUID restant en infobulle', async () => {
    mockCommissionApi(ME_WITH_BOTH, [commissionCase({ id: '0b5f7c2e-1111-4111-8111-000000000011', recoursReference: 'REC-2026-00296' })]);
    renderWithProviders(<CommissionPage />);

    await waitFor(() => expect(within(table()).getByText('REC-2026-00296')).toBeInTheDocument());
    expect(within(table()).getByText('REC-2026-00296')).toHaveAttribute('title', 'r-1');
    expect(within(table()).getByText('CSC-2026-011')).toHaveAttribute('title', '0b5f7c2e-1111-4111-8111-000000000011');
    expect(within(table()).queryByText('0b5f7c2e')).not.toBeInTheDocument();
  });

  it('affiche la file des dossiers en commission avec leur phase (libellé relabellisé, A.4/guide)', async () => {
    mockCommissionApi(ME_WITH_BOTH, [commissionCase()]);
    renderWithProviders(<CommissionPage />);

    await waitFor(() => expect(within(table()).getByText('r-1')).toBeInTheDocument());
    // EN_DELIBERE -> "Audience" (relabellisage d'affichage, voir HANDOFF.md ;
    // la valeur `status` et la logique métier restent inchangées). Le même
    // badge d'état apparaît aussi dans l'en-tête du panneau de détail
    // (auto-sélectionné) — scopé à la table pour une correspondance unique.
    expect(within(table()).getByText('Audience')).toBeInTheDocument();
  });

  /**
   * Colonne « Conciliation (15 j) » (maquette) : délai de l'Art. 24 compté
   * depuis la saisine réelle (`createdAt`), même constante que le back
   * (`overdue15dCount`) — simple calcul d'affichage ; une affaire tranchée
   * affiche sa date de décision réelle (`decidedAt`).
   */
  it('affiche le délai de conciliation de 15 jours (restant, dépassé) et la date de décision réelle', async () => {
    const day = 86_400_000;
    mockCommissionApi(ME_WITH_BOTH, [
      commissionCase({ id: 'cc-1', recoursId: 'r-1', createdAt: new Date(Date.now() - 2 * day - 3_600_000).toISOString() }),
      commissionCase({ id: 'cc-2', recoursId: 'r-2', createdAt: new Date(Date.now() - 20 * day).toISOString() }),
      commissionCase({ id: 'cc-3', recoursId: 'r-3', status: 'PRONONCE', createdAt: '2026-09-01T09:00:00.000Z', decidedAt: '2026-09-15T09:00:00.000Z' }),
    ]);
    renderWithProviders(<CommissionPage />);

    await waitFor(() => expect(within(table()).getByText('r-1')).toBeInTheDocument());
    expect(within(table()).getByText('J-13 · 13 jours restant(s)')).toBeInTheDocument();
    expect(within(table()).getByText('dépassé de 5 jours')).toBeInTheDocument();
    expect(within(table()).getByText(/Décidé le .* \(14 j\)/)).toBeInTheDocument();
  });

  it("refuse le prononcé d'une pénalité et la signature du PV pour AUDITEUR_CSA (lecture seule, B.7)", async () => {
    mockCommissionApi(ME_WITHOUT_PENALTY, [commissionCase()]);
    renderWithProviders(<CommissionPage />);

    await waitFor(() => expect(within(table()).getByText('r-1')).toBeInTheDocument());
    fireEvent.click(within(table()).getByText('r-1').closest('tr')!);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Prononcer' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Signer le PV' })).toBeDisabled();
    expect(screen.getByText(/n'avez pas le privilège requis \(penaltyOrder\)/)).toBeInTheDocument();
  });

  it('propose une pénalité (décision prononcée, PV signé) : toast « à contresigner » (SEC-32)', async () => {
    const decided = commissionCase({ status: 'PRONONCE', pv: { signedBy: 'Autre membre', signedAt: new Date().toISOString(), ref: 'PV-cc-1' } });
    mockCommissionApi(ME_WITH_BOTH, [decided], (id) => ({
      id: 'pen-1',
      commissionCaseId: id,
      companyCode: 'CAAT',
      type: 'FINANCIERE',
      amount: 50_000,
      reason: 'Retard',
      orderedAt: new Date().toISOString(),
      orderedBy: 'dev-commission',
      status: 'A_CONTRESIGNER',
    }));
    renderWithProviders(<CommissionPage />);

    await waitFor(() => expect(within(table()).getByText('r-1')).toBeInTheDocument());
    fireEvent.click(within(table()).getByText('r-1').closest('tr')!);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Prononcer' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Montant (DA)'), { target: { value: '50000' } });
    fireEvent.change(document.getElementById('penalty-reason')!, { target: { value: 'Retard' } });
    fireEvent.click(screen.getByRole('button', { name: 'Prononcer' }));

    await waitFor(() => expect(screen.getByText('Pénalité proposée : elle sera prononcée après le contreseing d’un autre membre.')).toBeInTheDocument());
    expect(screen.getByText('Pénalité proposée (à contresigner)')).toBeInTheDocument();
  });

  it('affiche les KPI de synthèse (affaires pendantes, hors délai, recours/oppositions fondés)', async () => {
    mockCommissionApi(ME_WITH_BOTH, [commissionCase()]);
    const { container } = renderWithProviders(<CommissionPage />);
    // Le même total (`pendingCount`) est aussi repris en compteur réel sur
    // l'onglet "Rôle des affaires" (fidélité à la capture) : les KPI sont
    // scopés à leur bandeau (`.kpi-row`) pour une correspondance unique.
    const kpis = () => within(container.querySelector('.kpi-row') as HTMLElement);

    await waitFor(() => expect(kpis().getByText('5')).toBeInTheDocument());
    expect(kpis().getAllByText('2').length).toBeGreaterThan(0);
  });

  /**
   * QUESTIONS_UAR.md §9, décision Product Owner 2026-10-18 — vérifie
   * uniquement que `AttachmentsPanel` est bien monté dans le détail du
   * dossier (pas sa couverture exhaustive, voir `AttachmentsPanel.test.tsx`).
   */
  it('affiche la section « Pièces jointes » dans le détail d’un dossier de commission', async () => {
    mockCommissionApi(ME_WITH_BOTH, [commissionCase()]);
    renderWithProviders(<CommissionPage />);

    await waitFor(() => expect(within(table()).getByText('r-1')).toBeInTheDocument());
    fireEvent.click(within(table()).getByText('r-1').closest('tr')!);

    await waitFor(() => expect(screen.getByText('Pièces jointes (PV de commission)')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Aucune pièce jointe.')).toBeInTheDocument());
  });

  it("affiche le registre des sanctions dans l'onglet dédié (compagnie, motif, date, auteur)", async () => {
    mockCommissionApi(ME_WITH_BOTH, [commissionCase()], undefined, [sanction()]);
    renderWithProviders(<CommissionPage />);

    await waitFor(() => expect(within(table()).getByText('r-1')).toBeInTheDocument());
    // Le bandeau d'onglets affiche désormais un compteur réel (fidélité à la
    // capture, écran 7) — l'intitulé exact n'est donc plus "Sanctions" seul.
    fireEvent.click(screen.getByRole('tab', { name: /Sanctions/ }));

    await waitFor(() => expect(screen.getByText('Retard de saisie')).toBeInTheDocument());
    expect(screen.getByText('Membre Commission (dev)')).toBeInTheDocument();
  });
});

const ME_MEMBERSHIP: MeResponse = {
  user: { id: 'dev-admin', name: 'Admin UAR (dev)', email: 'admin@uar.dz' },
  role: 'ADMIN_UAR',
  privileges: ['membership'],
};

function membershipRequest(overrides: Partial<MembershipRequest> = {}): MembershipRequest {
  return {
    id: 'm-1',
    type: 'ADHESION',
    state: 'RECUE',
    candidateName: 'Assurances Nouvelles SPA',
    receivedAt: '2026-09-01',
    createdBy: 'Admin UAR (dev)',
    createdAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

function withdrawal(overrides: Partial<MembershipRequest> = {}): MembershipRequest {
  return membershipRequest({ type: 'RETRAIT', candidateName: undefined, companyId: CAAT_ID, companyCode: 'CAAT', ...overrides });
}

const CAAT_ID = '3b6f2c1e-0c1a-4a7e-8c01-00000000ca01';
const COMPANY: CompanyView = {
  id: CAAT_ID,
  code: 'CAAT',
  name: 'Compagnie Algérienne des Assurances',
  color: '#000000',
  kind: 'INSURER',
  feedMode: 'API',
  status: 'ACTIF',
  apiKeyMasked: '****',
  createdAt: '2020-01-01T00:00:00.000Z',
} as CompanyView;

function mockMembershipApi(me: MeResponse, rows: MembershipRequest[], onPost?: (req: FetchRequest) => { status?: number; body: unknown } | undefined) {
  return mockFetchRequests((req) => {
    const { method, pathname } = req;
    if (pathname === '/api/v1/me') return { body: me };
    if (pathname === '/api/v1/commission/summary') return { body: SUMMARY };
    if (pathname === '/api/v1/commission/cases') return { body: { page: 1, total: 0, items: [] } };
    if (pathname === '/api/v1/referential/companies') return { body: { page: 1, total: 1, items: [COMPANY] } };
    if (method === 'GET' && pathname === '/api/v1/commission/membership-requests') return { body: { page: 1, total: rows.length, items: rows } };
    if (method === 'POST' && onPost) return onPost(req);
    return undefined;
  });
}

async function openMembershipTab() {
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Adhésions & retraits' })).toBeInTheDocument());
  fireEvent.click(screen.getByRole('tab', { name: 'Adhésions & retraits' }));
}

/**
 * Onglet « Adhésions & retraits » (Chapitre VI, Art. 30-35) — écritures
 * réservées au privilège `membership` ; la date d'effet d'un retrait vient
 * du back, l'UI désactive seulement « constater l'effet » avant cette date.
 */
describe('Écran Commission — onglet « Adhésions & retraits »', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("affiche l'onglet et le tableau des demandes (type, candidat, état)", async () => {
    mockMembershipApi(ME_MEMBERSHIP, [membershipRequest()]);
    renderWithProviders(<CommissionPage />);
    await openMembershipTab();

    await waitFor(() => expect(screen.getByText('Assurances Nouvelles SPA')).toBeInTheDocument());
    expect(screen.getAllByText('Adhésion').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Reçue').length).toBeGreaterThan(0);
  });

  it('masque la création et les actions sans le privilège membership', async () => {
    mockMembershipApi(ME_WITHOUT_PENALTY, [membershipRequest()]);
    renderWithProviders(<CommissionPage />);
    await openMembershipTab();

    await waitFor(() => expect(screen.getByText('Assurances Nouvelles SPA')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Nouvelle demande' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Assurances Nouvelles SPA').closest('tr')!);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Accepter' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rejeter' })).not.toBeInTheDocument();
  });

  it('formulaire : raison sociale pour une ADHESION, sélection de compagnie pour un RETRAIT', async () => {
    const posted: unknown[] = [];
    mockMembershipApi(ME_MEMBERSHIP, [], (req) => {
      if (req.pathname !== '/api/v1/commission/membership-requests') return undefined;
      posted.push(req.body);
      return { status: 201, body: withdrawal({ effectiveDate: '2026-12-31' }) };
    });
    renderWithProviders(<CommissionPage />);
    await openMembershipTab();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Nouvelle demande' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Nouvelle demande' }));
    expect(screen.getByLabelText('Raison sociale de la société candidate')).toBeInTheDocument();
    expect(screen.queryByLabelText('Compagnie adhérente')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Type', { selector: '#membership-form-type' }), { target: { value: 'RETRAIT' } });
    expect(screen.queryByLabelText('Raison sociale de la société candidate')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('option', { name: /CAAT — Compagnie Algérienne/ })).toBeInTheDocument());

    expect(screen.getByRole('button', { name: 'Enregistrer la demande' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Compagnie adhérente'), { target: { value: CAAT_ID } });
    // SEC-47 : la référence du courrier est obligatoire.
    expect(screen.getByRole('button', { name: 'Enregistrer la demande' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Référence du courrier reçu (obligatoire)'), { target: { value: 'UAR/2026/118' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer la demande' }));

    await waitFor(() => expect(screen.getByText('Demande enregistrée.')).toBeInTheDocument());
    expect(posted).toEqual([expect.objectContaining({ type: 'RETRAIT', companyId: CAAT_ID, letterRef: 'UAR/2026/118' })]);
    expect(posted[0]).not.toHaveProperty('candidateName');
  });

  it('SEC-47 : 400 DATE_RECEPTION_TROP_ANCIENNE traduit ; letterRef envoyé pour une ADHESION', async () => {
    const posted: unknown[] = [];
    mockMembershipApi(ME_MEMBERSHIP, [], (req) => {
      posted.push(req.body);
      return { status: 400, body: { code: 'DATE_RECEPTION_TROP_ANCIENNE', message: 'x' } };
    });
    renderWithProviders(<CommissionPage />);
    await openMembershipTab();

    fireEvent.click(await screen.findByRole('button', { name: 'Nouvelle demande' }));
    fireEvent.change(screen.getByLabelText('Raison sociale de la société candidate'), { target: { value: 'Nouvelle Assurance SPA' } });
    expect(screen.getByRole('button', { name: 'Enregistrer la demande' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Référence du courrier reçu (obligatoire)'), { target: { value: 'UAR/2026/120' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer la demande' }));

    expect(await screen.findByText('La date de réception est trop ancienne par rapport à la date d’enregistrement.')).toBeInTheDocument();
    expect(posted).toEqual([expect.objectContaining({ type: 'ADHESION', candidateName: 'Nouvelle Assurance SPA', letterRef: 'UAR/2026/120' })]);
  });

  it("désactive « constater l'effet » avant la date d'effet, avec la raison affichée", async () => {
    mockMembershipApi(ME_MEMBERSHIP, [withdrawal({ effectiveDate: '2099-12-31' })]);
    renderWithProviders(<CommissionPage />);
    await openMembershipTab();

    await waitFor(() => expect(screen.getAllByText('CAAT').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('CAAT')[0].closest('tr')!);

    await waitFor(() => expect(screen.getByRole('button', { name: "Constater l'effet" })).toBeDisabled());
    expect(screen.getByText(/ne peut être constaté qu'après sa date d'effet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annuler le retrait' })).toBeEnabled();
  });

  it("après la date d'effet, « constater l'effet » est actif et un 409 du back s'affiche en toast", async () => {
    mockMembershipApi(ME_MEMBERSHIP, [withdrawal({ receivedAt: '2020-09-01', effectiveDate: '2020-12-31' })], (req) =>
      req.pathname === '/api/v1/commission/membership-requests/m-1/effective'
        ? { status: 409, body: { code: 'INVALID_TRANSITION', message: "Le retrait ne peut être constaté qu'après sa date d'effet (2020-12-31)." } }
        : undefined,
    );
    renderWithProviders(<CommissionPage />);
    await openMembershipTab();

    await waitFor(() => expect(screen.getAllByText('CAAT').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('CAAT')[0].closest('tr')!);

    await waitFor(() => expect(screen.getByRole('button', { name: "Constater l'effet" })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: "Constater l'effet" }));
    await waitFor(() => expect(screen.getByText(/\(2020-12-31\)\./)).toBeInTheDocument());
  });

  it("exige un motif pour rejeter et l'agrément pour accepter une adhésion", async () => {
    mockMembershipApi(ME_MEMBERSHIP, [membershipRequest()]);
    renderWithProviders(<CommissionPage />);
    await openMembershipTab();

    await waitFor(() => expect(screen.getByText('Assurances Nouvelles SPA')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Assurances Nouvelles SPA').closest('tr')!);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Rejeter' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Accepter' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Motif / note'), { target: { value: 'Agrément absent' } });
    expect(screen.getByRole('button', { name: 'Rejeter' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Référence d'agrément (branche automobile)"), { target: { value: 'AGR-2026-01' } });
    expect(screen.getByRole('button', { name: 'Accepter' })).toBeEnabled();
  });
});
