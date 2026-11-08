import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { docName, getBoardElements, parseServerMessage } from '@swint/shared-collab-protocol';
import { blobKeys } from '@swint/api-data-access-persistence';
import { COOKIE } from '@swint/api-feature-auth';
import { setup, templateBody, type TestApp } from '../test/app-test-setup.js';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

/**
 * Provider wired with a Cookie header. In @hocuspocus/provider 4.8 `WebSocketPolyfill` is an option of
 * `HocuspocusProviderWebsocket`, so the socket is built explicitly and the provider attached to it.
 */
function connect(port: number, name: string, cookie: string) {
  const doc = new Y.Doc();
  const stateless: string[] = [];
  let resolveSynced!: () => void;
  let resolveClosed!: (e: unknown) => void;
  const synced = new Promise<void>((r) => (resolveSynced = r));
  const closed = new Promise<unknown>((r) => (resolveClosed = r));
  class CookieWebSocket extends WebSocket {
    constructor(url: string) {
      super(url, { headers: { cookie } });
      this.on('error', () => undefined);
    }
  }
  const socket = new HocuspocusProviderWebsocket({
    url: `ws://127.0.0.1:${port}/collab`,
    WebSocketPolyfill: CookieWebSocket,
    onClose: ({ event }) => resolveClosed({ code: event?.code, reason: event?.reason }),
  });
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name,
    document: doc,
    token: 'cookie',
    onSynced: ({ state }) => {
      if (state) resolveSynced();
    },
    onStateless: ({ payload }) => {
      stateless.push(payload);
    },
  });
  provider.attach();
  return {
    doc,
    provider,
    stateless,
    synced,
    closed,
    destroy: () => {
      provider.destroy();
      socket.destroy();
      doc.destroy();
    },
  };
}

/** Follows an invite link and returns the candidate cookie as a Cookie header. */
async function candidateCookie(app: TestApp, token: string): Promise<string> {
  const join = await app.server.inject({ method: 'GET', url: `/join/${token}` });
  const cand = join.cookies.find((c) => c.name === COOKIE.candidate);
  expect(cand).toBeDefined();
  return cookieHeader({ [COOKIE.candidate]: cand?.value ?? '' });
}

/** HTTP status of a refused WebSocket upgrade (rejects if the upgrade succeeds). */
function upgradeStatus(port: number, cookie?: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/collab`, cookie ? { headers: { cookie } } : {});
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
    ws.on('open', () => {
      ws.close();
      reject(new Error('unexpectedly opened'));
    });
    ws.on('error', () => undefined);
  });
}

async function liveSession(app: TestApp) {
  const ic = await app.interviewerCookie();
  const tpl = (await app.server.inject({ method: 'POST', url: '/api/templates', cookies: ic, payload: templateBody })).json();
  const created = (
    await app.server.inject({ method: 'POST', url: '/api/sessions', cookies: ic, payload: { templateId: tpl.id, candidateName: 'Bo' } })
  ).json();
  const id: string = created.session.id;
  expect((await app.server.inject({ method: 'POST', url: `/api/sessions/${id}/start`, cookies: ic })).statusCode).toBe(200);
  const token = new URL(created.candidateUrl).pathname.split('/').pop() as string;
  return { id, ic, token };
}

describe('collab over the real API server', () => {
  it('interviewers get session.state on connect, the ended state after POST /end, then become read-only', async () => {
    t = await setup({ listen: true });
    const { id, ic } = await liveSession(t);
    const ic2 = await t.interviewerCookie('sub-2');
    const a = connect(t.port, docName.board(id), cookieHeader(ic));
    const b = connect(t.port, docName.board(id), cookieHeader(ic2));
    await Promise.all([a.synced, b.synced]);
    await expect.poll(() => a.stateless.length).toBeGreaterThan(0);
    expect(parseServerMessage(a.stateless[0])).toMatchObject({ type: 'session.state', status: 'live' });

    expect((await t.server.inject({ method: 'POST', url: `/api/sessions/${id}/end`, cookies: ic })).statusCode).toBe(200);
    await expect.poll(() => a.stateless.map((p) => parseServerMessage(p)?.status)).toContain('ended');
    await expect.poll(() => b.stateless.map((p) => parseServerMessage(p)?.status)).toContain('ended');

    getBoardElements(a.doc).set('late', { id: 'late', version: 1, versionNonce: 1, index: 'a0', isDeleted: false });
    await new Promise((r) => setTimeout(r, 300));
    expect(getBoardElements(b.doc).get('late')).toBeUndefined();
    a.destroy();
    b.destroy();
  });

  it('candidate cookie from /join connects to the live board and is disconnected when the session ends', async () => {
    t = await setup({ listen: true });
    const { id, ic, token } = await liveSession(t);
    const join = await t.server.inject({ method: 'GET', url: `/join/${token}` });
    const cand = join.cookies.find((c) => c.name === COOKIE.candidate);
    expect(cand).toBeDefined();
    const c = connect(t.port, docName.board(id), cookieHeader({ [COOKIE.candidate]: cand?.value ?? '' }));
    await c.synced;
    expect((await t.server.inject({ method: 'POST', url: `/api/sessions/${id}/end`, cookies: ic })).statusCode).toBe(200);
    await expect(c.closed).resolves.toBeDefined();
    c.destroy();
  });

  it('regenerating the invite disconnects the connected candidate (4403 invite_revoked); the old cookie gets 401, the new link works', async () => {
    t = await setup({ listen: true });
    const { id, ic, token } = await liveSession(t);
    const oldCookie = await candidateCookie(t, token);
    const c = connect(t.port, docName.board(id), oldCookie);
    await c.synced;

    const regen = await t.server.inject({ method: 'POST', url: `/api/sessions/${id}/invite`, cookies: ic });
    expect(regen.statusCode).toBe(200);
    await expect(c.closed).resolves.toMatchObject({ code: 4403, reason: 'invite_revoked' });
    c.destroy();

    // A fresh upgrade with the superseded candidate cookie: the resolver finds no identity → 401.
    expect(await upgradeStatus(t.port, oldCookie)).toBe(401);

    const newToken = new URL(regen.json().candidateUrl).pathname.split('/').pop() as string;
    const fresh = connect(t.port, docName.board(id), await candidateCookie(t, newToken));
    await fresh.synced;
    fresh.destroy();
  });

  it('upgrade without cookies is rejected with 401 and the server keeps serving', async () => {
    t = await setup({ listen: true });
    const status = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${t?.port}/collab`);
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('open', () => reject(new Error('unexpectedly opened')));
      ws.on('error', () => undefined);
    });
    expect(status).toBe(401);
    expect((await t.server.inject({ method: 'GET', url: '/healthz' })).json()).toEqual({ ok: true });
  });

  it('app.close() flushes pending board changes to S3', async () => {
    t = await setup({ listen: true });
    const { id, ic } = await liveSession(t);
    const a = connect(t.port, docName.board(id), cookieHeader(ic));
    await a.synced;
    getBoardElements(a.doc).set('flushed', { id: 'flushed', version: 1, versionNonce: 1, index: 'a0', isDeleted: false });
    await new Promise((r) => setTimeout(r, 100)); // let the update reach the server, well below the 2 s debounce
    const blobs = t.repos.blobs;
    const app = t;
    t = undefined;
    a.destroy();
    await app.close();
    const bytes = await blobs.getBytes(blobKeys.sessionBoardLatest('default', id));
    expect(bytes).not.toBeNull();
    const d = new Y.Doc();
    Y.applyUpdate(d, bytes as Uint8Array);
    expect(getBoardElements(d).get('flushed')).toMatchObject({ version: 1 });
  });
});
