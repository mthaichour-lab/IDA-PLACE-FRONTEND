'use client';

import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { DEV_USER } from './api-client';

const BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');

export type RealtimeEventName = 'claim.ingested' | 'match.updated' | 'recours.timer' | 'metering.tick' | 'ledger.appended';

/**
 * Hook d'abonnement au flux temps réel du back-end (`RealtimeModule`,
 * B.12/HANDOFF §1) — Socket.IO, namespace `/realtime`, salon unique
 * `tenant:place` pour l'instant côté back. S'abonne à une liste
 * d'événements et appelle `onEvent` à chaque réception ; le composant
 * appelant décide quoi faire (typiquement `refetch()` d'une query
 * TanStack) — ce hook ne lit ni n'interprète jamais le payload lui-même
 * (aucune règle métier côté front, C.1).
 *
 * Limite connue (à signaler au Testeur) : au moment de ce sprint, le back
 * n'émet encore que `metering.tick` (démonstration périodique, 15s) ; les
 * événements `claim.ingested`/`match.updated` arriveront quand l'agent
 * Backend les branchera sur ClaimsModule/MatchingModule (voir HANDOFF
 * backend). En conséquence, CE HOOK NE DOIT JAMAIS ÊTRE LE SEUL MÉCANISME
 * DE RAFRAÎCHISSEMENT : chaque écran qui l'utilise prévoit aussi un
 * `refetchInterval` de repli (polling) sur sa query TanStack.
 */
export function useRealtime(events: RealtimeEventName[], onEvent: (event: RealtimeEventName, payload: unknown) => void): void {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;
  const key = events.join(',');

  useEffect(() => {
    let socket: Socket | undefined;
    try {
      socket = io(`${BASE_URL}/realtime`, {
        transports: ['websocket'],
        reconnectionAttempts: 5,
        timeout: 4000,
        // ⚠️ Corrigé en revue Testeur, sprint 3 : un navigateur ne peut pas
        // poser d'en-tête personnalisé sur un WebSocket brut — `auth` est
        // le seul canal qui transmet l'identité dev au handshake Socket.IO
        // (voir `RealtimeGateway.handleConnection`, back).
        auth: { devUser: DEV_USER },
      });
      for (const ev of key.split(',') as RealtimeEventName[]) {
        if (!ev) continue;
        socket.on(ev, (payload: unknown) => handlerRef.current(ev, payload));
      }
      socket.on('connect_error', () => {
        // Flux temps réel indisponible (back arrêté, ou pas encore démarré
        // par l'agent Backend) — l'écran reste utilisable via le polling de
        // repli déjà prévu par l'appelant.
      });
    } catch {
      // socket.io-client indisponible dans cet environnement — repli silencieux sur le polling.
    }
    return () => {
      socket?.disconnect();
    };
  }, [key]);
}
