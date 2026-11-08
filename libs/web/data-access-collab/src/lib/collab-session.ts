import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { docName, parseServerMessage, type SessionStateMessage } from '@swint/shared-collab-protocol';
import { serverOffsetMs, type ParticipantRole } from '@swint/shared-domain';
import { initialConnState, isTerminal, reduceConn, type CollabConnState, type CollabEvent } from './conn-state.js';

export interface CollabDoc {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  awareness: Awareness;
}

export interface SessionStateSnapshot {
  message: SessionStateMessage;
  /** serverNow - clientNow at receipt; add it to Date.now() to get server time. */
  offsetMs: number;
}

export interface CollabSnapshot {
  conn: CollabConnState;
  sessionState: SessionStateSnapshot | null;
  /** Notes rejection reason (interviewers only); the board keeps working. */
  notesError: string | null;
}

export interface CollabSessionOptions {
  sessionId: string;
  role: ParticipantRole;
  /** Default: same-origin `/collab` (ws or wss). */
  url?: string;
  /** Node tests pass the `ws` package. */
  WebSocketPolyfill?: unknown;
  failedOpensBeforeProbe?: number;
  /** Reconnect backoff. `delay` must be ≥ `minDelay`. */
  retry?: { delay: number; minDelay: number; maxDelay: number };
  now?: () => number;
}

export interface CollabSession {
  board: CollabDoc;
  notes: CollabDoc | null;
  getSnapshot(): CollabSnapshot;
  subscribe(listener: () => void): () => void;
  destroy(): void;
}

export type CollabSessionFactory = (opts: CollabSessionOptions) => CollabSession;

export const DEFAULT_RETRY = { delay: 1000, minDelay: 1000, maxDelay: 10_000 };
export const DEFAULT_FAILED_OPENS_BEFORE_PROBE = 3;

export function defaultCollabUrl(loc: Pick<Location, 'protocol' | 'host'> = window.location): string {
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/collab`;
}

/**
 * One WebSocket per room, multiplexing the board (and, for interviewers, notes) documents.
 * Implements the client side of the real-time contract (libs/shared/collab-protocol/README.md).
 */
export function createCollabSession(opts: CollabSessionOptions): CollabSession {
  const now = opts.now ?? Date.now;
  const threshold = opts.failedOpensBeforeProbe ?? DEFAULT_FAILED_OPENS_BEFORE_PROBE;
  const retry = opts.retry ?? DEFAULT_RETRY;
  const listeners = new Set<() => void>();
  let snapshot: CollabSnapshot = { conn: initialConnState, sessionState: null, notesError: null };
  let destroyed = false;
  let tornDown = false;

  const set = (patch: Partial<CollabSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of [...listeners]) listener();
  };

  const dispatch = (event: CollabEvent) => {
    if (destroyed) return;
    const conn = reduceConn(snapshot.conn, event, threshold);
    if (conn === snapshot.conn) return;
    set({ conn });
    if (isTerminal(conn.phase)) teardown();
  };

  const socket = new HocuspocusProviderWebsocket({
    url: opts.url ?? defaultCollabUrl(),
    ...(opts.WebSocketPolyfill ? { WebSocketPolyfill: opts.WebSocketPolyfill } : {}),
    delay: retry.delay,
    minDelay: retry.minDelay,
    maxDelay: retry.maxDelay,
    onOpen: () => dispatch({ type: 'open' }),
    onClose: ({ event }) => dispatch({ type: 'close', code: event?.code ?? 1006, reason: event?.reason ?? '' }),
  });

  const makeDoc = (
    name: string,
    extra: Partial<ConstructorParameters<typeof HocuspocusProvider>[0]>,
  ): CollabDoc => {
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({ websocketProvider: socket, name, document: doc, token: 'cookie', ...extra });
    // With an external websocketProvider the provider does not attach itself.
    provider.attach();
    const awareness = provider.awareness;
    if (!awareness) throw new Error('provider has no awareness');
    return { doc, provider, awareness };
  };

  const board = makeDoc(docName.board(opts.sessionId), {
    onAuthenticated: ({ scope }) => dispatch({ type: 'authenticated', readOnly: scope === 'readonly' }),
    onAuthenticationFailed: ({ reason }) => dispatch({ type: 'authFailed', reason }),
    onStateless: ({ payload }) => {
      const message = parseServerMessage(payload);
      if (message?.type === 'session.state') {
        set({ sessionState: { message, offsetMs: serverOffsetMs(message.serverNow, now()) } });
      }
    },
  });

  const notes =
    opts.role === 'interviewer'
      ? makeDoc(docName.notes(opts.sessionId), {
          onAuthenticationFailed: ({ reason }) => set({ notesError: reason }),
        })
      : null;

  function teardown() {
    if (tornDown) return;
    tornDown = true;
    board.provider.destroy();
    notes?.provider.destroy();
    socket.destroy();
  }

  return {
    board,
    notes,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      teardown();
      board.doc.destroy();
      notes?.doc.destroy();
      listeners.clear();
    },
  };
}
