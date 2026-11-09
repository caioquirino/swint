// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { Server, type onAuthenticatePayload } from '@hocuspocus/server';
import { encodeServerMessage, POLICY_CLOSE_CODE } from '@swint/shared-collab-protocol';
import { createCollabSession, type CollabSession, type CollabSnapshot } from './collab-session.js';

// ws emits an 'error' when closed mid-handshake (browsers do not); the provider has no listener by then.
class QuietWebSocket extends WebSocket {
  constructor(...args: ConstructorParameters<typeof WebSocket>) {
    super(...args);
    this.on('error', () => undefined);
  }
}

const FAST = { delay: 20, minDelay: 20, maxDelay: 40 };
let server: Server | null = null;
let http401: HttpServer | null = null;
let session: CollabSession | null = null;

afterEach(async () => {
  session?.destroy();
  session = null;
  await server?.destroy();
  server = null;
  await new Promise<void>((r) => (http401 ? http401.close(() => r()) : r()));
  http401 = null;
});

async function startServer(
  hooks: {
    onAuthenticate?: (p: onAuthenticatePayload) => Promise<unknown>;
    connected?: (p: { connection: { sendStateless(s: string): void } }) => Promise<void>;
  } = {},
) {
  server = new Server({ port: 0, quiet: true, ...hooks });
  await server.listen();
  return server.webSocketURL;
}

function until(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (pred()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('timeout'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

const snap = (): CollabSnapshot => (session as CollabSession).getSnapshot();
const open = (url: string, role: 'candidate' | 'interviewer' = 'candidate') =>
  (session = createCollabSession({ sessionId: 's1', role, url, WebSocketPolyfill: QuietWebSocket, retry: FAST }));

describe('createCollabSession (real Hocuspocus server)', () => {
  it('connects, reports read-only scope and parses session.state with a clock offset', async () => {
    const url = await startServer({
      onAuthenticate: async ({ connectionConfig }) => {
        connectionConfig.readOnly = true;
      },
      connected: async ({ connection }) => {
        connection.sendStateless(
          encodeServerMessage({
            type: 'session.state',
            status: 'live',
            startedAt: 1000,
            durationSec: 60,
            extensionSec: 0,
            serverNow: Date.now() + 5000,
          }),
        );
      },
    });
    open(url);
    await until(() => snap().conn.phase.kind === 'connected' && snap().sessionState !== null);
    expect(snap().conn.readOnly).toBe(true);
    expect(snap().sessionState?.message.status).toBe('live');
    expect(snap().sessionState?.offsetMs).toBeGreaterThan(4000);
  });

  it('interviewers get a notes document on the same socket; candidates do not', async () => {
    const url = await startServer();
    open(url, 'interviewer');
    expect(session?.notes?.provider.configuration.name).toBe('session:s1:notes');
    expect(session?.board.provider.configuration.name).toBe('session:s1:board');
    await until(() => snap().conn.phase.kind === 'connected');
    session?.destroy();
    open(url, 'candidate');
    expect(session?.notes).toBeNull();
  });

  it('a rejected document is terminal and stops reconnecting', async () => {
    let attempts = 0;
    const url = await startServer({
      onAuthenticate: async () => {
        attempts += 1;
        throw Object.assign(new Error('not_started'), { reason: 'not_started' });
      },
    });
    open(url);
    await until(() => snap().conn.phase.kind === 'rejected');
    expect(snap().conn.phase).toEqual({ kind: 'rejected', reason: 'not_started' });
    const seen = attempts;
    await new Promise((r) => setTimeout(r, 200));
    expect(attempts).toBe(seen);
  });

  it('a 4403 close is terminal (the provider would otherwise reconnect)', async () => {
    let connections = 0;
    const url = await startServer({
      connected: async ({ connection }) => {
        connections += 1;
        const c = connection as unknown as { webSocket: { close(code: number, reason: string): void } };
        setTimeout(() => c.webSocket.close(POLICY_CLOSE_CODE, 'invite_revoked'), 20);
      },
    });
    open(url);
    await until(() => snap().conn.phase.kind === 'closed');
    expect(snap().conn.phase).toEqual({ kind: 'closed', reason: 'invite_revoked' });
    await new Promise((r) => setTimeout(r, 200));
    expect(connections).toBe(1);
  });

  it('turns unreachable after repeated refused upgrades (HTTP 401)', async () => {
    http401 = createServer();
    http401.on('upgrade', (_req, socket) => {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    });
    await new Promise<void>((r) => http401?.listen(0, '127.0.0.1', r));
    const { port } = http401.address() as AddressInfo;
    open(`ws://127.0.0.1:${port}/collab`);
    await until(() => snap().conn.phase.kind === 'unreachable', 5000);
  });

  it('notifies subscribers and stops after destroy', async () => {
    const url = await startServer();
    open(url);
    let calls = 0;
    const unsubscribe = session?.subscribe(() => (calls += 1));
    await until(() => calls > 0);
    unsubscribe?.();
    session?.destroy();
    session?.destroy(); // idempotent
  });
});
