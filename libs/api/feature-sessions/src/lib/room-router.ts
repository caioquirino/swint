import { ORPCError } from '@orpc/server';
import { isFinished } from '@swint/shared-domain';
import { INTERVIEWER_ROLE, base } from '@swint/api-util-rpc';
import type { SessionsRepo } from '@swint/api-data-access-persistence';
import { toRoomView } from './mappers.js';

export interface RoomDeps {
  sessions: SessionsRepo;
}

export function createRoomRouter(deps: RoomDeps) {
  return {
    get: base.room.get.handler(async ({ input, context }) => {
      const identity = context.identity;
      if (!identity) throw new ORPCError('UNAUTHORIZED');

      if (identity.kind === 'interviewer') {
        if (!identity.roles.includes(INTERVIEWER_ROLE)) throw new ORPCError('FORBIDDEN');
        const rec = await deps.sessions.get(identity.orgId, input.sessionId);
        if (!rec) throw new ORPCError('NOT_FOUND');
        return toRoomView(rec, identity);
      }

      if (identity.sessionId !== input.sessionId) throw new ORPCError('FORBIDDEN');
      const rec = await deps.sessions.get(identity.orgId, input.sessionId);
      if (!rec) throw new ORPCError('FORBIDDEN');
      if (isFinished(rec.status)) throw new ORPCError('FORBIDDEN', { data: { reason: 'session_ended' } });
      return toRoomView(rec, identity);
    }),
  };
}
