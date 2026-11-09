import type { FastifyInstance } from 'fastify';
import type { AuthSessionsRepo, UsersRepo } from '@swint/api-data-access-persistence';
import { INTERVIEWER_ROLE, randomToken, sha256Hex, type Clock } from '@swint/api-util-rpc';
import { COOKIE, cookieOptions, OIDC_STATE_TTL_MS, readSignedJson, readSignedValue, SESSION_TTL_MS } from './cookies.js';
import type { OidcClient } from './oidc.js';

export interface AuthRoutesDeps {
  oidc: OidcClient;
  users: UsersRepo;
  authSessions: AuthSessionsRepo;
  clock: Clock;
  publicBaseUrl: string;
  secureCookies: boolean;
  defaultOrgId: string;
}

interface OidcStateCookie {
  state: string;
  verifier: string;
  returnTo: string;
}

// Same-origin absolute path only: one leading '/', no '//' or '/\\' prefix, no backslashes,
// no control characters (raw or percent-encoded CR/LF/etc.).
const SAFE_RETURN_TO_PREFIX = /^\/(?![/\\])/;
const ENCODED_UNSAFE = /%(?:[01][0-9a-f]|7f|5c)/i;

const hasUnsafeChar = (value: string): boolean =>
  [...value].some((ch) => {
    const code = ch.charCodeAt(0);
    return ch === '\\' || code <= 0x1f || code === 0x7f;
  });

const safeReturnTo = (value: unknown): string =>
  typeof value === 'string' && SAFE_RETURN_TO_PREFIX.test(value) && !hasUnsafeChar(value) && !ENCODED_UNSAFE.test(value) ? value : '/';

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRoutesDeps): void {
  const clearOpts = { path: '/' };

  app.get<{ Querystring: { returnTo?: string } }>('/auth/login', async (request, reply) => {
    const { url, state, verifier } = await deps.oidc.createAuthorization();
    const payload: OidcStateCookie = { state, verifier, returnTo: safeReturnTo(request.query.returnTo) };
    reply.setCookie(COOKIE.oidc, JSON.stringify(payload), cookieOptions({ secure: deps.secureCookies, maxAgeMs: OIDC_STATE_TTL_MS }));
    return reply.redirect(url.toString(), 302);
  });

  app.get('/auth/callback', async (request, reply) => {
    const saved = readSignedJson<OidcStateCookie>(request, COOKIE.oidc);
    reply.clearCookie(COOKIE.oidc, clearOpts);
    if (!saved) return reply.code(400).type('text/plain').send('Login expired, please try again');

    let result: Awaited<ReturnType<OidcClient['exchange']>>;
    try {
      result = await deps.oidc.exchange(new URL(request.url, deps.publicBaseUrl), {
        state: saved.state,
        verifier: saved.verifier,
      });
    } catch (e) {
      request.log.warn({ err: e }, 'oidc exchange failed');
      return reply.code(400).type('text/plain').send('Login failed');
    }

    const { claims, idToken } = result;
    const roles = Array.isArray(claims.roles) ? claims.roles.filter((r): r is string => typeof r === 'string') : [];
    if (!roles.includes(INTERVIEWER_ROLE)) {
      return reply.code(403).type('text/plain').send('You are not allowed to use Swint');
    }

    const now = deps.clock.now();
    const name = claims.name ?? claims.preferred_username ?? claims.sub;
    const email = claims.email ?? null;
    await deps.users.upsert({ sub: claims.sub, orgId: deps.defaultOrgId, name, email, roles, lastLoginAt: now });

    const sid = randomToken();
    await deps.authSessions.create({
      idHash: sha256Hex(sid),
      userSub: claims.sub,
      orgId: deps.defaultOrgId,
      name,
      email,
      roles,
      idToken,
      expiresAt: Math.floor((now + SESSION_TTL_MS) / 1000),
    });
    reply.setCookie(COOKIE.session, sid, cookieOptions({ secure: deps.secureCookies, maxAgeMs: SESSION_TTL_MS }));
    return reply.redirect(saved.returnTo, 302);
  });

  app.post('/auth/logout', async (request, reply) => {
    const sid = readSignedValue(request, COOKIE.session);
    reply.clearCookie(COOKIE.session, clearOpts);
    if (!sid) return { redirectUrl: '/' };
    const idHash = sha256Hex(sid);
    const auth = await deps.authSessions.get(idHash, deps.clock.now());
    await deps.authSessions.delete(idHash);
    if (!auth) return { redirectUrl: '/' };
    try {
      return { redirectUrl: (await deps.oidc.endSessionUrl(auth.idToken)).toString() };
    } catch {
      return { redirectUrl: '/' };
    }
  });
}
