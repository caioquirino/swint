import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import type { Identity } from '@swint/api-util-rpc';
import type { SessionRecord } from '@swint/api-data-access-persistence';
import { createTestStores, type TestStores } from '@swint/api-data-access-persistence/testing';
import type { SessionStatus } from '@swint/shared-domain';
import { createCollabServer, type CollabLogger, type CollabServer, type CollabServerDeps } from '../lib/collab-server.js';

export interface CollabTestKit {
  url: string;
  stores: TestStores;
  collab: CollabServer;
  /** Cookie header value → identity (fake resolver). */
  identities: Map<string, Identity>;
  close(): Promise<void>;
}

const silentLogger: CollabLogger = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };

export async function startCollabTestKit(
  opts: Partial<Pick<CollabServerDeps, 'debounceMs' | 'maxDebounceMs' | 'checkpointIntervalMs'>> & { now?: () => number } = {},
): Promise<CollabTestKit> {
  const stores = await createTestStores();
  const identities = new Map<string, Identity>();
  const collab = createCollabServer({
    sessions: stores.sessions,
    blobs: stores.blobs,
    resolveIdentity: async (h) => (h ? (identities.get(h) ?? null) : null),
    clock: { now: opts.now ?? Date.now },
    logger: silentLogger,
    debounceMs: opts.debounceMs,
    maxDebounceMs: opts.maxDebounceMs,
    checkpointIntervalMs: opts.checkpointIntervalMs,
  });
  const http = createServer();
  collab.attach(http);
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  const { port } = http.address() as AddressInfo;
  return {
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
