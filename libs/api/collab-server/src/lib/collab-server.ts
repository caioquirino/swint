import type { Server } from 'node:http';
import { Hocuspocus, type Connection, type Document } from '@hocuspocus/server';
import * as Y from 'yjs';
import type { BlobStore, SessionRecord, SessionsRepo } from '@swint/api-data-access-persistence';
import type { CookieHeaderIdentityResolver } from '@swint/api-feature-auth';
import type { SessionEvents } from '@swint/api-feature-sessions';
import { docName, type CloseReason } from '@swint/shared-collab-protocol';
import { isFinished } from '@swint/shared-domain';
import type { Clock, Identity } from '@swint/api-util-rpc';
import { CollabAccessError, authorizeDocument, targetOf, type DocTarget } from './access.js';
import { createDocStore } from './doc-store.js';
import type { CollabContext, CollabLogger } from './types.js';
import { sessionStateMessage } from './session-state.js';
import { attachUpgradeHandler, type UpgradeHandle } from './upgrade.js';

export type { CollabContext, CollabLogger } from './types.js';

export interface CollabServerDeps {
  sessions: SessionsRepo;
  blobs: BlobStore;
  resolveIdentity: CookieHeaderIdentityResolver;
  clock: Clock;
  logger: CollabLogger;
  /** Default 2000. */
  debounceMs?: number;
  /** Default 10000. */
  maxDebounceMs?: number;
  /** Periodic board checkpoint interval while the session is live. Default 300000. */
  checkpointIntervalMs?: number;
  /** Delay before retrying the store of an unsaved document whose last client left. Default 5000. */
  storeRetryMs?: number;
  /** Overall budget for close(). Default 8000, to fit inside the API's 10 s shutdown. */
  shutdownTimeoutMs?: number;
  /** Backoff sleep for S3 write retries; defaults to setTimeout. Tests inject a fast one. */
  sleep?: (ms: number) => Promise<void>;
}

export interface CollabServer {
  readonly hocuspocus: Hocuspocus<CollabContext>;
  /** Broadcasts session.state, enforces end of session and writes checkpoints. Never throws. */
  readonly events: SessionEvents & { sessionChanged(rec: SessionRecord): Promise<void> };
  /** Handles WebSocket upgrades on `path` (default '/collab'). */
  attach(httpServer: Server, path?: string): void;
  /** Flushes pending stores, closes connections, then closes the ws server. */
  close(): Promise<void>;
}

/** Context while authenticating; `authSession` is consumed (and removed) by the `connected` hook. */
type AuthContext = CollabContext & { authSession?: SessionRecord };

const SHUTDOWN_POLL_MS = 50;
/** WebSocket close code for a connection closed by policy (application range 4000–4999). */
export const POLICY_CLOSE_CODE = 4403;

export function createCollabServer(deps: CollabServerDeps): CollabServer {
  const { logger } = deps;
  const handles: UpgradeHandle[] = [];
  const docStore = createDocStore({ blobs: deps.blobs, logger, sleep: deps.sleep });
  // lastContext can be absent when a store fires after the last connection left; remember the org per document.
  const orgByDocument = new Map<string, string>();
  /** Documents whose last store failed; they must not be unloaded until a store succeeds. */
  const unsaved = new Set<string>();
  let closing = false;
  let shuttingDown = false;
  const retryTimers = new Map<string, NodeJS.Timeout>();
  /** Periodic checkpoint timers, by board document name. */
  const checkpointTimers = new Map<string, NodeJS.Timeout>();
  /** Board documents whose final checkpoint has been taken (so it is written exactly once). */
  const finalized = new Set<string>();
  /** Board documents with a checkpoint write in flight (a slow write must not pile up ticks). */
  const checkpointing = new Set<string>();
  /** Checkpoint writes in flight; close() awaits them within its deadline. */
  const inFlightCheckpoints = new Set<Promise<void>>();
  /**
   * Newest session record applied, per session with a loaded document. Records arrive out of order
   * (router vs. the re-read in `connected`); anything not newer than this is stale and ignored.
   */
  const lastApplied = new Map<string, { rec: SessionRecord; seq: number }>();
  /** Increments on every applied record, so `connected` can tell whether it was applied after registration. */
  let applySeq = 0;

  /** Starts one checkpoint write in the background; failures are logged, never thrown. */
  function writeCheckpoint(orgId: string, sessionId: string, document: Y.Doc): void {
    const name = docName.board(sessionId);
    checkpointing.add(name);
    const p = (async () => {
      try {
        await docStore.checkpoint(orgId, sessionId, deps.clock.now(), Y.encodeStateAsUpdate(document));
      } catch (err) {
        logger.error({ sessionId, err }, 'collab: checkpoint failed');
      } finally {
        checkpointing.delete(name);
      }
    })();
    inFlightCheckpoints.add(p);
    void p.finally(() => inFlightCheckpoints.delete(p));
  }

  function startCheckpoints(document: Y.Doc, orgId: string, sessionId: string): void {
    const name = docName.board(sessionId);
    if (shuttingDown || checkpointTimers.has(name) || finalized.has(name)) return;
    const timer = setInterval(() => {
      if (checkpointing.has(name)) return;
      writeCheckpoint(orgId, sessionId, document);
    }, deps.checkpointIntervalMs ?? 300_000);
    timer.unref();
    checkpointTimers.set(name, timer);
  }

  function stopCheckpoints(name: string): void {
    const t = checkpointTimers.get(name);
    if (t) clearInterval(t);
    checkpointTimers.delete(name);
  }

  /**
   * Closes the document connection and the underlying socket with 4403. Hocuspocus's
   * `Connection.close` only sends an in-band CLOSE message (the provider reports code 1000) and
   * leaves the socket open, so the socket is closed explicitly to make the code observable.
   */
  function disconnect(connection: Connection, reason: CloseReason): void {
    connection.close({ code: POLICY_CLOSE_CODE, reason });
    connection.webSocket.close(POLICY_CLOSE_CODE, reason);
  }

  /** Finished session: an interviewer connection becomes read-only, a candidate's is disconnected. */
  function enforceEndOn(connection: Connection, sessionId: string): void {
    try {
      const identity = (connection.context as CollabContext | undefined)?.identity;
      if (identity?.kind === 'candidate') disconnect(connection, 'session_ended');
      else connection.readOnly = true;
    } catch (err) {
      logger.error({ sessionId, err }, 'collab: failed to apply end of session to a connection');
    }
  }

  function loadedDocs(sessionId: string): Document[] {
    return [docName.board(sessionId), docName.notes(sessionId)]
      .map((n) => hocuspocus.documents.get(n))
      .filter((d): d is Document => d !== undefined);
  }

  /** Applies `rec` to every connection of the session; returns false when it was stale (ignored). */
  async function sessionChanged(rec: SessionRecord): Promise<boolean> {
    const sessionId = (rec as Partial<SessionRecord> | undefined)?.id;
    try {
      const last = lastApplied.get(rec.id);
      if (last && rec.version <= last.rec.version) {
        logger.debug({ sessionId, version: rec.version, applied: last.rec.version }, 'collab: ignored stale session record');
        return false;
      }
      const docs = loadedDocs(rec.id);
      // Only sessions with a loaded document need ordering; this keeps the map bounded.
      if (docs.length > 0) lastApplied.set(rec.id, { rec, seq: ++applySeq });
      const boardName = docName.board(rec.id);
      const board = hocuspocus.documents.get(boardName);
      // Broadcast first, so candidates get the final state before they are disconnected.
      try {
        if (board) board.broadcastStateless(sessionStateMessage(rec, deps.clock.now()));
      } catch (err) {
        logger.error({ sessionId, err }, 'collab: failed to broadcast session.state');
      }
      if (isFinished(rec.status)) {
        for (const doc of docs) for (const connection of doc.getConnections()) enforceEndOn(connection, rec.id);
        if (board) {
          stopCheckpoints(boardName);
          if (!finalized.has(boardName) && !shuttingDown) {
            finalized.add(boardName);
            // Fire and forget: the end-session RPC must not wait on S3. close() awaits it.
            writeCheckpoint(rec.orgId, rec.id, board);
          }
        }
      } else if (rec.status === 'live' && board) {
        startCheckpoints(board, rec.orgId, rec.id);
      }
    } catch (err) {
      logger.error({ sessionId, err }, 'collab: sessionChanged failed');
    }
    return true;
  }

  /** Brings one newly registered connection up to `rec` (it may have missed the broadcast). */
  function applyToConnection(connection: Connection, documentName: string, rec: SessionRecord): void {
    const target = targetOf(documentName);
    if (target.kind === 'board') connection.sendStateless(sessionStateMessage(rec, deps.clock.now()));
    if (isFinished(rec.status)) enforceEndOn(connection, rec.id);
  }

  async function persist(document: Y.Doc, documentName: string, orgId: string | undefined, retries?: number): Promise<void> {
    const target = targetOf(documentName);
    if (!orgId) {
      unsaved.add(documentName);
      scheduleRetry(document, documentName);
      logger.error({ sessionId: target.sessionId }, 'collab: cannot store document, org unknown');
      // Throw so Hocuspocus keeps the document dirty instead of treating this as stored.
      throw new Error('collab: cannot store document, org unknown');
    }
    try {
      await docStore.store(orgId, target, Y.encodeStateAsUpdate(document), { retries: retries ?? (shuttingDown ? 0 : undefined) });
      unsaved.delete(documentName);
      const pending = retryTimers.get(documentName);
      if (pending) clearTimeout(pending);
      retryTimers.delete(documentName);
    } catch (err) {
      unsaved.add(documentName);
      // Hocuspocus does not unload (so beforeUnloadDocument never runs) when the flush on last
      // disconnect fails; always arm a retry. It is a no-op while connections exist.
      scheduleRetry(document, documentName);
      logger.error({ sessionId: target.sessionId, err }, 'collab: storing document failed');
      throw err; // Hocuspocus keeps the document dirty
    }
  }

  function scheduleRetry(document: Y.Doc, documentName: string): void {
    if (closing || retryTimers.has(documentName)) return;
    const timer = setTimeout(() => {
      retryTimers.delete(documentName);
      if (closing) return;
      void hocuspocus.unloadDocument(document as never);
    }, deps.storeRetryMs ?? 5000);
    timer.unref();
    retryTimers.set(documentName, timer);
  }

  const hocuspocus = new Hocuspocus<CollabContext>({
    quiet: true,
    debounce: deps.debounceMs ?? 2000,
    maxDebounce: deps.maxDebounceMs ?? 10000,

    async onAuthenticate({ context, documentName, connectionConfig }) {
      let target: DocTarget | undefined;
      try {
        const identity = context.identity as Identity | undefined;
        if (!identity) throw new CollabAccessError('unauthenticated');
        target = targetOf(documentName);
        const session = await deps.sessions.get(identity.orgId, target.sessionId);
        const { readOnly } = authorizeDocument(identity, target, session);
        connectionConfig.readOnly = readOnly;
        const additions: AuthContext = { identity, authSession: session ?? undefined };
        return additions;
      } catch (err) {
        if (!(err instanceof CollabAccessError)) {
          // Infrastructure failure (e.g. DynamoDB down): log it ourselves and reject without detail.
          logger.error({ err, sessionId: target?.sessionId }, 'collab: authentication failed');
          throw { reason: 'forbidden' satisfies CloseReason };
        }
        logger.info({ sessionId: target?.sessionId, reason: err.reason }, 'collab document rejected');
        // Hocuspocus sends `error.reason` to the provider's onAuthenticationFailed, and console.errors any
        // thrown value that has a message — we already logged, so throw a message-less { reason }.
        throw { reason: err.reason };
      }
    },

    async connected({ connection, documentName, context }) {
      // Synchronous on purpose: session.state must be on the wire before the sync reply, so a client
      // that has synced has also received the initial state. The record was read in onAuthenticate.
      const ctx = context as AuthContext;
      const rec = ctx.authSession;
      delete ctx.authSession;
      try {
        if (rec && targetOf(documentName).kind === 'board') connection.sendStateless(sessionStateMessage(rec, deps.clock.now()));
      } catch (err) {
        logger.error({ err, sessionId: rec?.id }, 'collab: failed to send session.state on connect');
      }
      if (!rec) return;
      // This connection is registered now: anything applied from here on reaches it by broadcast.
      const seqAtRegistration = applySeq;
      // A sessionChanged landing between onAuthenticate and now saw no connection to act on. Re-read and,
      // if the session moved on, apply it now that this connection is registered.
      try {
        const fresh = await deps.sessions.get(rec.orgId, rec.id);
        const applied = fresh !== null && fresh.version > rec.version && (await sessionChanged(fresh));
        // The newest record known (read now or applied in memory); stale ones are never applied.
        const known = lastApplied.get(rec.id);
        const read = fresh ?? rec;
        const latest = known && known.rec.version > read.version ? known.rec : read;
        // Applied before this connection registered (it missed that broadcast): bring it up to date.
        const missed = !known || known.seq <= seqAtRegistration;
        if (!applied && missed && latest.version > rec.version) applyToConnection(connection, documentName, latest);
        // Retry the checkpoint decision (afterLoadDocument may not have had a usable record).
        const board = hocuspocus.documents.get(docName.board(rec.id));
        if (board && latest.status === 'live') startCheckpoints(board, latest.orgId, latest.id);
      } catch (err) {
        logger.error({ err, sessionId: rec.id }, 'collab: failed to re-read session on connect');
      }
    },

    async onLoadDocument({ document, documentName, context }) {
      const orgId = (context as CollabContext | undefined)?.identity?.orgId;
      if (!orgId) {
        logger.error({ sessionId: targetOf(documentName).sessionId }, 'collab: cannot load document, identity missing');
        throw { reason: 'unauthenticated' };
      }
      orgByDocument.set(documentName, orgId);
      const bytes = await docStore.load(orgId, targetOf(documentName));
      if (bytes) Y.applyUpdate(document, bytes);
    },

    async afterLoadDocument({ document, documentName, context }) {
      const target = targetOf(documentName);
      const orgId = orgByDocument.get(documentName);
      if (target.kind !== 'board' || !orgId) return;
      try {
        // The loading connection's auth record is still in the context (connected removes it later).
        const rec = (context as AuthContext | undefined)?.authSession ?? (await deps.sessions.get(orgId, target.sessionId));
        if (rec?.status === 'live') startCheckpoints(document, orgId, target.sessionId);
      } catch (err) {
        // The decision is retried by the next connection's re-read and by the next sessionChanged.
        logger.error({ err, sessionId: target.sessionId }, 'collab: cannot start checkpoints, session lookup failed');
      }
    },

    async onStoreDocument({ document, documentName, lastContext }) {
      const orgId = (lastContext as CollabContext | undefined)?.identity?.orgId ?? orgByDocument.get(documentName);
      await persist(document, documentName, orgId);
    },

    // Hocuspocus unloads a document once its last client leaves, even if the last store failed, which
    // would drop the edits. Keep unsaved documents in memory and retry until the store succeeds.
    async beforeUnloadDocument({ document, documentName }) {
      if (!unsaved.has(documentName)) return;
      if (shuttingDown) throw new Error('collab: shutting down, not unloading unsaved document');
      // A failure throws, which aborts the unload; persist has armed the retry.
      await persist(document, documentName, orgByDocument.get(documentName));
    },

    async afterUnloadDocument({ documentName }) {
      orgByDocument.delete(documentName);
      unsaved.delete(documentName);
      stopCheckpoints(documentName);
      finalized.delete(documentName);
      const { sessionId } = targetOf(documentName);
      // documentName is already out of `documents`; forget the ordering once neither doc is loaded.
      if (loadedDocs(sessionId).length === 0) lastApplied.delete(sessionId);
      const t = retryTimers.get(documentName);
      if (t) clearTimeout(t);
      retryTimers.delete(documentName);
    },

    async onStateless({ documentName }) {
      // Clients never send stateless messages; ignore (and never broadcast) anything received.
      logger.debug({ documentName }, 'collab: ignored client stateless message');
    },
  });

  return {
    hocuspocus,
    events: {
      async sessionChanged(rec) {
        await sessionChanged(rec);
      },
    },
    attach(httpServer, path = '/collab') {
      handles.push(attachUpgradeHandler(httpServer, { path, hocuspocus, resolveIdentity: deps.resolveIdentity, logger }));
    },
    async close() {
      const total = deps.shutdownTimeoutMs ?? 8000;
      shuttingDown = true;
      for (const name of [...checkpointTimers.keys()]) stopCheckpoints(name);
      const start = Date.now();
      const deadline = start + total;
      // Refuse new upgrades (and drop sockets) right away; the drain below only needs the documents.
      const handlesClosing = Promise.all(handles.splice(0).map((h) => h.close()));
      hocuspocus.flushPendingStores();
      hocuspocus.closeConnections();
      // Documents whose last store failed never unload, so stop waiting once only those remain.
      const waitDeadline = start + total * 0.75;
      const onlyUnsavedLeft = () => [...hocuspocus.documents.keys()].every((n) => unsaved.has(n));
      while (hocuspocus.getDocumentsCount() > 0 && !onlyUnsavedLeft() && Date.now() < waitDeadline) {
        await new Promise((r) => setTimeout(r, SHUTDOWN_POLL_MS));
      }
      closing = true;
      for (const t of retryTimers.values()) clearTimeout(t);
      retryTimers.clear();
      // Final pass: one attempt per remaining document, in parallel, bounded by the remaining budget.
      const remaining = [...hocuspocus.documents.entries()];
      const saved = new Set<string>();
      const final = Promise.allSettled(
        remaining.map(async ([name, doc]) => {
          await persist(doc, name, orgByDocument.get(name), 0);
          saved.add(name);
        }),
      );
      let timer: NodeJS.Timeout | undefined;
      lastApplied.clear();
      await Promise.race([
        Promise.allSettled([final, ...inFlightCheckpoints]),
        new Promise<void>((r) => {
          timer = setTimeout(r, Math.max(0, deadline - Date.now()));
        }),
      ]);
      clearTimeout(timer);
      const left = remaining.map(([n]) => n).filter((n) => !saved.has(n));
      if (left.length > 0) {
        logger.error({ unsaved: left, count: left.length }, 'collab: shutting down with unsaved documents');
      }
      await handlesClosing;
    },
  };
}
