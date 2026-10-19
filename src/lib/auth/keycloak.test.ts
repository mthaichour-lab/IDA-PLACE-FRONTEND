import { InMemoryWebStorage, WebStorageStateStore } from 'oidc-client-ts';
import { describe, expect, it } from 'vitest';
import { CALLBACK_PATH, keycloakSettings, LOGGED_OUT_PATH } from './keycloak';

const CONFIG = { url: 'https://auth.ida-place.example/', realm: 'ida-place', clientId: 'ida-place-web' };

describe('paramètres OIDC Keycloak (SEC-01)', () => {
  const settings = keycloakSettings(CONFIG, 'https://app.ida-place.example', window.sessionStorage);

  it('Authorization Code (PKCE par défaut) sur le realm, client public ida-place-web', () => {
    expect(settings.authority).toBe('https://auth.ida-place.example/realms/ida-place');
    expect(settings.client_id).toBe('ida-place-web');
    expect(settings.response_type).toBe('code');
    expect(settings.disablePKCE).toBeUndefined();
    expect(settings).not.toHaveProperty('client_secret');
    expect(settings.scope).toContain('openid');
  });

  it('URL de retour et de déconnexion sur l’origine de l’application', () => {
    expect(settings.redirect_uri).toBe(`https://app.ida-place.example${CALLBACK_PATH}`);
    expect(settings.post_logout_redirect_uri).toBe(`https://app.ida-place.example${LOGGED_OUT_PATH}`);
  });

  it('jetons conservés en mémoire uniquement, renouvellement automatique', () => {
    expect(settings.userStore).toBeInstanceOf(WebStorageStateStore);
    // Le magasin des jetons n'est ni localStorage ni sessionStorage.
    const store = (settings.userStore as unknown as { _store: Storage })._store;
    expect(store).toBeInstanceOf(InMemoryWebStorage);
    expect(store).not.toBe(window.localStorage);
    expect(store).not.toBe(window.sessionStorage);
    expect(settings.automaticSilentRenew).toBe(true);
  });

  it('refuse une configuration incomplète', () => {
    expect(() => keycloakSettings({ url: CONFIG.url, realm: '', clientId: 'x' }, 'https://a', window.sessionStorage)).toThrow(/incomplète/);
  });
});
