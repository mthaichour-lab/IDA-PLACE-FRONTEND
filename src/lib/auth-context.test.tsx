import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockFetchRequests, renderWithProviders } from '@/test/render';
import { safeReturnTo, useAuth } from './auth-context';

/**
 * Mode Keycloak (SEC-01) : `oidc-client-ts` est remplacé par un faux
 * `UserManager` — on vérifie le comportement de la session (redirection
 * vers Keycloak, rendu conditionné à la session, Bearer, déconnexion), pas
 * la bibliothèque elle-même.
 */
const fakeManager = {
  getUser: vi.fn(),
  signinRedirect: vi.fn(),
  signinRedirectCallback: vi.fn(),
  signoutRedirect: vi.fn(),
  removeUser: vi.fn(),
  events: {
    addUserLoaded: vi.fn(() => () => {}),
    addSilentRenewError: vi.fn(() => () => {}),
    addAccessTokenExpired: vi.fn(() => () => {}),
    addUserSignedOut: vi.fn(() => () => {}),
  },
};

vi.mock('./auth/keycloak', () => ({
  CALLBACK_PATH: '/auth/callback',
  LOGGED_OUT_PATH: '/auth/logged-out',
  getUserManager: () => fakeManager,
  // Même mémoïsation que la vraie implémentation (voir keycloak.ts) : un seul test de ce fichier ne fait qu'un appel, donc transparent ici.
  signinRedirectCallbackOnce: (mgr: typeof fakeManager) => mgr.signinRedirectCallback(),
}));

const ME = { user: { id: 'u1', name: 'Nadia B.', email: 'n@caat.dz' }, role: 'TRESORIER', privileges: ['synth'], company: 'CAAT' };

function Probe() {
  const { me, logout } = useAuth();
  return (
    <div>
      <p>Écran protégé</p>
      <p>{me ? `${me.role} / ${me.company}` : 'sans identité'}</p>
      <button type="button" onClick={logout}>
        déconnexion
      </button>
    </div>
  );
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_AUTH_MODE', 'keycloak');
  for (const fn of [fakeManager.getUser, fakeManager.signinRedirect, fakeManager.signinRedirectCallback, fakeManager.signoutRedirect, fakeManager.removeUser]) fn.mockReset();
  fakeManager.signinRedirect.mockResolvedValue(undefined);
  fakeManager.signoutRedirect.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('AuthProvider — mode Keycloak (SEC-01)', () => {
  it('sans session : redirige vers Keycloak et ne rend ni écran ni appel API', async () => {
    fakeManager.getUser.mockResolvedValue(null);
    const fetchFn = mockFetchRequests(() => ({ body: ME }));

    renderWithProviders(<Probe />);

    await waitFor(() => expect(fakeManager.signinRedirect).toHaveBeenCalledTimes(1));
    expect(fakeManager.signinRedirect.mock.calls[0][0]).toEqual({ state: { returnTo: '/' } });
    expect(screen.queryByText('Écran protégé')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Connexion en cours');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('jeton expiré : relance la connexion', async () => {
    fakeManager.getUser.mockResolvedValue({ expired: true, access_token: 'vieux' });
    mockFetchRequests(() => ({ body: ME }));
    renderWithProviders(<Probe />);
    await waitFor(() => expect(fakeManager.signinRedirect).toHaveBeenCalled());
  });

  it('avec session : rend l’écran, appelle /me en Bearer, rôle et compagnie issus de /me', async () => {
    fakeManager.getUser.mockResolvedValue({ expired: false, access_token: 'jeton-123' });
    const fetchFn = mockFetchRequests(({ pathname }) => (pathname === '/api/v1/me' ? { body: ME } : undefined));

    renderWithProviders(<Probe />);

    expect(await screen.findByText('TRESORIER / CAAT')).toBeInTheDocument();
    const init = fetchFn.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jeton-123');
    expect((init.headers as Record<string, string>)['x-dev-user']).toBeUndefined();
    expect(fakeManager.signinRedirect).not.toHaveBeenCalled();
  });

  it('déconnexion : ferme la session Keycloak', async () => {
    fakeManager.getUser.mockResolvedValue({ expired: false, access_token: 'jeton' });
    mockFetchRequests(() => ({ body: ME }));
    renderWithProviders(<Probe />);

    await userEvent.click(await screen.findByRole('button', { name: 'déconnexion' }));
    expect(fakeManager.signoutRedirect).toHaveBeenCalledTimes(1);
  });

  it('401 de l’API : relance la connexion', async () => {
    fakeManager.getUser.mockResolvedValue({ expired: false, access_token: 'jeton-révoqué' });
    mockFetchRequests(() => ({ status: 401, body: { code: 'UNAUTHORIZED', message: 'Jeton invalide' } }));
    renderWithProviders(<Probe />);
    await waitFor(() => expect(fakeManager.signinRedirect).toHaveBeenCalledTimes(1));
  });
});

describe('safeReturnTo', () => {
  it('n’accepte que des chemins internes', () => {
    expect(safeReturnTo('/matching?x=1')).toBe('/matching?x=1');
    expect(safeReturnTo('https://evil.example')).toBe('/cockpit');
    expect(safeReturnTo('//evil.example')).toBe('/cockpit');
    expect(safeReturnTo('/\\evil.example')).toBe('/cockpit');
    expect(safeReturnTo('/auth/callback?code=x')).toBe('/cockpit');
    expect(safeReturnTo(undefined)).toBe('/cockpit');
  });
});
