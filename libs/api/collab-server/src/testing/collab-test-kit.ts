import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import type { Identity } from '@swint/api-util-rpc';
import type { SessionRecord, SessionsRepo } from '@swint/api-data-access-persistence';
import { createTestStores, type TestStores } from '@swint/api-data-access-persistence/testing';
import type { SessionStatus } from '@swint/shared-domain';
import { createCollabServer, type CollabLogger, type CollabServer, type CollabServerDeps } from '../lib/collab-server.js';

export interface CollabTestKit {
  url: string;
  stores: TestStores;
  collab: CollabServer;
  /** Cookie header value → identity (fake resolver). */
  identities: Map<string, Identity>;
  /** While true, every blob write through the collab server fails. */
  failPuts: boolean;
  /** While true, blob writes through the collab server never settle. */
  hangPuts: boolean;
  /** Number of blob writes attempted through the collab server. */
  putCalls: number;
  /** Messages passed to the logger at error level. */
  errors: object[];
  /** While true, every `sessions.get` through the collab server throws (e.g. DynamoDB down). */
  failSessionGets: boolean;
  /** Runs after each `sessions.get` through the collab server reads the record, before it is returned. */
  afterSessionGet: ((rec: SessionRecord | null) => Promise<void>) | null;
  /** Number of distinct board checkpoints (by key, so retries of one write count once) attempted for a session. */
  checkpointsWritten(sessionId: string): number;
  close(): Promise<void>;
}

const silentLogger: CollabLogger = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };

export async function startCollabTestKit(
  opts: Partial<
    Pick<CollabServerDeps, 'debounceMs' | 'maxDebounceMs' | 'checkpointIntervalMs' | 'sleep' | 'storeRetryMs' | 'shutdownTimeoutMs'>
  > & {
    now?: () => number;
    /** Reuse existing stores (simulates a server restart over the same table and bucket). */
    stores?: TestStores;
  } = {},
): Promise<CollabTestKit> {
  const stores = opts.stores ?? (await createTestStores());
  const errors: object[] = [];
  const state = {
    failPuts: false,
    hangPuts: false,
    putCalls: 0,
    failSessionGets: false,
    afterSessionGet: null as CollabTestKit['afterSessionGet'],
  };
  const checkpoints = new Map<string, Set<string>>();
  const checkpointKey = /\/sessions\/([^/]+)\/board\/checkpoints\//;
  const blobs = new Proxy(stores.blobs, {
    get(target, prop, receiver) {
      if (prop === 'putBytes') {
        return async (...args: Parameters<typeof target.putBytes>) => {
          state.putCalls++;
          const m = checkpointKey.exec(args[0]);
          if (m) checkpoints.set(m[1], (checkpoints.get(m[1]) ?? new Set()).add(args[0]));
          if (state.hangPuts) return new Promise<void>(() => undefined);
          if (state.failPuts) throw new Error('injected s3 failure');
          return target.putBytes(...args);
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  const sessions: SessionsRepo = {
    ...stores.sessions,
    async get(orgId, id) {
      if (state.failSessionGets) throw new Error('injected dynamodb failure');
      const rec = await stores.sessions.get(orgId, id);
      await state.afterSessionGet?.(rec);
      return rec;
    },
  };
  const identities = new Map<string, Identity>();
  const collab = createCollabServer({
    sessions,
    blobs,
    resolveIdentity: async (h) => (h ? (identities.get(h) ?? null) : null),
    clock: { now: opts.now ?? Date.now },
    logger: { ...silentLogger, error: (o) => void errors.push(o) },
    sleep: opts.sleep,
    storeRetryMs: opts.storeRetryMs,
    shutdownTimeoutMs: opts.shutdownTimeoutMs,
    debounceMs: opts.debounceMs,
    maxDebounceMs: opts.maxDebounceMs,
    checkpointIntervalMs: opts.checkpointIntervalMs,
  });
  const http = createServer();
  collab.attach(http);
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  const { port } = http.address() as AddressInfo;
  return {
    get failPuts() {
      return state.failPuts;
    },
    set failPuts(v: boolean) {
      state.failPuts = v;
    },
    get putCalls() {
      return state.putCalls;
    },
    get hangPuts() {
      return state.hangPuts;
    },
    set hangPuts(v: boolean) {
      state.hangPuts = v;
    },
    get failSessionGets() {
      return state.failSessionGets;
    },
    set failSessionGets(v: boolean) {
      state.failSessionGets = v;
    },
    get afterSessionGet() {
      return state.afterSessionGet;
    },
    set afterSessionGet(v: CollabTestKit['afterSessionGet']) {
      state.afterSessionGet = v;
    },
    checkpointsWritten: (sessionId) => checkpoints.get(sessionId)?.size ?? 0,
    errors,
    url: `ws://127.0.0.1:${port}/collab`,
    stores,
    collab,
    identities,
    async close() {
      await collab.close();
      http.closeAllConnections();
      await new Promise<void>((r, j) => http.close((e) => (e ? j(e) : r())));
    },
  };
}

export interface TestClient {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  /** Stateless payloads received from the server. */
  stateless: string[];
  /** Resolves with the server's rejection reason. */
  authFailure: Promise<string>;
  synced: Promise<void>;
  /** Resolves on the first close of the underlying socket (incl. a refused upgrade). */
  closed: Promise<{ code?: number; reason?: string }>;
  destroy(): void;
}

/**
 * Connects a provider to the kit. `WebSocketPolyfill` is a `HocuspocusProviderWebsocket` option in
 * @hocuspocus/provider 4.8, so the socket provider is built explicitly and handed to the provider.
 */
export function connectClient(kit: CollabTestKit, documentName: string, cookie: string | null): TestClient {
  class CookieWebSocket extends WebSocket {
    constructor(url: string) {
      super(url, { headers: cookie ? { cookie } : {} });
      // A refused upgrade emits 'error' before 'close'; swallow it so it doesn't surface as unhandled.
      this.on('error', () => undefined);
    }
  }
  const doc = new Y.Doc();
  const stateless: string[] = [];
  let onAuthFailure!: (reason: string) => void;
  let onSynced!: () => void;
  let onClosed!: (e: { code?: number; reason?: string }) => void;
  const authFailure = new Promise<string>((r) => (onAuthFailure = r));
  const synced = new Promise<void>((r) => (onSynced = r));
  const closed = new Promise<{ code?: number; reason?: string }>((r) => (onClosed = r));

  const socket = new HocuspocusProviderWebsocket({
    url: kit.url,
    WebSocketPolyfill: CookieWebSocket,
    onClose: ({ event }) => onClosed({ code: event?.code, reason: event?.reason }),
  });
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: documentName,
    document: doc,
    token: 'cookie',
    onAuthenticationFailed: ({ reason }) => onAuthFailure(reason),
    onSynced: ({ state }) => {
      if (state) onSynced();
    },
    onStateless: ({ payload }) => {
      stateless.push(payload);
    },
  });
  // With an external websocketProvider the provider does not attach itself.
  provider.attach();

  return {
    doc,
    provider,
    stateless,
    authFailure,
    synced,
    closed,
    destroy() {
      provider.destroy();
      socket.destroy();
      doc.destroy();
    },
  };
}

export async function seedSession(
  kit: CollabTestKit,
  rec: Partial<SessionRecord> & { id: string; status: SessionStatus },
): Promise<SessionRecord> {
  const full: SessionRecord = {
    orgId: 'default',
    templateId: 't1',
    templateSnapshot: { title: 'T', instructionsMd: '', rubricMd: '', durationMin: 45, boardSeedKey: null },
    candidateName: 'Bo',
    startedAt: rec.status === 'created' ? null : Date.now(),
    durationSec: 2700,
    extensionSec: 0,
    endedAt: null,
    endedBy: null,
    cancelReason: null,
    activeInviteHash: 'h',
    createdBy: 'sub-1',
    createdAt: Date.now(),
    version: 1,
    ...rec,
  };
  await kit.stores.sessions.create(full);
  return full;
}
