import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import type { Hocuspocus } from '@hocuspocus/server';
import type { CookieHeaderIdentityResolver } from '@swint/api-feature-auth';
import type { Identity } from '@swint/api-util-rpc';
import type { CollabContext, CollabLogger } from './collab-server.js';

export interface UpgradeHandlerOptions {
  path: string;
  hocuspocus: Hocuspocus<CollabContext>;
  resolveIdentity: CookieHeaderIdentityResolver;
  logger: CollabLogger;
}

export interface UpgradeHandle {
  close(): Promise<void>;
}

/** Largest WebSocket frame accepted (ws defaults to 100 MiB). */
export const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;

/** Parses a request target defensively; `null` when it is not a valid URL. */
function parseTarget(rawUrl: string | undefined): URL | null {
  try {
    return new URL(rawUrl ?? '/', 'http://localhost');
  } catch {
    return null;
  }
}

/** Builds the WHATWG Request Hocuspocus expects from a Node upgrade request. Throws on an invalid target. */
export function toWebRequest(req: IncomingMessage): Request {
  const url = parseTarget(req.url);
  if (!url) throw new Error('invalid request target');
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    try {
      headers.set(name, Array.isArray(value) ? value.join(name === 'cookie' ? '; ' : ', ') : value);
    } catch {
      // Skip header values the WHATWG Headers class rejects.
    }
  }
  return new Request(url, { headers });
}

export function attachUpgradeHandler(httpServer: Server, opts: UpgradeHandlerOptions): UpgradeHandle {
  const { path, hocuspocus, resolveIdentity, logger } = opts;
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });

  // Must never throw: an exception escaping an 'upgrade' listener kills the process.
  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = parseTarget(req.url);
    if (!url) {
      socket.on('error', () => undefined);
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    if (url.pathname !== path) {
      // Leave it to other upgrade handlers; nobody else listening means nobody will answer.
      if (httpServer.listenerCount('upgrade') <= 1) socket.destroy();
      return;
    }

    // Node drops its own socket error handler before emitting 'upgrade', and ws only adds one inside
    // handleUpgrade, so cover the gap (e.g. ECONNRESET while the identity resolves).
    const onSocketError = (err: Error) => {
      logger.debug({ err }, 'collab upgrade: socket error before handshake');
      socket.destroy();
    };
    socket.on('error', onSocketError);

    const upgrade = async () => {
      let identity: Identity | null = null;
      try {
        identity = await resolveIdentity(req.headers.cookie);
      } catch (err) {
        logger.warn({ err }, 'collab upgrade: identity resolution failed');
      }
      if (socket.destroyed) return;
      if (!identity) {
        logger.info({ reason: 'unauthenticated' }, 'collab upgrade refused');
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      const authed = identity;
      socket.removeListener('error', onSocketError);
      wss.handleUpgrade(req, socket, head, (ws) => {
        try {
          const client = hocuspocus.handleConnection(ws, toWebRequest(req), { identity: authed });
          ws.on('message', (d) => client.handleMessage(new Uint8Array(d as Buffer)));
          ws.on('close', (code, reason) => client.handleClose({ code, reason: reason.toString() }));
          ws.on('pong', () => client.touch());
          ws.on('error', (err) => logger.warn({ err }, 'collab websocket error'));
        } catch (err) {
          logger.error({ err }, 'collab upgrade: connection setup failed');
          ws.terminate();
        }
      });
    };

    upgrade().catch((err: unknown) => {
      logger.error({ err }, 'collab upgrade failed');
      socket.destroy();
    });
  };

  httpServer.on('upgrade', onUpgrade);

  return {
    close() {
      httpServer.off('upgrade', onUpgrade);
      for (const ws of wss.clients) ws.terminate();
      return new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
