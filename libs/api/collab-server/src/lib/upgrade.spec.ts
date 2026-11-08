import { createServer, type Server } from 'node:http';
import { connect, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { Hocuspocus } from '@hocuspocus/server';
import type { Identity } from '@swint/api-util-rpc';
import type { CollabContext, CollabLogger } from './collab-server.js';
import { attachUpgradeHandler, MAX_PAYLOAD_BYTES, type UpgradeHandle } from './upgrade.js';

const ada: Identity = { kind: 'interviewer', sub: 'sub-1', name: 'Ada', email: null, orgId: 'default', roles: ['interviewer'] };
const logger: CollabLogger = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };

const UPGRADE_HEADERS =
  'Host: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n';

let http: Server;
let handle: UpgradeHandle;
let port: number;
let resolver: (cookie: string | undefined) => Promise<Identity | null>;
const faults: unknown[] = [];
const onFault = (e: unknown) => faults.push(e);

beforeEach(async () => {
  faults.length = 0;
  process.on('uncaughtException', onFault);
  process.on('unhandledRejection', onFault);
  resolver = async (c) => (c === 'ada' ? ada : null);
  http = createServer((_req, res) => res.end('ok'));
  handle = attachUpgradeHandler(http, {
    path: '/collab',
    hocuspocus: new Hocuspocus<CollabContext>({ quiet: true }),
    resolveIdentity: (c) => resolver(c),
    logger,
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  port = (http.address() as AddressInfo).port;
});

afterEach(async () => {
  await handle.close();
  http.closeAllConnections();
  await new Promise<void>((r) => http.close(() => r()));
  process.off('uncaughtException', onFault);
  process.off('unhandledRejection', onFault);
});

function rawSocket(): Promise<Socket> {
  return new Promise((resolve) => {
    const s = connect(port, '127.0.0.1', () => resolve(s));
    s.on('error', () => undefined);
    s.resume(); // drain responses so the peer's FIN is seen and 'close' fires
  });
}

const socketClosed = (s: Socket) => new Promise<void>((r) => (s.destroyed ? r() : s.once('close', () => r())));

async function serverStillWorks() {
  const res = await fetch(`http://127.0.0.1:${port}/`);
  expect(await res.text()).toBe('ok');
  const ws = new WebSocket(`ws://127.0.0.1:${port}/collab`, { headers: { cookie: 'ada' } });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  ws.terminate();
}

describe('upgrade handler hardening', () => {
  it('a malformed request target closes the socket without crashing the process', async () => {
    const s = await rawSocket();
    s.write(`GET http://[ HTTP/1.1\r\n${UPGRADE_HEADERS}\r\n`);
    await socketClosed(s);
    await serverStillWorks();
    expect(faults).toEqual([]);
  });

  it('a client resetting the socket while the identity resolves does not crash the process', async () => {
    let release!: (i: Identity | null) => void;
    let called!: () => void;
    const resolving = new Promise<void>((r) => (called = r));
    resolver = () => {
      called();
      return new Promise((r) => (release = r));
    };
    const s = await rawSocket();
    s.write(`GET /collab HTTP/1.1\r\nCookie: ada\r\n${UPGRADE_HEADERS}\r\n`);
    await resolving;
    s.resetAndDestroy();
    await new Promise((r) => setTimeout(r, 100));
    release(ada);
    await new Promise((r) => setTimeout(r, 100));
    resolver = async (c) => (c === 'ada' ? ada : null);
    await serverStillWorks();
    expect(faults).toEqual([]);
  });

  it('a throwing resolver yields 401 without crashing', async () => {
    resolver = async () => {
      throw new Error('boom');
    };
    const ws = new WebSocket(`ws://127.0.0.1:${port}/collab`, { headers: { cookie: 'ada' } });
    ws.on('error', () => undefined);
    const status = await new Promise<number | undefined>((r) => {
      ws.once('unexpected-response', (_req, res) => r(res.statusCode));
      ws.once('close', () => r(undefined));
    });
    expect(status).toBe(401);
    resolver = async (c) => (c === 'ada' ? ada : null);
    await serverStillWorks();
    expect(faults).toEqual([]);
  });

  it('a frame larger than maxPayload closes that connection with 1009', async () => {
    expect(MAX_PAYLOAD_BYTES).toBe(5 * 1024 * 1024);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/collab`, { headers: { cookie: 'ada' } });
    ws.on('error', () => undefined);
    await new Promise<void>((r) => ws.once('open', () => r()));
    const closed = new Promise<number>((r) => ws.once('close', (code) => r(code)));
    ws.send(Buffer.alloc(MAX_PAYLOAD_BYTES + 1));
    expect(await closed).toBe(1009);
    await serverStillWorks();
    expect(faults).toEqual([]);
  });
});
