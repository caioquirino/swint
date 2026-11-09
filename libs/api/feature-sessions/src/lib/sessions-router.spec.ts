import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { getBoardElements } from '@swint/shared-collab-protocol';
import type { Identity } from '@swint/api-util-rpc';
import { sha256Hex } from '@swint/api-util-rpc';
import { blobKeys, type TemplateRecord } from '@swint/api-data-access-persistence';
import { setupSessions } from './test-setup.js';

const interviewer = (orgId = 'default', sub = 'sub-1'): Identity => ({
  kind: 'interviewer',
  sub,
  name: 'Ada',
  email: null,
  orgId,
  roles: ['interviewer'],
});
const candidate: Identity = { kind: 'candidate', sessionId: 'x', orgId: 'default', inviteHash: 'h', name: 'Bo' };

describe('sessions router: access', () => {
  it('every procedure rejects candidates with FORBIDDEN and anonymous with UNAUTHORIZED', async () => {
    const { as } = await setupSessions();
    const calls = (c: ReturnType<typeof as>) => [
      () => c.list({}),
      () => c.get({ id: 'x' }),
      () => c.create({ templateId: 'tpl-1', candidateName: 'Bo' }),
      () => c.start({ id: 'x' }),
      () => c.extend({ id: 'x', minutes: 5 }),
      () => c.end({ id: 'x' }),
      () => c.cancel({ id: 'x' }),
      () => c.regenerateInvite({ id: 'x' }),
    ];
    for (const call of calls(as(candidate))) await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    for (const call of calls(as(null))) await expect(call()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('sessions router: create / get / list', () => {
  it('create snapshots the template, stores a hashed invite, seeds the board and returns links', async () => {
    const { stores, as } = await setupSessions();
    const out = await as(interviewer()).create({ templateId: 'tpl-1', candidateName: 'Bo' });
    expect(out.candidateUrl).toBe('http://localhost:4200/join/token-1');
    expect(out.interviewerUrl).toBe(`http://localhost:4200/s/${out.session.id}`);
    expect(out.session).toMatchObject({
      title: 'URL shortener',
      candidateName: 'Bo',
      status: 'created',
      startedAt: null,
      durationSec: 2700,
      extensionSec: 0,
      instructionsMd: '# Go',
      rubricMd: '- scaling',
      createdBy: 'sub-1',
    });

    const invite = await stores.invites.get(sha256Hex('token-1'));
    expect(invite).toMatchObject({ sessionId: out.session.id, orgId: 'default', revokedAt: null });
    expect(await stores.invites.get('token-1')).toBeNull(); // raw token never stored

    const bytes = await stores.blobs.getBytes(blobKeys.sessionBoardLatest('default', out.session.id));
    const doc = new Y.Doc();
    Y.applyUpdate(doc, bytes as Uint8Array);
    expect(getBoardElements(doc).get('e1')).toMatchObject({ id: 'e1', version: 2 });
  });

  it('editing the template afterwards does not change the session (snapshot)', async () => {
    const { stores, as } = await setupSessions();
    const out = await as(interviewer()).create({ templateId: 'tpl-1', candidateName: 'Bo' });
    const tpl = (await stores.templates.get('default', 'tpl-1')) as TemplateRecord;
    await stores.templates.update({ ...tpl, instructionsMd: 'CHANGED' });
    await expect(as(interviewer()).get({ id: out.session.id })).resolves.toMatchObject({ instructionsMd: '# Go' });
  });

  it('create from a missing, foreign or archived template fails', async () => {
    const { stores, as } = await setupSessions();
    await expect(as(interviewer()).create({ templateId: 'nope', candidateName: 'Bo' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(as(interviewer('other-org')).create({ templateId: 'tpl-1', candidateName: 'Bo' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const tpl = (await stores.templates.get('default', 'tpl-1')) as TemplateRecord;
    await stores.templates.update({ ...tpl, archived: true });
    await expect(as(interviewer()).create({ templateId: 'tpl-1', candidateName: 'Bo' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('get and list are org-scoped; list filters by status, newest first', async () => {
    const { as } = await setupSessions();
    const a = await as(interviewer()).create({ templateId: 'tpl-1', candidateName: 'A' });
    const b = await as(interviewer()).create({ templateId: 'tpl-1', candidateName: 'B' });
    expect((await as(interviewer()).list({})).map((s) => s.candidateName)).toEqual(['B', 'A']);
    expect(await as(interviewer()).list({ status: 'live' })).toEqual([]);
    await expect(as(interviewer('other-org')).get({ id: a.session.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await as(interviewer('other-org')).list({})).toEqual([]);
    expect(b.session.id).not.toBe(a.session.id);
  });
});
