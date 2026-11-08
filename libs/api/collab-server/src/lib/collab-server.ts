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
const SHUTDOWN_MAX_MS = 5000;

export function createCollabServer(deps: CollabServerDeps): CollabServer {
  const { logger } = deps;
  const handles: UpgradeHandle[] = [];
  const docStore = createDocStore({ blobs: deps.blobs, logger });
  // lastContext can be absent when a store fires after the last connection left; remember the org per document.
  const orgByDocument = new Map<string, string>();

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
      const orgId = (context as CollabContext).identity.orgId;
      orgByDocument.set(documentName, orgId);
      const bytes = await docStore.load(orgId, targetOf(documentName));
      if (bytes) Y.applyUpdate(document, bytes);
    },

    async onStoreDocument({ document, documentName, lastContext }) {
      const target = targetOf(documentName);
      const orgId = (lastContext as CollabContext | undefined)?.identity?.orgId ?? orgByDocument.get(documentName);
      if (!orgId) {
        logger.error({ sessionId: target.sessionId }, 'collab: cannot store document, org unknown');
        return;
      }
      try {
        await docStore.store(orgId, target, Y.encodeStateAsUpdate(document));
      } catch (err) {
        logger.error({ sessionId: target.sessionId, err }, 'collab: storing document failed');
        throw err; // Hocuspocus keeps the document dirty
      }
    },

    async afterUnloadDocument({ documentName }) {
      orgByDocument.delete(documentName);
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
      hocuspocus.flushPendingStores();
      hocuspocus.closeConnections();
      const deadline = Date.now() + SHUTDOWN_MAX_MS;
      while (hocuspocus.getDocumentsCount() > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, SHUTDOWN_POLL_MS));
      }
      await Promise.all(handles.splice(0).map((h) => h.close()));
    },
  };
}
