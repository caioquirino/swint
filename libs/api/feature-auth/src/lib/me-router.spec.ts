import { describe, expect, it } from 'vitest';
import { createRouterClient } from '@orpc/server';
import type { Identity } from '@swint/api-util-rpc';
import { createMeRouter } from './me-router.js';

const client = (identity: Identity | null) => createRouterClient({ me: createMeRouter() }, { context: { identity, requestId: 't' } }).me;

describe('me.get', () => {
  it('returns the interviewer profile', async () => {
    await expect(
      client({ kind: 'interviewer', sub: 's', name: 'Ada', email: null, orgId: 'default', roles: ['interviewer'] }).get(),
    ).resolves.toEqual({ sub: 's', name: 'Ada', email: null, orgId: 'default', roles: ['interviewer'] });
  });
  it('rejects candidates and anonymous', async () => {
    await expect(client(null).get()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(client({ kind: 'candidate', sessionId: 'x', orgId: 'default', inviteHash: 'h', name: 'Bo' }).get()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
