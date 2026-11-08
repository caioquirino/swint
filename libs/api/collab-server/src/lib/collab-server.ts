import type { Server } from 'node:http';
import { Hocuspocus } from '@hocuspocus/server';
import * as Y from 'yjs';
import type { BlobStore, SessionRecord, SessionsRepo } from '@swint/api-data-access-persistence';
import type { CookieHeaderIdentityResolver } from '@swint/api-feature-auth';
import { noopSessionEvents, type SessionEvents } from '@swint/api-feature-sessions';
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
  /** Default 300000 (used from Task 5). */
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
  /** No-op until Task 5 wires session.state broadcasts. */
  readonly events: SessionEvents;
  /** Handles WebSocket upgrades on `path` (default '/collab'). */
  attach(httpServer: Server, path?: string): void;
  /** Flushes pending stores, closes connections, then closes the ws server. */
  close(): Promise<void>;
}

/** Context while authenticating; `authSession` is consumed (and removed) by the `connected` hook. */
type AuthContext = CollabContext & { authSession?: SessionRecord };

const SHUTDOWN_POLL_MS = 50;

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
        if (!(err instanceof CollabAccessError)) throw err;
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
        if (!rec || targetOf(documentName).kind !== 'board') return;
        connection.sendStateless(sessionStateMessage(rec, deps.clock.now()));
      } catch (err) {
        logger.error({ err, sessionId: rec?.id }, 'collab: failed to send session.state on connect');
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
    events: noopSessionEvents,
    attach(httpServer, path = '/collab') {
      handles.push(attachUpgradeHandler(httpServer, { path, hocuspocus, resolveIdentity: deps.resolveIdentity, logger }));
    },
    async close() {
      const total = deps.shutdownTimeoutMs ?? 8000;
      shuttingDown = true;
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
      await Promise.race([
        final,
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
