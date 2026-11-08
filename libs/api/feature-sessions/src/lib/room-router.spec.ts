import { describe, expect, it } from 'vitest';
import { createRouterClient } from '@orpc/server';
import type { Identity } from '@swint/api-util-rpc';
import { createRoomRouter } from './room-router.js';
import { setupSessions } from './test-setup.js';

const ada: Identity = { kind: 'interviewer', sub: 'sub-1', name: 'Ada', email: null, orgId: 'default', roles: ['interviewer'] };

async function setup() {
  const ctx = await setupSessions();
  const out = await ctx.as(ada).create({ templateId: 'tpl-1', candidateName: 'Bo' });
  const id = out.session.id;
  const room = (identity: Identity | null) =>
    createRouterClient({ room: createRoomRouter({ sessions: ctx.stores.sessions }) }, {
      context: { identity, requestId: 't' },
    }).room;
  const cand: Identity = { kind: 'candidate', sessionId: id, orgId: 'default', inviteHash: 'h', name: 'Bo' };
  return { ...ctx, id, room, cand };
}

describe('room.get', () => {
  it('anonymous is UNAUTHORIZED', async () => {
    const { room, id } = await setup();
    await expect(room(null).get({ sessionId: id })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('interviewer view includes rubric and candidate name', async () => {
    const { room, id } = await setup();
    await expect(room(ada).get({ sessionId: id })).resolves.toMatchObject({
      role: 'interviewer',
      sessionId: id,
      rubricMd: '- scaling',
      candidateName: 'Bo',
      instructionsMd: '# Go',
      me: { name: 'Ada', sub: 'sub-1' },
    });
  });

  it('candidate sees the waiting room (no instructions) before start, and never the rubric', async () => {
    const { room, id, cand } = await setup();
    const view = await room(cand).get({ sessionId: id });
    expect(view).toMatchObject({ role: 'candidate', status: 'created', instructionsMd: null, me: { name: 'Bo' } });
    expect(view).not.toHaveProperty('rubricMd');
    expect(view).not.toHaveProperty('cancelReason');
  });

  it('candidate sees instructions once live', async () => {
    const { room, id, cand, as } = await setup();
    await as(ada).start({ id });
    await expect(room(cand).get({ sessionId: id })).resolves.toMatchObject({ status: 'live', instructionsMd: '# Go' });
  });

  it('candidate of another session is FORBIDDEN', async () => {
    const { room, id, cand } = await setup();
    await expect(room({ ...cand, sessionId: 'other' }).get({ sessionId: id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('candidate after the session finished is FORBIDDEN with reason session_ended', async () => {
    const { room, id, cand, as } = await setup();
    await as(ada).cancel({ id, reason: 'secret reason' });
    await expect(room(cand).get({ sessionId: id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      data: { reason: 'session_ended' },
    });
  });

  it('interviewer of another org is NOT_FOUND', async () => {
    const { room, id } = await setup();
    await expect(room({ ...ada, orgId: 'other-org' }).get({ sessionId: id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
