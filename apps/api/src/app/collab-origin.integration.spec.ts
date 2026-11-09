import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { setup, type TestApp } from '../test/app-test-setup.js';

let app: TestApp | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const cookieHeader = (cookies: Record<string, string>) =>
  Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

function outcome(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    ws.once('error', () => undefined);
    ws.once('open', () => {
      resolve(101);
      ws.terminate();
    });
    ws.once('unexpected-response', (_req, res) => {
      resolve(res.statusCode ?? 0);
      ws.terminate();
    });
  });
}

describe('collab upgrade Origin allowlist (from PUBLIC_BASE_URL)', () => {
  it('accepts the app origin and non-browser clients; refuses other browser origins with 403', async () => {
    app = await setup({ listen: true });
    const headers = { cookie: cookieHeader(await app.interviewerCookie()) };
    const url = `ws://127.0.0.1:${app.port}/collab`;
    expect(await outcome(new WebSocket(url, { headers, origin: 'http://localhost:4200' }))).toBe(101);
    expect(await outcome(new WebSocket(url, { headers }))).toBe(101);
    expect(await outcome(new WebSocket(url, { headers, origin: 'http://evil.test' }))).toBe(403);
  });
});
