import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExchangeEvent, ExchangeThread } from './ExchangeThread';

/**
 * `ExchangeThread` — composant transverse réutilisé par `/exchanges` et
 * `/commission` (voir commentaire du composant). Ce test ne couvre que le
 * composant lui-même (groupement par jour, alignement, pièces jointes) —
 * pas la construction des évènements (`buildRecoursExchangeEvents`, testée
 * via les écrans appelants).
 */
describe('ExchangeThread', () => {
  it("affiche le libellé vide quand il n'y a aucun évènement", () => {
    render(<ExchangeThread events={[]} locale="fr" emptyLabel="Aucun échange." />);
    expect(screen.getByText('Aucun échange.')).toBeInTheDocument();
  });

  it('affiche le libellé, le texte réel et regroupe par jour', () => {
    const events: ExchangeEvent[] = [
      { key: 'a', at: '2026-09-07T11:41:00.000Z', side: 'right', tone: 'self', companyCode: 'CAAT', label: 'Annexe 2 — Demande d’indemnisation', meta: '251 350 DA' },
      { key: 'b', at: '2026-09-10T12:13:00.000Z', side: 'left', tone: 'party', companyCode: 'CASH', label: 'Annexe 3 — Avis d’opposition motivé', body: 'Montant contesté' },
    ];
    render(<ExchangeThread events={events} locale="fr" emptyLabel="Aucun échange." />);

    expect(screen.getByText('Annexe 2 — Demande d’indemnisation')).toBeInTheDocument();
    expect(screen.getByText('251 350 DA')).toBeInTheDocument();
    expect(screen.getByText('Annexe 3 — Avis d’opposition motivé')).toBeInTheDocument();
    expect(screen.getByText('Montant contesté')).toBeInTheDocument();
    // Un en-tête de jour par date distincte (7 et 10 septembre 2026).
    expect(screen.getByText(/7 sept\. 2026/)).toBeInTheDocument();
    expect(screen.getByText(/10 sept\. 2026/)).toBeInTheDocument();
  });

  it('affiche les pièces jointes avec leur taille formatée', () => {
    const events: ExchangeEvent[] = [
      {
        key: 'doc',
        at: '2026-09-20T09:23:00.000Z',
        side: 'center',
        tone: 'neutral',
        authorLabel: 'Walid Guerfi',
        label: 'Pièce déposée',
        attachments: [{ id: 'd1', filename: 'PV d’expertise MIS-2026-01704.pdf', sizeBytes: 2_500_000 }],
      },
    ];
    render(<ExchangeThread events={events} locale="fr" emptyLabel="Aucun échange." />);

    expect(screen.getByText('Walid Guerfi')).toBeInTheDocument();
    expect(screen.getByText(/PV d’expertise MIS-2026-01704\.pdf/)).toBeInTheDocument();
    expect(screen.getByText(/2\.4 Mo/)).toBeInTheDocument();
  });

  it('trie les évènements par horodatage réel, indépendamment de leur ordre en entrée', () => {
    const events: ExchangeEvent[] = [
      { key: 'later', at: '2026-09-10T08:00:00.000Z', side: 'left', tone: 'party', label: 'Second' },
      { key: 'earlier', at: '2026-09-07T08:00:00.000Z', side: 'right', tone: 'self', label: 'Premier' },
    ];
    render(<ExchangeThread events={events} locale="fr" emptyLabel="Aucun échange." />);
    const labels = screen.getAllByText(/Premier|Second/).map((el) => el.textContent);
    expect(labels).toEqual(['Premier', 'Second']);
  });
});
