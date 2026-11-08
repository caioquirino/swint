import type { FastifyRequest } from 'fastify';
import { signerFactory } from '@fastify/cookie';
import type { AuthSessionsRepo, InvitesRepo, SessionsRepo } from '@swint/api-data-access-persistence';
import { sha256Hex, type Clock, type Identity } from '@swint/api-util-rpc';
import {
  COOKIE,
  fastifyCookieReader,
  headerCookieReader,
  readSignedJsonWith,
  type CandidateCookie,
  type SignedCookieReader,
} from './cookies.js';

export interface IdentityResolverDeps {
  authSessions: AuthSessionsRepo;
  invites: InvitesRepo;
  sessions: SessionsRepo;
  clock: Clock;
}

export type IdentityResolver = (request: FastifyRequest) => Promise<Identity | null>;

/** Resolves an identity from a raw `Cookie` header, e.g. on a WebSocket upgrade `IncomingMessage`. */
export type CookieHeaderIdentityResolver = (cookieHeader: string | undefined) => Promise<Identity | null>;

async function resolveIdentity(deps: IdentityResolverDeps, read: SignedCookieReader): Promise<Identity | null> {
  const now = deps.clock.now();

  const sid = read(COOKIE.session);
  if (sid) {
    const auth = await deps.authSessions.get(sha256Hex(sid), now);
    if (auth) {
      return {
        kind: 'interviewer',
        sub: auth.userSub,
        name: auth.name,
        email: auth.email,
        orgId: auth.orgId,
        roles: auth.roles,
      };
    }
  }

  const cand = readSignedJsonWith<CandidateCookie>(read, COOKIE.candidate);
  if (cand && typeof cand.exp === 'number' && cand.exp > now) {
    const invite = await deps.invites.get(cand.inviteHash);
    if (invite && invite.revokedAt === null && invite.sessionId === cand.sessionId) {
      const session = await deps.sessions.get(invite.orgId, invite.sessionId);
      // Only the session's current invite counts: a regenerated invite supersedes older ones.
      if (session && session.activeInviteHash === invite.hash) {
        return {
          kind: 'candidate',
          sessionId: session.id,
          orgId: session.orgId,
          inviteHash: invite.hash,
          name: session.candidateName,
        };
      }
    }
  }

  return null;
}

/** Fastify-request resolver; requires @fastify/cookie registered with the cookie secret. */
export function createIdentityResolver(deps: IdentityResolverDeps): IdentityResolver {
  return (request) => resolveIdentity(deps, fastifyCookieReader(request));
}

/** Same semantics as {@link createIdentityResolver}, from a raw Cookie header signed with `cookieSecret`. */
export function createCookieIdentityResolver(
  deps: IdentityResolverDeps & { cookieSecret: string },
): CookieHeaderIdentityResolver {
  const signer = signerFactory(deps.cookieSecret);
  return (cookieHeader) => resolveIdentity(deps, headerCookieReader(cookieHeader, signer));
}
