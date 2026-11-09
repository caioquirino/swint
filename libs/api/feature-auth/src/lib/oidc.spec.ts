import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { backchannelFetch, createOidcClient } from './oidc.js';

const PUBLIC_ISSUER = 'http://idp.public.test/realms/swint';

let server: Server | undefined;
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
});

describe('backchannelFetch', () => {
  it('sends requests for the issuer origin to the internal origin and leaves others alone', async () => {
    const seen: string[] = [];
    const f = backchannelFetch('http://localhost:8080/realms/swint', 'http://keycloak:8080', async (u) => {
      seen.push(String(u));
      return new Response('{}');
    });
    await f('http://localhost:8080/realms/swint/protocol/openid-connect/token?x=1', { method: 'POST', headers: {} } as never);
    await f('https://elsewhere.test/jwks', { method: 'GET', headers: {} } as never);
    expect(seen).toEqual(['http://keycloak:8080/realms/swint/protocol/openid-connect/token?x=1', 'https://elsewhere.test/jwks']);
  });
});

describe('createOidcClient with internalUrl', () => {
  it('discovers through the internal URL but sends browsers to the public issuer', async () => {
    const requested: string[] = [];
    server = createServer((req, res) => {
      requested.push(req.url ?? '');
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          issuer: PUBLIC_ISSUER,
          authorization_endpoint: `${PUBLIC_ISSUER}/protocol/openid-connect/auth`,
          token_endpoint: `${PUBLIC_ISSUER}/protocol/openid-connect/token`,
          jwks_uri: `${PUBLIC_ISSUER}/protocol/openid-connect/certs`,
          end_session_endpoint: `${PUBLIC_ISSUER}/protocol/openid-connect/logout`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          code_challenge_methods_supported: ['S256'],
        }),
      );
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;

    const oidc = createOidcClient({
      issuer: PUBLIC_ISSUER,
      internalUrl: `http://127.0.0.1:${port}`,
      clientId: 'swint-api',
      clientSecret: 's',
      redirectUri: 'http://localhost:8088/auth/callback',
      postLogoutRedirectUri: 'http://localhost:8088/',
      allowInsecureHttp: true,
    });
    const { url } = await oidc.createAuthorization();
    expect(url.origin).toBe('http://idp.public.test');
    expect(requested).toEqual(['/realms/swint/.well-known/openid-configuration']);
  });
});
