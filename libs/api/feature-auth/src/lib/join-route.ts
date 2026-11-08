import type { FastifyInstance } from 'fastify';
import { isFinished } from '@swint/shared-domain';
import type { InvitesRepo, SessionsRepo } from '@swint/api-data-access-persistence';
import { sha256Hex, type Clock } from '@swint/api-util-rpc';
import { COOKIE, cookieOptions, SESSION_TTL_MS, type CandidateCookie } from './cookies.js';

export interface JoinRouteDeps {
  invites: InvitesRepo;
  sessions: SessionsRepo;
  clock: Clock;
  secureCookies: boolean;
}

export function registerJoinRoute(app: FastifyInstance, deps: JoinRouteDeps): void {
  app.get<{ Params: { token: string } }>('/join/:token', async (request, reply) => {
    const hash = sha256Hex(request.params.token);
    const invite = await deps.invites.get(hash);
    if (!invite || invite.revokedAt !== null) return reply.redirect('/link-invalid?reason=invite_revoked', 302);
    const session = await deps.sessions.get(invite.orgId, invite.sessionId);
    if (!session) return reply.redirect('/link-invalid?reason=invite_revoked', 302);
    if (isFinished(session.status)) return reply.redirect('/link-invalid?reason=session_ended', 302);

    const payload: CandidateCookie = { sessionId: session.id, inviteHash: hash, exp: deps.clock.now() + SESSION_TTL_MS };
    reply.setCookie(COOKIE.candidate, JSON.stringify(payload), cookieOptions({ secure: deps.secureCookies, maxAgeMs: SESSION_TTL_MS }));
    return reply.redirect(`/s/${session.id}`, 302);
  });
}
