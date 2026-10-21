import { describe, expect, it } from 'vitest';
import { REALTIME_INVALIDATIONS, toRealtimeSignal } from './realtime';

describe('temps réel — signal réduit (SEC-07)', () => {
  it('ne conserve que le type, l’identifiant et l’état', () => {
    const signal = toRealtimeSignal('match.updated', {
      id: 'MATCH-1',
      state: 'CONFIRME',
      decidedBy: 'agent.saa',
      item: { insuredName: 'Nom Assuré', plate: '12345-116-16' },
      policyNumber: 'POL-9',
    });
    expect(signal).toEqual({ event: 'match.updated', id: 'MATCH-1', state: 'CONFIRME' });
  });

  it('accepte status/etat comme état, ignore les valeurs non textuelles ou trop longues', () => {
    expect(toRealtimeSignal('recours.timer', { id: 'R-1', etat: 'OUVERT' })).toEqual({ event: 'recours.timer', id: 'R-1', state: 'OUVERT' });
    expect(toRealtimeSignal('recours.timer', { id: 42, status: { nested: true } })).toEqual({ event: 'recours.timer' });
    expect(toRealtimeSignal('ledger.appended', { id: 'x'.repeat(65) })).toEqual({ event: 'ledger.appended' });
    expect(toRealtimeSignal('metering.tick', null)).toEqual({ event: 'metering.tick' });
  });

  it('retient la référence métier seulement si elle en a le format (REC/CSC/MAT)', () => {
    expect(toRealtimeSignal('recours.timer', { id: 'R-1', reference: 'REC-2026-00296', state: 'OPPOSITION' })).toEqual({ event: 'recours.timer', id: 'R-1', reference: 'REC-2026-00296', state: 'OPPOSITION' });
    expect(toRealtimeSignal('match.updated', { id: 'M-1', reference: 'MAT-261013-001' })).toEqual({ event: 'match.updated', id: 'M-1', reference: 'MAT-261013-001' });
    expect(toRealtimeSignal('recours.timer', { id: 'R-1', reference: 'Nom Assuré' })).toEqual({ event: 'recours.timer', id: 'R-1' });
  });

  it('chaque événement invalide au moins une famille de requêtes', () => {
    for (const keys of Object.values(REALTIME_INVALIDATIONS)) expect(keys.length).toBeGreaterThan(0);
    expect(REALTIME_INVALIDATIONS['recours.timer']).toContainEqual(['recours']);
    expect(REALTIME_INVALIDATIONS['match.updated']).toContainEqual(['matching']);
  });
});
