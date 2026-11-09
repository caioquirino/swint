import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { sha256Hex } from '@swint/api-util-rpc';
import { createTestStores } from '@swint/api-data-access-persistence/testing';
import { COOKIE } from './cookies.js';
import { registerAuthRoutes } from './auth-routes.js';
import type { OidcClaims, OidcClient } from './oidc.js';

function must<T>(v: T | null | undefined): T {
  if (v === null || v === undefined) throw new Error('expected value');
  return v;
}

const SECRET = 'test-cookie-secret-that-is-long-enough-123';
const NOW = 1_700_000_000_000;

function fakeOidc(claims: OidcClaims, opts: { failExchange?: boolean } = {}): OidcClient & { exchanged: unknown[] } {
  const exchanged: unknown[] = [];
  return {
    exchanged,
    async createAuthorization() {
      return { url: new URL('http://idp.test/auth?client_id=swint-api'), state: 'st-1', verifier: 'ver-1' };
    },
    async exchange(url, expected) {
      exchanged.push({ url: url.toString(), expected });
      if (opts.failExchange) throw new Error('bad code');
      return { claims, idToken: 'id-token-1' };
    },
    async endSessionUrl(idToken) {
      return new URL(`http://idp.test/logout?id_token_hint=${idToken}`);
    },
  };
}

async function setup(claims: OidcClaims, opts: { failExchange?: boolean } = {}) {
  const stores = await createTestStores();
  const oidc = fakeOidc(claims, opts);
  const app = Fastify();
  await app.register(cookie, { secret: SECRET });
  registerAuthRoutes(app, {
    oidc,
    users: stores.users,
    authSessions: stores.authSessions,
    clock: { now: () => NOW },
    publicBaseUrl: 'http://localhost:4200',
    secureCookies: false,
    defaultOrgId: 'default',
  });
  await app.ready();
  return { app, stores, oidc };
}

const okClaims: OidcClaims = { sub: 'kc-1', name: 'Ada Interviewer', email: 'ada@example.com', roles: ['interviewer'] };

async function loginCookie(app: Awaited<ReturnType<typeof setup>>['app'], returnTo = '/sessions') {
  const res = await app.inject({ method: 'GET', url: `/auth/login?returnTo=${encodeURIComponent(returnTo)}` });
  return { res, oidcCookie: must(res.cookies.find((c) => c.name === COOKIE.oidc)) };
}

describe('auth routes', () => {
  it('login stores state+verifier in a signed cookie and redirects to the IdP', async () => {
    const { app } = await setup(okClaims);
    const { res, oidcCookie } = await loginCookie(app);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('http://idp.test/auth?client_id=swint-api');
    expect(JSON.parse(must(app.unsignCookie(oidcCookie.value).value))).toEqual({
      state: 'st-1',
      verifier: 'ver-1',
      returnTo: '/sessions',
    });
  });

  it.each(['//evil.com', 'https://evil.com', 'nope', '/\\evil.com', '/\\/evil.com', '/%0d%0aSet-Cookie:x', '/ok\tpath'])(
    'login sanitises returnTo %s to /',
    async (bad) => {
      const { app } = await setup(okClaims);
      const { oidcCookie } = await loginCookie(app, bad);
      expect(JSON.parse(must(app.unsignCookie(oidcCookie.value).value)).returnTo).toBe('/');
    },
  );

  it('login preserves a same-origin path with a query string', async () => {
    const { app } = await setup(okClaims);
    const { oidcCookie } = await loginCookie(app, '/s/abc?x=1');
    expect(JSON.parse(must(app.unsignCookie(oidcCookie.value).value)).returnTo).toBe('/s/abc?x=1');
  });

  it('callback creates the user + auth session, sets swint_sid and redirects to returnTo', async () => {
    const { app, stores, oidc } = await setup(okClaims);
    const { oidcCookie } = await loginCookie(app, '/sessions');
    const res = await app.inject({
      method: 'GET',
      url: '/auth/callback?code=abc&state=st-1',
      cookies: { [COOKIE.oidc]: oidcCookie.value },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/sessions');
    expect(oidc.exchanged[0]).toEqual({
      url: 'http://localhost:4200/auth/callback?code=abc&state=st-1',
      expected: { state: 'st-1', verifier: 'ver-1' },
    });
    const sid = must(app.unsignCookie(must(res.cookies.find((c) => c.name === COOKIE.session)).value).value);
    await expect(stores.authSessions.get(sha256Hex(sid), NOW)).resolves.toMatchObject({
      userSub: 'kc-1',
      orgId: 'default',
      roles: ['interviewer'],
      idToken: 'id-token-1',
      expiresAt: (NOW + 12 * 3600_000) / 1000,
    });
    await expect(stores.users.get('kc-1')).resolves.toMatchObject({ name: 'Ada Interviewer', email: 'ada@example.com' });
    expect(res.cookies.find((c) => c.name === COOKIE.oidc)?.value).toBe('');
  });

  it('callback without the oidc cookie is 400', async () => {
    const { app } = await setup(okClaims);
    const res = await app.inject({ method: 'GET', url: '/auth/callback?code=abc&state=st-1' });
    expect(res.statusCode).toBe(400);
  });

  it('callback with a failing exchange is 400', async () => {
    const { app } = await setup(okClaims, { failExchange: true });
    const { oidcCookie } = await loginCookie(app);
    const res = await app.inject({ method: 'GET', url: '/auth/callback?code=x&state=st-1', cookies: { [COOKIE.oidc]: oidcCookie.value } });
    expect(res.statusCode).toBe(400);
  });

  it('callback for a user without the interviewer role is 403 and creates no session', async () => {
    const { app, stores } = await setup({ ...okClaims, roles: ['something-else'] });
    const { oidcCookie } = await loginCookie(app);
    const res = await app.inject({ method: 'GET', url: '/auth/callback?code=x&state=st-1', cookies: { [COOKIE.oidc]: oidcCookie.value } });
    expect(res.statusCode).toBe(403);
    expect(res.cookies.find((c) => c.name === COOKIE.session)).toBeUndefined();
    await expect(stores.users.get('kc-1')).resolves.toBeNull();
  });

  it('logout deletes the auth session, clears the cookie and returns the IdP logout URL', async () => {
    const { app, stores } = await setup(okClaims);
    const { oidcCookie } = await loginCookie(app);
    const cb = await app.inject({ method: 'GET', url: '/auth/callback?code=x&state=st-1', cookies: { [COOKIE.oidc]: oidcCookie.value } });
    const sidCookie = must(cb.cookies.find((c) => c.name === COOKIE.session)).value;
    const sid = must(app.unsignCookie(sidCookie).value);
    const res = await app.inject({ method: 'POST', url: '/auth/logout', cookies: { [COOKIE.session]: sidCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ redirectUrl: 'http://idp.test/logout?id_token_hint=id-token-1' });
    expect(res.cookies.find((c) => c.name === COOKIE.session)?.value).toBe('');
    await expect(stores.authSessions.get(sha256Hex(sid), NOW)).resolves.toBeNull();
  });

  it('logout without a session returns redirectUrl /', async () => {
    const { app } = await setup(okClaims);
    const res = await app.inject({ method: 'POST', url: '/auth/logout' });
    expect(res.json()).toEqual({ redirectUrl: '/' });
  });
});
