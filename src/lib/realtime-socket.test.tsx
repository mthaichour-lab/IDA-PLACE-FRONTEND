import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessTokenGetter } from './auth/session';
import { useRealtime } from './realtime';

/**
 * Socket simulé (remplace le stub global de vitest.setup.ts) : capture les
 * options passées à `io()` et les gestionnaires enregistrés.
 */
const fake = vi.hoisted(() => {
  const state = {
    options: undefined as undefined | { auth?: (cb: (data: object) => void) => void },
    handlers: new Map<string, ((arg: unknown) => void)[]>(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  return state;
});

vi.mock('socket.io-client', () => ({
  io: (_url: string, options: typeof fake.options) => {
    fake.options = options;
    return {
      on: (event: string, cb: (arg: unknown) => void) => {
        fake.handlers.set(event, [...(fake.handlers.get(event) ?? []), cb]);
      },
      connect: fake.connect,
      disconnect: fake.disconnect,
    };
  },
}));

function emit(event: string, arg?: unknown) {
  for (const cb of fake.handlers.get(event) ?? []) cb(arg);
}

function Probe({ onSignal }: { onSignal?: (s: unknown) => void }) {
  useRealtime(['match.updated'], onSignal);
  return null;
}

function renderProbe(client: QueryClient, onSignal?: (s: unknown) => void) {
  return render(
    <QueryClientProvider client={client}>
      <Probe onSignal={onSignal} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fake.handlers.clear();
  fake.connect.mockReset();
  fake.options = undefined;
});

afterEach(() => {
  vi.unstubAllEnvs();
  setAccessTokenGetter(null);
});

describe('socket temps réel (SEC-01 / SEC-07)', () => {
  it('mode keycloak : handshake auth.token avec le jeton courant', async () => {
    vi.stubEnv('NEXT_PUBLIC_AUTH_MODE', 'keycloak');
    setAccessTokenGetter(() => 'jeton-ws');
    renderProbe(new QueryClient());

    const data = await new Promise<object>((resolve) => fake.options!.auth!(resolve));
    expect(data).toEqual({ token: 'jeton-ws' });
  });

  it('mode dev : handshake auth.devUser', async () => {
    renderProbe(new QueryClient());
    const data = await new Promise<object>((resolve) => fake.options!.auth!(resolve));
    expect(data).toEqual({ devUser: 'OPERATEUR_PLACE' });
  });

  it('événement : invalide les requêtes concernées et ne transmet que le signal réduit', () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const onSignal = vi.fn();
    renderProbe(client, onSignal);

    act(() => emit('match.updated', { id: 'M-1', state: 'CONFIRME', insuredName: 'Nom Assuré' }));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['matching'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['cockpit'] });
    expect(onSignal).toHaveBeenCalledWith({ event: 'match.updated', id: 'M-1', state: 'CONFIRME' });
  });

  it('TOKEN_EXPIRED puis coupure serveur : reconnexion (jeton renouvelé)', () => {
    renderProbe(new QueryClient());
    emit('error', { code: 'TOKEN_EXPIRED' });
    emit('disconnect', 'io server disconnect');
    expect(fake.connect).toHaveBeenCalledTimes(1);
  });

  it('UNAUTHORIZED/FORBIDDEN : pas de reconnexion en boucle', () => {
    renderProbe(new QueryClient());
    emit('error', { code: 'FORBIDDEN' });
    emit('disconnect', 'io server disconnect');
    emit('error', { code: 'UNAUTHORIZED' });
    emit('disconnect', 'io server disconnect');
    expect(fake.connect).not.toHaveBeenCalled();
  });
});
