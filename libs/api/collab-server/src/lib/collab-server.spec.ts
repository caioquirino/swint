import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { blobKeys } from '@swint/api-data-access-persistence';
import {
  AWARENESS_USER_FIELD,
  candidateUserId,
  colorForUser,
  getBoardElements,
  parseServerMessage,
  docName,
} from '@swint/shared-collab-protocol';
import type { Identity } from '@swint/api-util-rpc';
import { connectClient, seedSession, startCollabTestKit, type CollabTestKit } from '../testing/collab-test-kit.js';

const ada: Identity = { kind: 'interviewer', sub: 'sub-1', name: 'Ada', email: null, orgId: 'default', roles: ['interviewer'] };
const bo = (sessionId: string): Identity => ({ kind: 'candidate', sessionId, orgId: 'default', inviteHash: 'h', name: 'Bo' });

let kit: CollabTestKit;
afterEach(async () => {
  await kit?.close();
});

async function setup(status: 'created' | 'live' | 'ended' = 'live', kitOpts: Parameters<typeof startCollabTestKit>[0] = {}) {
  kit = await startCollabTestKit({ debounceMs: 50, maxDebounceMs: 200, ...kitOpts });
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
    await expect.poll(() => kit.stores.blobs.getBytes(blobKeys.sessionNotesLatest('default', s.id)), { timeout: 5000 }).not.toBeNull();
    n.destroy();
  });

  it('keeps the document loaded and dirty while S3 fails, and stores once it recovers', async () => {
    const s = await setup('live', { sleep: async () => undefined, storeRetryMs: 50 });
    kit.failPuts = true;
    const name = docName.board(s.id);
    const a = connectClient(kit, name, 'ada');
    await a.synced;
    getBoardElements(a.doc).set('e1', { id: 'e1', version: 1, versionNonce: 1, index: 'a0', isDeleted: false });
    await expect.poll(() => kit.errors.length, { timeout: 5000 }).toBeGreaterThan(0);
    expect(kit.errors[0]).toMatchObject({ sessionId: s.id });
    a.destroy();
    await new Promise((r) => setTimeout(r, 500));
    expect(kit.collab.hocuspocus.documents.has(name)).toBe(true);
    kit.failPuts = false;
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
  });

  it('edits survive a server restart over the same stores', async () => {
    const s = await setup('live');
    const a = connectClient(kit, docName.board(s.id), 'ada');
    await a.synced;
    getBoardElements(a.doc).set('e1', { id: 'e1', version: 4, versionNonce: 1, index: 'a0', isDeleted: false });
    await expect
      .poll(async () => (await kit.stores.blobs.getBytes(blobKeys.sessionBoardLatest('default', s.id))) !== null, { timeout: 5000 })
      .toBe(true);
    a.destroy();
    const stores = kit.stores;
    await kit.close();
    kit = await startCollabTestKit({ debounceMs: 50, maxDebounceMs: 200, stores });
    kit.identities.set('ada', ada);
    const b = connectClient(kit, docName.board(s.id), 'ada');
    await b.synced;
    expect(getBoardElements(b.doc).get('e1')).toMatchObject({ version: 4 });
    b.destroy();
  });

  it('retries a store that failed during the flush on last disconnect', async () => {
    const s = await setup('live', { sleep: async () => undefined, storeRetryMs: 50, debounceMs: 10_000, maxDebounceMs: 20_000 });
    kit.failPuts = true;
    const name = docName.board(s.id);
    const a = connectClient(kit, name, 'ada');
    await a.synced;
    getBoardElements(a.doc).set('e1', { id: 'e1', version: 1, versionNonce: 1, index: 'a0', isDeleted: false });
    await new Promise((r) => setTimeout(r, 100)); // let the update reach the server
    a.destroy(); // the store is still debounced: Hocuspocus flushes it now, and it fails
    await expect.poll(() => kit.errors.length, { timeout: 5000 }).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 300));
    expect(kit.collab.hocuspocus.documents.has(name)).toBe(true);
    kit.failPuts = false;
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
    await expect.poll(() => kit.collab.hocuspocus.documents.has(name), { timeout: 5000 }).toBe(false);
  });

  it('close() with failing S3 reports unsaved documents once and leaves no retry running', async () => {
    const s = await setup('live', { sleep: async () => undefined, storeRetryMs: 50 });
    kit.failPuts = true;
    const name = docName.board(s.id);
    const a = connectClient(kit, name, 'ada');
    await a.synced;
    getBoardElements(a.doc).set('e1', { id: 'e1', version: 1, versionNonce: 1, index: 'a0', isDeleted: false });
    await expect.poll(() => kit.errors.length, { timeout: 5000 }).toBeGreaterThan(0);
    const t0 = Date.now();
    await kit.collab.close();
    expect(Date.now() - t0).toBeLessThan(8000);
    const entries = kit.errors.filter((e) => 'unsaved' in e);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ unsaved: [name], count: 1 });
    const calls = kit.putCalls;
    await new Promise((r) => setTimeout(r, 400));
    expect(kit.putCalls).toBe(calls);
    a.destroy();
  });

  async function threeDirtyDocs(mode: 'hang' | 'fail') {
    const first = await setup('live', { shutdownTimeoutMs: 1500, storeRetryMs: 60_000 });
    const sessions = [
      first,
      await seedSession(kit, { id: 'extra-1', status: 'live' }),
      await seedSession(kit, { id: 'extra-2', status: 'live' }),
    ];
    if (mode === 'hang') kit.hangPuts = true;
    else kit.failPuts = true;
    const clients = [];
    for (const s of sessions) {
      const c = connectClient(kit, docName.board(s.id), 'ada');
      await c.synced;
      getBoardElements(c.doc).set('e1', { id: 'e1', version: 1, versionNonce: 1, index: 'a0', isDeleted: false });
      clients.push(c);
    }
    // failing puts: wait until the (real-sleep) retries are exhausted for all three documents
    if (mode === 'fail') await expect.poll(() => kit.errors.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(3);
    else await new Promise((r) => setTimeout(r, 300));
    return { sessions, clients };
  }

  it('close() is bounded when S3 puts hang', async () => {
    const { sessions, clients } = await threeDirtyDocs('hang');
    const t0 = Date.now();
    await kit.collab.close();
    expect(Date.now() - t0).toBeLessThan(2000);
    const entry = kit.errors.find((e) => 'unsaved' in e) as { unsaved: string[]; count: number };
    expect(entry.count).toBe(3);
    expect([...entry.unsaved].sort()).toEqual(sessions.map((s) => docName.board(s.id)).sort());
    clients.forEach((c) => c.destroy());
  });

  it('close() is bounded when S3 puts fail, with one final attempt per document', async () => {
    const { sessions, clients } = await threeDirtyDocs('fail');
    const before = kit.putCalls;
    const t0 = Date.now();
    await kit.collab.close();
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(kit.putCalls - before).toBe(3);
    const entry = kit.errors.find((e) => 'unsaved' in e) as { unsaved: string[]; count: number };
    expect(entry.count).toBe(3);
    expect([...entry.unsaved].sort()).toEqual(sessions.map((s) => docName.board(s.id)).sort());
    clients.forEach((c) => c.destroy());
  });

  it('refuses new upgrades once close() has begun', async () => {
    const { clients } = await threeDirtyDocs('hang');
    const closing = kit.collab.close();
    const late = connectClient(kit, docName.board('extra-1'), 'ada');
    const outcome = await Promise.race([late.synced.then(() => 'synced'), late.closed.then(() => 'closed')]);
    expect(outcome).toBe('closed');
    await closing;
    late.destroy();
    clients.forEach((c) => c.destroy());
  });
});

async function until(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('collab server: presence', () => {
  it('stamps awareness with the connection identity, so names and roles cannot be spoofed', async () => {
    const s = await setup('live');
    const interviewer = connectClient(kit, docName.board(s.id), 'ada');
    const candidate = connectClient(kit, docName.board(s.id), 'bo');
    await Promise.all([interviewer.synced, candidate.synced]);

    candidate.provider.awareness?.setLocalStateField(AWARENESS_USER_FIELD, {
      userId: 'sub-1',
      name: 'Mallory',
      role: 'interviewer',
      color: '#000000',
      selectedElementIds: {},
      pointer: { x: 3, y: 4, tool: 'pointer' },
    });
    const candidateClientId = candidate.provider.awareness?.clientID as number;

    const seen = () => interviewer.provider.awareness?.getStates().get(candidateClientId)?.[AWARENESS_USER_FIELD];
    await until(() => seen() !== undefined);
    expect(seen()).toEqual({
      userId: candidateUserId(s.id),
      name: 'Bo',
      role: 'candidate',
      color: colorForUser(candidateUserId(s.id)),
      selectedElementIds: {},
      pointer: { x: 3, y: 4, tool: 'pointer' },
    });

    interviewer.provider.awareness?.setLocalStateField(AWARENESS_USER_FIELD, { name: 'Someone else' });
    const interviewerClientId = interviewer.provider.awareness?.clientID as number;
    const seenByCandidate = () =>
      candidate.provider.awareness?.getStates().get(interviewerClientId)?.[AWARENESS_USER_FIELD] as
        { name?: string; role?: string } | undefined;
    await until(() => seenByCandidate()?.name === 'Ada');
    expect(seenByCandidate()).toMatchObject({ userId: 'sub-1', name: 'Ada', role: 'interviewer' });

    interviewer.destroy();
    candidate.destroy();
  });

  async function threePeers() {
    const s = await setup('live');
    const interviewer = connectClient(kit, docName.board(s.id), 'ada');
    const candidate = connectClient(kit, docName.board(s.id), 'bo');
    kit.identities.set('ada2', ada);
    const observer = connectClient(kit, docName.board(s.id), 'ada2');
    await Promise.all([interviewer.synced, candidate.synced, observer.synced]);
    interviewer.provider.awareness?.setLocalStateField(AWARENESS_USER_FIELD, { pointer: { x: 1, y: 1, tool: 'pointer' } });
    const adaId = interviewer.provider.awareness?.clientID as number;
    const seen = () =>
      observer.provider.awareness?.getStates().get(adaId)?.[AWARENESS_USER_FIELD] as { name?: string; pointer?: { x: number } } | undefined;
    await until(() => seen()?.name === 'Ada');
    return { interviewer, candidate, observer, adaId, seen };
  }

  /**
   * Sends a hand-built awareness message through the client's socket, as a malicious client would.
   * Wire format: varString name, varUint 1 (Awareness), varUint8Array(update); update = varUint n,
   * then per client varUint clientID, varUint clock, varString JSON state ('null' = removal).
   */
  function sendForgedAwareness(c: ReturnType<typeof connectClient>, entries: { clientId: number; clock: number; state: unknown }[]): void {
    const bytes: number[] = [];
    const varUint = (n: number) => {
      while (n > 127) {
        bytes.push(128 | (n & 127));
        n = Math.floor(n / 128);
      }
      bytes.push(n);
    };
    const varString = (str: string) => {
      const b = new TextEncoder().encode(str);
      varUint(b.length);
      bytes.push(...b);
    };
    const inner: number[] = [];
    const saved = bytes.splice(0);
    varUint(entries.length);
    for (const e of entries) {
      varUint(e.clientId);
      varUint(e.clock);
      varString(JSON.stringify(e.state));
    }
    inner.push(...bytes.splice(0));
    bytes.push(...saved);
    varString(c.provider.effectiveName);
    varUint(1);
    varUint(inner.length);
    bytes.push(...inner);
    (c.provider.configuration.websocketProvider as unknown as { send(d: Uint8Array): void }).send(new Uint8Array(bytes));
  }

  it('ignores a candidate state sent under the interviewer clientID', async () => {
    const { interviewer, candidate, observer, adaId, seen } = await threePeers();
    sendForgedAwareness(candidate, [
      { clientId: adaId, clock: 1000, state: { [AWARENESS_USER_FIELD]: { name: 'Mallory', pointer: { x: 99, y: 99, tool: 'pointer' } } } },
    ]);
    // A later honest update from the candidate proves the forged message was processed before we assert.
    candidate.provider.awareness?.setLocalStateField(AWARENESS_USER_FIELD, { pointer: { x: 5, y: 5, tool: 'pointer' } });
    const candId = candidate.provider.awareness?.clientID as number;
    await until(() => observer.provider.awareness?.getStates().get(candId) !== undefined);
    await new Promise((r) => setTimeout(r, 200));
    expect(seen()).toMatchObject({ name: 'Ada', pointer: { x: 1 } });
    interviewer.destroy();
    candidate.destroy();
    observer.destroy();
  });

  it('ignores a candidate removal of the interviewer clientID', async () => {
    const { interviewer, candidate, observer, adaId, seen } = await threePeers();
    sendForgedAwareness(candidate, [{ clientId: adaId, clock: 1000, state: null }]);
    candidate.provider.awareness?.setLocalStateField(AWARENESS_USER_FIELD, { pointer: { x: 5, y: 5, tool: 'pointer' } });
    const candId = candidate.provider.awareness?.clientID as number;
    await until(() => observer.provider.awareness?.getStates().get(candId) !== undefined);
    await new Promise((r) => setTimeout(r, 200));
    expect(seen()).toMatchObject({ name: 'Ada' });
    interviewer.destroy();
    candidate.destroy();
    observer.destroy();
  });
});

describe('collab server: document size cap', () => {
  it('makes a connection read-only once its writes would push the document past the cap; others keep writing', async () => {
    const s = await setup('live', { maxDocumentBytes: 4096 });
    const a = connectClient(kit, docName.board(s.id), 'ada');
    const b = connectClient(kit, docName.board(s.id), 'bo');
    await Promise.all([a.synced, b.synced]);

    getBoardElements(a.doc).set('small', { id: 'small', version: 1, versionNonce: 1, index: 'a0', isDeleted: false });
    await expect.poll(() => getBoardElements(b.doc).get('small')?.version).toBe(1);

    getBoardElements(a.doc).set('big', {
      id: 'big',
      version: 1,
      versionNonce: 1,
      index: 'a1',
      isDeleted: false,
      text: 'x'.repeat(8192),
    } as never);
    getBoardElements(a.doc).set('after', { id: 'after', version: 1, versionNonce: 1, index: 'a2', isDeleted: false });
    await new Promise((r) => setTimeout(r, 300));
    expect(getBoardElements(b.doc).get('big')).toBeUndefined();
    expect(getBoardElements(b.doc).get('after')).toBeUndefined();

    getBoardElements(b.doc).set('fromB', { id: 'fromB', version: 1, versionNonce: 1, index: 'a3', isDeleted: false });
    await expect.poll(() => getBoardElements(a.doc).get('fromB')?.version).toBe(1);
    a.destroy();
    b.destroy();
  });
});
