import { describe, expect, it, vi } from 'vitest';
import type { Identity } from '@swint/api-util-rpc';
import { sha256Hex } from '@swint/api-util-rpc';
import { StaleWriteError } from '@swint/api-data-access-persistence';
import { setupSessions } from './test-setup.js';

const ada: Identity = { kind: 'interviewer', sub: 'sub-1', name: 'Ada', email: null, orgId: 'default', roles: ['interviewer'] };
const grace: Identity = { ...ada, sub: 'sub-2', name: 'Grace' };

async function created() {
  const ctx = await setupSessions();
  const out = await ctx.as(ada).create({ templateId: 'tpl-1', candidateName: 'Bo' });
  return { ...ctx, id: out.session.id };
}

describe('lifecycle commands', () => {
  it('start → extend → end, emitting sessionChanged each time', async () => {
    const { as, id, events } = await created();
    const started = await as(ada).start({ id });
    expect(started).toMatchObject({ status: 'live' });
    expect(started.startedAt).toEqual(expect.any(Number));
    await expect(as(ada).extend({ id, minutes: 10 })).resolves.toMatchObject({ extensionSec: 600 });
    await expect(as(grace).end({ id })).resolves.toMatchObject({ status: 'ended', endedBy: 'sub-2' });
    expect(events.sessionChanged).toHaveBeenCalledTimes(3);
    expect(events.sessionChanged.mock.calls.at(-1)?.[0]).toMatchObject({ id, status: 'ended', version: 4 });
  });

  it('cancel stores the reason, or null when absent', async () => {
    const a = await created();
    await expect(a.as(ada).cancel({ id: a.id, reason: 'no-show' })).resolves.toMatchObject({
      status: 'cancelled',
      cancelReason: 'no-show',
    });
    const b = await created();
    await expect(b.as(ada).cancel({ id: b.id })).resolves.toMatchObject({ status: 'cancelled', cancelReason: null });
  });

  it('invalid transitions are CONFLICT and do not emit events', async () => {
    const { as, id, events } = await created();
    await expect(as(ada).end({ id })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(as(ada).extend({ id, minutes: 5 })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(events.sessionChanged).not.toHaveBeenCalled();
  });

  it('two interviewers ending at once: exactly one succeeds, the other gets CONFLICT', async () => {
    const { as, id } = await created();
    await as(ada).start({ id });
    const results = await Promise.allSettled([as(ada).end({ id }), as(grace).end({ id })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('commands on another org session are NOT_FOUND', async () => {
    const { as, id } = await created();
    await expect(as({ ...ada, orgId: 'other-org' }).start({ id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('regenerateInvite', () => {
  it('revokes the old invite and issues a new one', async () => {
    const { as, id, stores } = await created(); // first token was token-1
    const { candidateUrl } = await as(ada).regenerateInvite({ id });
    expect(candidateUrl).toBe('http://localhost:4200/join/token-2');
    await expect(stores.invites.get(sha256Hex('token-1'))).resolves.toMatchObject({ revokedAt: expect.any(Number) });
    await expect(stores.invites.get(sha256Hex('token-2'))).resolves.toMatchObject({ revokedAt: null, sessionId: id });
    await expect(stores.sessions.get('default', id)).resolves.toMatchObject({ activeInviteHash: sha256Hex('token-2') });
  });

  it('succeeds even when revoking the old invite fails (activeInviteHash already moved)', async () => {
    const { as, id, stores } = await created();
    vi.spyOn(stores.invites, 'revoke').mockRejectedValueOnce(new Error('dynamo hiccup'));
    await expect(as(ada).regenerateInvite({ id })).resolves.toEqual({ candidateUrl: 'http://localhost:4200/join/token-2' });
    await expect(stores.sessions.get('default', id)).resolves.toMatchObject({ activeInviteHash: sha256Hex('token-2') });
  });

  it('keeps the original error when the rollback revoke also fails', async () => {
    const { as, id, stores } = await created();
    vi.spyOn(stores.sessions, 'update').mockRejectedValueOnce(new StaleWriteError());
    vi.spyOn(stores.invites, 'revoke').mockRejectedValueOnce(new Error('dynamo hiccup'));
    await expect(as(ada).regenerateInvite({ id })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('is CONFLICT once the session is finished', async () => {
    const { as, id } = await created();
    await as(ada).cancel({ id });
    await expect(as(ada).regenerateInvite({ id })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
