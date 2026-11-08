import { afterEach, describe, expect, it } from 'vitest';
import { docName, getBoardElements, parseServerMessage } from '@swint/shared-collab-protocol';
import type { SessionRecord } from '@swint/api-data-access-persistence';
import type { Identity } from '@swint/api-util-rpc';
import { connectClient, seedSession, startCollabTestKit, type CollabTestKit, type TestClient } from '../testing/collab-test-kit.js';

const ada: Identity = { kind: 'interviewer', sub: 'sub-1', name: 'Ada', email: null, orgId: 'default', roles: ['interviewer'] };
const grace: Identity = { kind: 'interviewer', sub: 'sub-2', name: 'Grace', email: null, orgId: 'default', roles: ['interviewer'] };
let kit: CollabTestKit;
afterEach(async () => kit?.close());

async function live(opts: Parameters<typeof startCollabTestKit>[0] = {}, status: 'live' | 'created' = 'live') {
  kit = await startCollabTestKit({ debounceMs: 50, maxDebounceMs: 200, ...opts });
  const s = await seedSession(kit, {
    id: `s-${Math.random().toString(36).slice(2, 8)}`,
    status,
    startedAt: status === 'live' ? 1000 : null,
  });
  kit.identities.set('ada', ada);
  kit.identities.set('grace', grace);
  kit.identities.set('bo', { kind: 'candidate', sessionId: s.id, orgId: 'default', inviteHash: 'h', name: 'Bo' });
  return s;
}

/** Ends the session in the repo (as the sessions router would) and returns the stored record. */
const endInRepo = (s: SessionRecord) =>
  kit.stores.sessions.update({ ...s, status: 'ended', endedAt: 5000, endedBy: 'sub-1' }, s.version);

const statuses = (c: TestClient) => c.stateless.map((p) => parseServerMessage(p)?.status);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hasErrorFor = (sessionId: string) => () =>
  kit.errors.some((e) => (e as { sessionId?: string }).sessionId === sessionId && 'err' in e);

describe('sessionChanged', () => {
  it('broadcasts session.state to every board connection', async () => {
    const s = await live();
    const a = connectClient(kit, docName.board(s.id), 'ada');
    const b = connectClient(kit, docName.board(s.id), 'bo');
    await Promise.all([a.synced, b.synced]);
    const [na, nb] = [a.stateless.length, b.stateless.length];
    await kit.collab.events.sessionChanged({ ...s, extensionSec: 600, version: 2 });
    await expect.poll(() => a.stateless.length).toBe(na + 1);
    await expect.poll(() => b.stateless.length).toBe(nb + 1);
    expect(parseServerMessage(a.stateless.at(-1) ?? '')).toMatchObject({ status: 'live', extensionSec: 600 });
    a.destroy();
    b.destroy();
  });

  it('on end: candidate gets the final state then is disconnected; interviewers become read-only; final checkpoint written', async () => {
    const s = await live();
    const a = connectClient(kit, docName.board(s.id), 'ada');
    const g = connectClient(kit, docName.board(s.id), 'grace');
    const b = connectClient(kit, docName.board(s.id), 'bo');
    await Promise.all([a.synced, g.synced, b.synced]);

    await kit.collab.events.sessionChanged({ ...s, status: 'ended', endedAt: 5000, endedBy: 'sub-1', version: 3 });

    await expect.poll(() => statuses(b)).toContain('ended');
    // The underlying socket is closed with the application close code, not Hocuspocus's 1000.
    await expect(b.closed).resolves.toEqual({ code: 4403, reason: 'session_ended' });

    getBoardElements(a.doc).set('late', { id: 'late', version: 1, versionNonce: 1, index: 'a0', isDeleted: false });
    await sleep(300);
    expect(getBoardElements(g.doc).get('late')).toBeUndefined();

    await expect.poll(() => kit.checkpointsWritten(s.id)).toBeGreaterThanOrEqual(1);
    a.destroy();
    g.destroy();
    b.destroy();
  });

  it('writes periodic checkpoints while live', async () => {
    const s = await live({ checkpointIntervalMs: 100 });
    const a = connectClient(kit, docName.board(s.id), 'ada');
    await a.synced;
    await expect.poll(() => kit.checkpointsWritten(s.id), { timeout: 3000 }).toBeGreaterThanOrEqual(2);
    a.destroy();
  });

  it('never throws, even if broadcasting fails', async () => {
    const s = await live();
    await expect(
      kit.collab.events.sessionChanged({ ...s, status: 'live', startedAt: null as unknown as number }),
    ).resolves.toBeUndefined();
  });

  it('never throws when the board is loaded and the record is invalid; logs the error with sessionId', async () => {
    const s = await live();
    const a = connectClient(kit, docName.board(s.id), 'ada');
    await a.synced;
    await expect(
      kit.collab.events.sessionChanged({ ...s, status: 'live', startedAt: null as unknown as number }),
    ).resolves.toBeUndefined();
    expect(hasErrorFor(s.id)()).toBe(true);
    a.destroy();
  });

  it('writes the final checkpoint exactly once, and stops periodic checkpoints after end', async () => {
    let tick = 0;
    // Checkpoint keys carry the clock; make every reading distinct so no two writes share a key.
    const s = await live({ checkpointIntervalMs: 100, now: () => Date.now() * 1000 + tick++ });
    const a = connectClient(kit, docName.board(s.id), 'ada');
    await a.synced;
    await expect.poll(() => kit.checkpointsWritten(s.id), { timeout: 3000 }).toBeGreaterThanOrEqual(1);
    const ended = await endInRepo(s);
    const before = kit.checkpointsWritten(s.id);
    await kit.collab.events.sessionChanged(ended);
    // A newer finished record (e.g. a later metadata change) must not write a second final checkpoint.
    await kit.collab.events.sessionChanged({ ...ended, version: ended.version + 1 });
    await expect.poll(() => kit.checkpointsWritten(s.id)).toBe(before + 1);
    await sleep(400);
    expect(kit.checkpointsWritten(s.id)).toBe(before + 1);
    a.destroy();
  });

  it('does not wait on S3 for the final checkpoint; close() is still bounded', async () => {
    const s = await live({ shutdownTimeoutMs: 1000 });
    const a = connectClient(kit, docName.board(s.id), 'ada');
    await a.synced;
    kit.hangPuts = true;
    const t0 = Date.now();
    await kit.collab.events.sessionChanged({ ...s, status: 'ended', endedAt: 5000, endedBy: 'sub-1', version: 2 });
    expect(Date.now() - t0).toBeLessThan(500);
    expect(kit.checkpointsWritten(s.id)).toBe(1);
    a.destroy();
    const c0 = Date.now();
    await kit.collab.close();
    expect(Date.now() - c0).toBeLessThan(2000);
  });

  it('starts periodic checkpoints from the auth record even if later session reads fail', async () => {
    const s = await live({ checkpointIntervalMs: 100 });
    kit.afterSessionGet = async () => {
      kit.afterSessionGet = null;
      kit.failSessionGets = true; // every read after onAuthenticate's fails
    };
    const a = connectClient(kit, docName.board(s.id), 'ada');
    await a.synced;
    await expect.poll(() => kit.checkpointsWritten(s.id), { timeout: 3000 }).toBeGreaterThanOrEqual(2);
    kit.failSessionGets = false;
    a.destroy();
  });

  it('ignores a session record older than one already applied (no stale revert)', async () => {
    const s = await live();
    const a = connectClient(kit, docName.board(s.id), 'ada');
    await a.synced;
    await kit.collab.events.sessionChanged({ ...s, status: 'ended', endedAt: 5000, endedBy: 'sub-1', version: 3 });
    await expect.poll(() => statuses(a).at(-1)).toBe('ended');
    const n = a.stateless.length;
    await kit.collab.events.sessionChanged({ ...s, extensionSec: 600, version: 2 });
    await kit.collab.events.sessionChanged({ ...s, status: 'ended', endedAt: 5000, endedBy: 'sub-1', version: 3 });
    await sleep(200);
    expect(a.stateless.length).toBe(n);
    expect(statuses(a).at(-1)).toBe('ended');
    const board = kit.collab.hocuspocus.documents.get(docName.board(s.id));
    expect(board?.getConnections().map((c) => c.readOnly)).toEqual([true]);
    a.destroy();
  });

  it('starts periodic checkpoints when a loaded board’s session goes live', async () => {
    const s = await live({ checkpointIntervalMs: 100 }, 'created');
    const a = connectClient(kit, docName.board(s.id), 'ada');
    await a.synced;
    await sleep(300);
    expect(kit.checkpointsWritten(s.id)).toBe(0);
    const started = await kit.stores.sessions.update({ ...s, status: 'live', startedAt: 2000 }, s.version);
    await kit.collab.events.sessionChanged(started);
    await expect.poll(() => kit.checkpointsWritten(s.id), { timeout: 3000 }).toBeGreaterThanOrEqual(2);
    a.destroy();
  });
});

describe('checkpoint failures and shutdown', () => {
  it('a failing checkpoint is logged with sessionId and never throws', async () => {
    const s = await live({ checkpointIntervalMs: 100, sleep: async () => undefined });
    const a = connectClient(kit, docName.board(s.id), 'ada');
    await a.synced;
    kit.failPuts = true;
    await expect.poll(hasErrorFor(s.id), { timeout: 3000 }).toBe(true);
    const ended = await endInRepo(s);
    const before = kit.checkpointsWritten(s.id);
    await expect(kit.collab.events.sessionChanged(ended)).resolves.toBeUndefined();
    await expect.poll(() => kit.checkpointsWritten(s.id)).toBeGreaterThan(before);
    kit.failPuts = false;
    a.destroy();
  });

  /** Live board with an unsaved edit (puts failing), so it stays loaded through and after close(). */
  async function boardThatStaysLoaded() {
    const s = await live({ checkpointIntervalMs: 100, sleep: async () => undefined });
    const name = docName.board(s.id);
    const a = connectClient(kit, name, 'ada');
    await a.synced;
    await expect.poll(() => kit.checkpointsWritten(s.id), { timeout: 3000 }).toBeGreaterThanOrEqual(1);
    kit.failPuts = true;
    getBoardElements(a.doc).set('x', { id: 'x', version: 1, versionNonce: 1, index: 'a0', isDeleted: false });
    await sleep(400);
    a.destroy();
    await sleep(100);
    expect(kit.collab.hocuspocus.documents.has(name)).toBe(true);
    return { s, name };
  }

  it('close() stops periodic checkpoints for a board that stays loaded', async () => {
    const { s, name } = await boardThatStaysLoaded();
    const closing = kit.collab.close();
    const n = kit.checkpointsWritten(s.id);
    await closing;
    await sleep(400);
    expect(kit.collab.hocuspocus.documents.has(name)).toBe(true);
    expect(kit.checkpointsWritten(s.id)).toBe(n);
  });

  it('a session ending while close() runs writes no final checkpoint', async () => {
    const { s, name } = await boardThatStaysLoaded();
    const ended = await endInRepo(s);
    const closing = kit.collab.close();
    const n = kit.checkpointsWritten(s.id);
    await kit.collab.events.sessionChanged(ended);
    await closing;
    await sleep(200);
    expect(kit.collab.hocuspocus.documents.has(name)).toBe(true);
    expect(kit.checkpointsWritten(s.id)).toBe(n);
  });
});

describe('authentication edge cases', () => {
  it('an infrastructure failure in onAuthenticate is logged and rejected as forbidden', async () => {
    const s = await live();
    kit.failSessionGets = true;
    const a = connectClient(kit, docName.board(s.id), 'ada');
    await expect(a.authFailure).resolves.toBe('forbidden');
    expect(hasErrorFor(s.id)()).toBe(true);
    a.destroy();
  });

  it('a session that ends between authentication and registration still disconnects the candidate with 4403', async () => {
    const s = await live();
    kit.afterSessionGet = async () => {
      kit.afterSessionGet = null;
      // The change lands after onAuthenticate has read the record but before the connection is registered,
      // so this sessionChanged sees no connection to act on.
      await kit.collab.events.sessionChanged(await endInRepo(s));
    };
    const b = connectClient(kit, docName.board(s.id), 'bo');
    await expect(b.closed).resolves.toEqual({ code: 4403, reason: 'session_ended' });
    expect(statuses(b)).toContain('ended');
    b.destroy();
  });

  it('a stale re-read in connected does not revert a newer state applied meanwhile', async () => {
    const s = await live();
    let reads = 0;
    let ended: SessionRecord | undefined;
    kit.afterSessionGet = async () => {
      reads++;
      if (reads === 1) {
        // Auth read v1; the session is extended (v2) before the connection registers.
        await kit.stores.sessions.update({ ...s, extensionSec: 600 }, s.version);
      } else if ((kit.collab.hocuspocus.documents.get(docName.board(s.id))?.getConnections().length ?? 0) > 0) {
        kit.afterSessionGet = null;
        // The re-read in connected has read v2; before it returns, the session ends (v3) and the
        // router's sessionChanged is applied to the now-registered connection.
        const v2 = await kit.stores.sessions.get(s.orgId, s.id);
        ended = await endInRepo(v2 as SessionRecord);
        await kit.collab.events.sessionChanged(ended);
      }
    };
    const a = connectClient(kit, docName.board(s.id), 'ada');
    await a.synced;
    await expect.poll(() => ended).toBeDefined();
    await expect.poll(() => statuses(a)).toContain('ended');
    await sleep(300);
    expect(statuses(a).at(-1)).toBe('ended');
    const board = kit.collab.hocuspocus.documents.get(docName.board(s.id));
    expect(board?.getConnections().map((c) => c.readOnly)).toEqual([true]);
    a.destroy();
  });

  it('a session that ends between authentication and registration leaves the interviewer read-only with the final state', async () => {
    const s = await live();
    kit.afterSessionGet = async () => {
      kit.afterSessionGet = null;
      await kit.collab.events.sessionChanged(await endInRepo(s));
    };
    const a = connectClient(kit, docName.board(s.id), 'ada');
    await a.synced;
    await expect.poll(() => statuses(a).at(-1)).toBe('ended');
    const board = kit.collab.hocuspocus.documents.get(docName.board(s.id));
    await expect.poll(() => board?.getConnections().map((c) => c.readOnly)).toEqual([true]);
    a.destroy();
  });
});
