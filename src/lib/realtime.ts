'use client';

import { QueryKey, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { API_BASE_URL } from './api-client';
import { devUser } from './auth/dev-identity';
import { getAccessToken } from './auth/session';

export type RealtimeEventName = 'claim.ingested' | 'match.updated' | 'recours.timer' | 'metering.tick' | 'ledger.appended';

/**
 * Requêtes TanStack invalidées à la réception de chaque événement (SEC-07).
 *
 * Le backend ne diffuse plus qu'un payload minimal (identifiant et état,
 * aux seules compagnies parties + salon de place) : le front n'en lit
 * AUCUNE donnée métier, il invalide les requêtes concernées et recharge le
 * détail par l'API, qui applique le filtrage par compagnie. Préfixes de
 * clés : une entrée `['matching']` invalide toutes les requêtes
 * `['matching', …]`.
 */
export const REALTIME_INVALIDATIONS: Record<RealtimeEventName, QueryKey[]> = {
  'claim.ingested': [['cockpit'], ['matching'], ['claims'], ['monitoring'], ['fraud'], ['stats']],
  'match.updated': [['cockpit'], ['matching'], ['monitoring']],
  'recours.timer': [['cockpit'], ['recours'], ['monitoring']],
  'metering.tick': [['metering']],
  'ledger.appended': [['ledger']],
};

/** Ce que l'interface peut afficher d'un événement : son type, et l'identifiant/l'état s'ils sont fournis (jamais d'autre champ). */
export interface RealtimeSignal {
  event: RealtimeEventName;
  id?: string;
  state?: string;
}

const SIGNAL_FIELD_MAX = 64;

function shortString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= SIGNAL_FIELD_MAX ? value : undefined;
}

/** Réduit un payload reçu à `{ event, id?, state? }` — tout autre champ est ignoré. */
export function toRealtimeSignal(event: RealtimeEventName, payload: unknown): RealtimeSignal {
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const id = shortString(record.id);
  const state = shortString(record.state) ?? shortString(record.status) ?? shortString(record.etat);
  return { event, ...(id ? { id } : {}), ...(state ? { state } : {}) };
}

/** Code d'erreur applicatif émis par la passerelle (`TOKEN_EXPIRED`, `UNAUTHORIZED`, `FORBIDDEN`). */
export function realtimeErrorCode(err: unknown): string | undefined {
  return err && typeof err === 'object' && typeof (err as { code?: unknown }).code === 'string' ? (err as { code: string }).code : undefined;
}

/**
 * Hook d'abonnement au flux temps réel du back-end (`RealtimeModule`,
 * B.12/HANDOFF §1) — Socket.IO, namespace `/realtime`.
 *
 * Authentification du handshake (SEC-01/SEC-07) : `auth.token` (jeton
 * Keycloak courant, réévalué à chaque reconnexion) ; `auth.devUser` en
 * développement uniquement. L'URL suit `NEXT_PUBLIC_API_URL` : en https,
 * Socket.IO ouvre une connexion `wss://` (le build de production refuse
 * une API en http, SEC-40).
 *
 * À chaque événement : invalidation des requêtes de
 * `REALTIME_INVALIDATIONS`, puis `onSignal` optionnel (indicateur « en
 * direct », journal d'événements) avec le seul signal réduit.
 *
 * Le flux temps réel n'est JAMAIS le seul mécanisme de rafraîchissement :
 * chaque écran qui l'utilise garde un `refetchInterval` de repli.
 */
export function useRealtime(events: RealtimeEventName[], onSignal?: (signal: RealtimeSignal) => void): void {
  const queryClient = useQueryClient();
  const handlerRef = useRef(onSignal);
  handlerRef.current = onSignal;
  const key = events.join(',');

  useEffect(() => {
    let socket: Socket | undefined;
    try {
      socket = io(`${API_BASE_URL}/realtime`, {
        transports: ['websocket'],
        reconnectionAttempts: 5,
        timeout: 4000,
        // Un navigateur ne peut pas poser d'en-tête sur un WebSocket : `auth`
        // est le seul canal d'authentification du handshake Socket.IO. Sous
        // forme de fonction, il est réévalué à chaque (re)connexion, donc
        // avec le jeton Keycloak renouvelé.
        auth: (cb) => {
          if (process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_AUTH_MODE === 'dev') {
            cb({ devUser: devUser() });
            return;
          }
          void getAccessToken().then((token) => cb(token ? { token } : {}));
        },
      });
      for (const ev of key.split(',') as RealtimeEventName[]) {
        if (!ev) continue;
        socket.on(ev, (payload: unknown) => {
          for (const queryKey of REALTIME_INVALIDATIONS[ev] ?? []) {
            void queryClient.invalidateQueries({ queryKey });
          }
          handlerRef.current?.(toRealtimeSignal(ev, payload));
        });
      }
      socket.on('connect_error', () => {
        // Flux temps réel indisponible (back arrêté, jeton refusé) — l'écran
        // reste utilisable via le polling de repli prévu par l'appelant.
      });
      // Contrat backend : à l'expiration du jeton, le serveur émet
      // `error { code: 'TOKEN_EXPIRED' }` puis coupe la connexion. Socket.IO
      // ne se reconnecte pas seul après une coupure décidée par le serveur :
      // on relance la connexion, `auth` fournissant le jeton renouvelé.
      // UNAUTHORIZED/FORBIDDEN : pas de nouvelle tentative (polling de repli).
      let tokenExpired = false;
      const current = socket;
      current.on('error', (err: unknown) => {
        tokenExpired = realtimeErrorCode(err) === 'TOKEN_EXPIRED';
      });
      current.on('disconnect', (reason: string) => {
        if (reason === 'io server disconnect' && tokenExpired) {
          tokenExpired = false;
          current.connect();
        }
      });
    } catch {
      // socket.io-client indisponible dans cet environnement — repli silencieux sur le polling.
    }
    return () => {
      socket?.disconnect();
    };
  }, [key, queryClient]);
}
