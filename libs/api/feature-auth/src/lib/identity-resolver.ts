import type { FastifyRequest } from 'fastify';
import type { AuthSessionsRepo, InvitesRepo, SessionsRepo } from '@swint/api-data-access-persistence';
import { sha256Hex, type Clock, type Identity } from '@swint/api-util-rpc';
import { COOKIE, readSignedJson, readSignedValue, type CandidateCookie } from './cookies.js';

export interface IdentityResolverDeps {
  authSessions: AuthSessionsRepo;
  invites: InvitesRepo;
  sessions: SessionsRepo;
  clock: Clock;
}

export type IdentityResolver = (request: FastifyRequest) => Promise<Identity | null>;

export function createIdentityResolver(deps: IdentityResolverDeps): IdentityResolver {
  return async (request) => {
    const now = deps.clock.now();

    const sid = readSignedValue(request, COOKIE.session);
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

    const cand = readSignedJson<CandidateCookie>(request, COOKIE.candidate);
    if (cand && typeof cand.exp === 'number' && cand.exp > now) {
      const invite = await deps.invites.get(cand.inviteHash);
      if (invite && invite.revokedAt === null && invite.sessionId === cand.sessionId) {
        const session = await deps.sessions.get(invite.orgId, invite.sessionId);
        if (session) {
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
  };
}
