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

/** Builds the WHATWG Request Hocuspocus expects from a Node upgrade request. */
export function toWebRequest(req: IncomingMessage): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(name === 'cookie' ? '; ' : ', ') : value);
  }
  return new Request(new URL(req.url ?? '/', 'http://localhost'), { headers });
}

function pathOf(req: IncomingMessage): string {
  return new URL(req.url ?? '/', 'http://localhost').pathname;
}

export function attachUpgradeHandler(httpServer: Server, opts: UpgradeHandlerOptions): UpgradeHandle {
  const { path, hocuspocus, resolveIdentity, logger } = opts;
  const wss = new WebSocketServer({ noServer: true });

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (pathOf(req) !== path) {
      // Leave it to other upgrade handlers; nobody else listening means nobody will answer.
      if (httpServer.listenerCount('upgrade') <= 1) socket.destroy();
      return;
    }
    void (async () => {
      let identity: Identity | null = null;
      try {
        identity = await resolveIdentity(req.headers.cookie);
      } catch (err) {
        logger.warn({ err }, 'collab upgrade: identity resolution failed');
      }
      if (!identity) {
        logger.info({ reason: 'unauthenticated' }, 'collab upgrade refused');
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      const authed = identity;
      wss.handleUpgrade(req, socket, head, (ws) => {
        const client = hocuspocus.handleConnection(ws, toWebRequest(req), { identity: authed });
        ws.on('message', (d) => client.handleMessage(new Uint8Array(d as Buffer)));
        ws.on('close', (code, reason) => client.handleClose({ code, reason: reason.toString() }));
        ws.on('pong', () => client.touch());
        ws.on('error', (err) => logger.warn({ err }, 'collab websocket error'));
      });
    })();
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
