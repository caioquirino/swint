import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import WebSocket, { WebSocketServer } from 'ws';
import type { Hocuspocus } from '@hocuspocus/server';
import type { CookieHeaderIdentityResolver } from '@swint/api-feature-auth';
import type { Identity } from '@swint/api-util-rpc';
import type { CollabContext, CollabLogger } from './collab-server.js';
import { createTokenBucket, type TokenBucket } from './rate-limit.js';
import { stillAuthorized } from './still-authorized.js';

export interface UpgradeHandlerOptions {
  path: string;
  hocuspocus: Hocuspocus<CollabContext>;
  resolveIdentity: CookieHeaderIdentityResolver;
  logger: CollabLogger;
  /** Browser Origins allowed to open a socket. Undefined disables the check; a request without Origin (non-browser) is allowed. */
  allowedOrigins?: readonly string[];
  /** Ping interval; a socket that misses a pong by the next tick is terminated. Default 25000. */
  pingIntervalMs?: number;
  /** How often each socket's upgrade cookies are re-resolved; sockets that lost access are closed (1008). Default 60000. */
  revalidateIntervalMs?: number;
  /** Per-socket inbound message budget. Default DEFAULT_MESSAGE_RATE. */
  messageRate?: { ratePerSec: number; burst: number };
}

export interface UpgradeHandle {
  close(): Promise<void>;
}

/** Largest WebSocket frame accepted (ws defaults to 100 MiB). */
export const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;

export const DEFAULT_PING_INTERVAL_MS = 25_000;
export const DEFAULT_REVALIDATE_INTERVAL_MS = 60_000;
export const DEFAULT_MESSAGE_RATE = { ratePerSec: 200, burst: 1000 } as const;
/** Non-terminal for clients: they reconnect, and a reconnect without a valid identity gets HTTP 401. */
export const UNAUTHENTICATED_CLOSE = { code: 1008, reason: 'unauthenticated' } as const;
export const RATE_LIMITED_CLOSE = { code: 1008, reason: 'rate_limited' } as const;

/** Upper bound on one identity resolution (upgrade or revalidation). */
export const RESOLVE_TIMEOUT_MS = 10_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`identity resolution timed out after ${ms} ms`)), ms);
    timer.unref();
  });
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer));
}

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
  interface SocketState {
    cookie: string | undefined;
    identity: Identity;
    alive: boolean;
    bucket: TokenBucket;
  }
  const live = new Map<WebSocket, SocketState>();
  const rate = opts.messageRate ?? DEFAULT_MESSAGE_RATE;

  // Must never throw: an exception escaping an 'upgrade' listener kills the process.
  let closed = false;
  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (closed) {
      // Draining: refuse instead of leaving the socket dangling with no listener.
      socket.on('error', () => undefined);
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
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
    const origin = req.headers.origin;
    if (opts.allowedOrigins && origin !== undefined && !opts.allowedOrigins.includes(origin)) {
      logger.info({ reason: 'origin_not_allowed', origin }, 'collab upgrade refused');
      socket.on('error', () => undefined);
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
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
        identity = await withTimeout(resolveIdentity(req.headers.cookie), RESOLVE_TIMEOUT_MS);
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
          const state: SocketState = { cookie: req.headers.cookie, identity: authed, alive: true, bucket: createTokenBucket(rate) };
          live.set(ws, state);
          ws.on('message', (d) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            if (!state.bucket.take()) {
              logger.warn({ reason: RATE_LIMITED_CLOSE.reason }, 'collab: closing socket over its message budget');
              ws.close(RATE_LIMITED_CLOSE.code, RATE_LIMITED_CLOSE.reason);
              return;
            }
            client.handleMessage(new Uint8Array(d as Buffer));
          });
          ws.on('close', (code, reason) => {
            live.delete(ws);
            client.handleClose({ code, reason: reason.toString() });
          });
          ws.on('pong', () => {
            state.alive = true;
            client.touch();
          });
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

  // Liveness: a socket that did not answer the previous ping is dead (half-open TCP, sleeping laptop).
  const pingTimer = setInterval(() => {
    for (const [ws, state] of live) {
      if (!state.alive) {
        ws.terminate();
        continue;
      }
      state.alive = false;
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }
  }, opts.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS);
  pingTimer.unref();

  // Revalidation: sign-out, auth-session expiry and role removal must reach sockets opened before them.
  const revalidateMs = opts.revalidateIntervalMs ?? DEFAULT_REVALIDATE_INTERVAL_MS;
  let revalidating = false;
  const revalidateTimer = setInterval(() => {
    if (revalidating) return;
    revalidating = true;
    void Promise.all(
      [...live].map(async ([ws, state]) => {
        let fresh: Identity | null;
        try {
          fresh = await withTimeout(resolveIdentity(state.cookie), Math.min(RESOLVE_TIMEOUT_MS, revalidateMs));
        } catch (err) {
          logger.warn({ err }, 'collab: revalidation failed; keeping the socket');
          return;
        }
        if (!stillAuthorized(state.identity, fresh) && ws.readyState === WebSocket.OPEN) {
          logger.info({ reason: UNAUTHENTICATED_CLOSE.reason }, 'collab: closing a socket that lost access');
          ws.close(UNAUTHENTICATED_CLOSE.code, UNAUTHENTICATED_CLOSE.reason);
        }
      }),
    ).finally(() => {
      revalidating = false;
    });
  }, revalidateMs);
  revalidateTimer.unref();

  httpServer.on('upgrade', onUpgrade);

  return {
    close() {
      closed = true;
      clearInterval(pingTimer);
      clearInterval(revalidateTimer);
      for (const ws of wss.clients) ws.terminate();
      // The listener stays attached on purpose: with none, Node leaves late upgrade sockets dangling and
      // the HTTP server can never finish closing. It now answers them with 503.
      return new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
