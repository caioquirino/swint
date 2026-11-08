import * as client from 'openid-client';

export interface OidcClaims {
  sub: string;
  name?: string;
  preferred_username?: string;
  email?: string;
  roles?: unknown;
}

export interface OidcClient {
  createAuthorization(): Promise<{ url: URL; state: string; verifier: string }>;
  exchange(callbackUrl: URL, expected: { state: string; verifier: string }): Promise<{ claims: OidcClaims; idToken: string }>;
  endSessionUrl(idToken: string): Promise<URL>;
}

export interface OidcSettings {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
  /** true only for local http Keycloak */
  allowInsecureHttp: boolean;
}

export function createOidcClient(settings: OidcSettings): OidcClient {
  let configPromise: Promise<client.Configuration> | null = null;

  /** Lazy discovery: Keycloak may still be starting when the API boots. Failed attempts are retried on next use. */
  function config(): Promise<client.Configuration> {
    if (!configPromise) {
      configPromise = client
        .discovery(
          new URL(settings.issuer),
          settings.clientId,
          settings.clientSecret,
          undefined,
          settings.allowInsecureHttp ? { execute: [client.allowInsecureRequests] } : undefined,
        )
        .catch((e) => {
          configPromise = null;
          throw e;
        });
    }
    return configPromise;
  }

  return {
    async createAuthorization() {
      const cfg = await config();
      const verifier = client.randomPKCECodeVerifier();
      const state = client.randomState();
      const url = client.buildAuthorizationUrl(cfg, {
        redirect_uri: settings.redirectUri,
        scope: 'openid profile email',
        code_challenge: await client.calculatePKCECodeChallenge(verifier),
        code_challenge_method: 'S256',
        state,
      });
      return { url, state, verifier };
    },
    async exchange(callbackUrl, expected) {
      const cfg = await config();
      const tokens = await client.authorizationCodeGrant(cfg, callbackUrl, {
        pkceCodeVerifier: expected.verifier,
        expectedState: expected.state,
      });
      const claims = tokens.claims();
      if (!claims || !tokens.id_token) throw new Error('No ID token in response');
      return { claims: claims as unknown as OidcClaims, idToken: tokens.id_token };
    },
    async endSessionUrl(idToken) {
      const cfg = await config();
      return client.buildEndSessionUrl(cfg, {
        id_token_hint: idToken,
        post_logout_redirect_uri: settings.postLogoutRedirectUri,
      });
    },
  };
}
