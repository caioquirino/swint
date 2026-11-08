import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { blobKeys } from '@swint/api-data-access-persistence';
import { getBoardElements, parseServerMessage, docName } from '@swint/shared-collab-protocol';
import type { Identity } from '@swint/api-util-rpc';
import { connectClient, seedSession, startCollabTestKit, type CollabTestKit } from '../testing/collab-test-kit.js';

const ada: Identity = { kind: 'interviewer', sub: 'sub-1', name: 'Ada', email: null, orgId: 'default', roles: ['interviewer'] };
const bo = (sessionId: string): Identity => ({ kind: 'candidate', sessionId, orgId: 'default', inviteHash: 'h', name: 'Bo' });

let kit: CollabTestKit;
afterEach(async () => {
  await kit?.close();
});

async function setup(status: 'created' | 'live' | 'ended' = 'live') {
  kit = await startCollabTestKit({ debounceMs: 50, maxDebounceMs: 200 });
  const s = await seedSession(kit, { id: `s-${Math.random().toString(36).slice(2, 8)}`, status });
  kit.identities.set('ada', ada);
  kit.identities.set('bo', bo(s.id));
  return s;
}

describe('collab server: authentication', () => {
  it('upgrade without a recognised cookie is refused', async () => {
    const s = await setup();
    const c = connectClient(kit, docName.board(s.id), null);
    const closed = await c.closed;
    expect(closed).toBeDefined();
    c.destroy();
  });

  it('candidate cannot open notes (forbidden)', async () => {
    const s = await setup('live');
    const c = connectClient(kit, docName.notes(s.id), 'bo');
    await expect(c.authFailure).resolves.toBe('forbidden');
    c.destroy();
  });

  it('candidate cannot open the board before start (not_started)', async () => {
    const s = await setup('created');
    const c = connectClient(kit, docName.board(s.id), 'bo');
    await expect(c.authFailure).resolves.toBe('not_started');
    c.destroy();
  });

  it('candidate after end gets session_ended', async () => {
    const s = await setup('ended');
    const c = connectClient(kit, docName.board(s.id), 'bo');
    await expect(c.authFailure).resolves.toBe('session_ended');
    c.destroy();
  });

  it('candidate of another session is forbidden', async () => {
    const s = await setup('live');
    kit.identities.set('other', bo('someone-else'));
    const c = connectClient(kit, docName.board(s.id), 'other');
    await expect(c.authFailure).resolves.toBe('forbidden');
    c.destroy();
  });

  it('interviewer of another org is forbidden', async () => {
    const s = await setup('live');
    kit.identities.set('eve', { ...ada, orgId: 'other-org' });
    const c = connectClient(kit, docName.board(s.id), 'eve');
    await expect(c.authFailure).resolves.toBe('forbidden');
    c.destroy();
  });
});

describe('collab server: sync and session.state', () => {
  it('interviewer and candidate see each other’s board edits', async () => {
    const s = await setup('live');
    const a = connectClient(kit, docName.board(s.id), 'ada');
    const b = connectClient(kit, docName.board(s.id), 'bo');
    await Promise.all([a.synced, b.synced]);
    getBoardElements(b.doc).set('e1', { id: 'e1', version: 1, versionNonce: 1, index: 'a0', isDeleted: false });
    await expect.poll(() => getBoardElements(a.doc).get('e1')?.version).toBe(1);
    a.destroy();
    b.destroy();
  });

  it('sends session.state with serverNow on connect to board documents only', async () => {
    const s = await setup('live');
    const a = connectClient(kit, docName.board(s.id), 'ada');
    await a.synced;
    await expect.poll(() => a.stateless.length).toBeGreaterThan(0);
    expect(parseServerMessage(a.stateless[0])).toMatchObject({ type: 'session.state', status: 'live', serverNow: expect.any(Number) });
    const n = connectClient(kit, docName.notes(s.id), 'ada');
    await n.synced;
    await new Promise((r) => setTimeout(r, 200));
    expect(n.stateless).toEqual([]);
    a.destroy();
    n.destroy();
  });

  it('interviewer on an ended session is read-only: their edits do not reach others', async () => {
    const s = await setup('ended');
    const a = connectClient(kit, docName.board(s.id), 'ada');
    kit.identities.set('grace', { ...ada, sub: 'sub-2', name: 'Grace' });
    const g = connectClient(kit, docName.board(s.id), 'grace');
    await Promise.all([a.synced, g.synced]);
    getBoardElements(a.doc).set('x', { id: 'x', version: 1, versionNonce: 1, index: 'a0', isDeleted: false });
    await new Promise((r) => setTimeout(r, 300));
    expect(getBoardElements(g.doc).get('x')).toBeUndefined();
    a.destroy();
    g.destroy();
  });

  it('client stateless messages are ignored (not broadcast)', async () => {
    const s = await setup('live');
    const a = connectClient(kit, docName.board(s.id), 'ada');
    const b = connectClient(kit, docName.board(s.id), 'bo');
    await Promise.all([a.synced, b.synced]);
    const before = a.stateless.length;
    b.provider.sendStateless(JSON.stringify({ type: 'session.state', status: 'ended' }));
    await new Promise((r) => setTimeout(r, 300));
    expect(a.stateless.length).toBe(before);
    a.destroy();
    b.destroy();
  });
});

describe('collab server: persistence', () => {
  it('loads the board seeded at session creation (latest.bin)', async () => {
    const s = await setup('live');
    const seed = new Y.Doc();
    getBoardElements(seed).set('seed1', { id: 'seed1', version: 2, versionNonce: 3, index: 'a0', isDeleted: false });
    await kit.stores.blobs.putBytes(blobKeys.sessionBoardLatest('default', s.id), Y.encodeStateAsUpdate(seed));
    const a = connectClient(kit, docName.board(s.id), 'ada');
    await a.synced;
    expect(getBoardElements(a.doc).get('seed1')).toMatchObject({ version: 2 });
    a.destroy();
  });

  it('a session without latest.bin opens as an empty board', async () => {
    const s = await setup('live');
    const a = connectClient(kit, docName.board(s.id), 'ada');
    await a.synced;
    expect(getBoardElements(a.doc).size).toBe(0);
    a.destroy();
  });

  it('edits are stored (debounced) under the board key', async () => {
    const s = await setup('live');
    const a = connectClient(kit, docName.board(s.id), 'ada');
    await a.synced;
    getBoardElements(a.doc).set('e1', { id: 'e1', version: 1, versionNonce: 1, index: 'a0', isDeleted: false });
    await expect
      .poll(
        async () => {
          const bytes = await kit.stores.blobs.getBytes(blobKeys.sessionBoardLatest('default', s.id));
          if (!bytes) return undefined;
          const d = new Y.Doc();
          Y.applyUpdate(d, bytes);
          return getBoardElements(d).get('e1')?.version;
        },
        { timeout: 5000 },
      )
      .toBe(1);
    a.destroy();
  });

  it('notes are persisted under the notes key', async () => {
    const s = await setup('live');
    const n = connectClient(kit, docName.notes(s.id), 'ada');
    await n.synced;
    n.doc.getXmlFragment('content').insert(0, [new Y.XmlText('hello')]);
    await expect
      .poll(() => kit.stores.blobs.getBytes(blobKeys.sessionNotesLatest('default', s.id)), { timeout: 5000 })
      .not.toBeNull();
    n.destroy();
  });
});
