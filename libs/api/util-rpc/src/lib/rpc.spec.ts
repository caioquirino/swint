import { describe, expect, it } from 'vitest';
import { createRouterClient, ORPCError } from '@orpc/server';
import type { Identity } from './identity.js';
import { interviewerProcedures } from './rpc.js';

const me = interviewerProcedures.me.get.handler(({ context }) => ({
  sub: context.interviewer.sub,
  name: context.interviewer.name,
  email: context.interviewer.email,
  orgId: context.interviewer.orgId,
  roles: context.interviewer.roles,
}));

const client = (identity: Identity | null) =>
  createRouterClient({ me: { get: me } }, { context: { identity, requestId: 'test' } });

const interviewer: Identity = {
  kind: 'interviewer',
  sub: 'sub-1',
  name: 'Ada',
  email: 'ada@example.com',
  orgId: 'default',
  roles: ['interviewer'],
};

describe('requireInterviewer', () => {
  it('passes interviewer identity into context', async () => {
    await expect(client(interviewer).me.get()).resolves.toMatchObject({ sub: 'sub-1', orgId: 'default' });
  });
  it('rejects missing identity with UNAUTHORIZED', async () => {
    await expect(client(null).me.get()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
  it('rejects candidates with FORBIDDEN', async () => {
    const candidate: Identity = { kind: 'candidate', sessionId: 's1', orgId: 'default', inviteHash: 'h', name: 'Bo' };
    await expect(client(candidate).me.get()).rejects.toBeInstanceOf(ORPCError);
    await expect(client(candidate).me.get()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('rejects an interviewer identity without the interviewer role', async () => {
    await expect(client({ ...interviewer, roles: [] }).me.get()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
