import { describe, expect, it, vi } from 'vitest';
import { ORPCError } from '@orpc/client';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import { apiError } from './errors.js';
import { createApiClient } from './client.js';
import { fakeApi } from '../testing/fake-api.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function clientWith(response: Response) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response);
  return { client: createApiClient({ baseUrl: 'http://app.test/api', fetch: fetchMock as typeof fetch }), fetchMock };
}

const requestOf = async (fetchMock: ReturnType<typeof vi.fn>) => {
  const [input, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit | undefined];
  const req = input instanceof Request ? input : new Request(input, init);
  return { req, init, body: await req.clone().text() };
};

describe('createApiClient', () => {
  it('maps procedures to REST routes and sends cookies', async () => {
    const session = { id: 's1' };
    const { client, fetchMock } = clientWith(json(200, session));
    await client.sessions.get({ id: 's1' }).catch(() => undefined); // output validation is the server's job; we only check the request
    const { req, init } = await requestOf(fetchMock);
    expect(req.method).toBe('GET');
    expect(new URL(req.url).pathname).toBe('/api/sessions/s1');
    // The wrapper sets credentials explicitly; assert on the init actually passed to fetch.
    expect(init?.credentials).toBe('same-origin');
  });

  it.each([
    ['sessions.start', (c: ReturnType<typeof createApiClient>) => c.sessions.start({ id: 's1' })],
    ['sessions.end', (c: ReturnType<typeof createApiClient>) => c.sessions.end({ id: 's1' })],
    ['sessions.regenerateInvite', (c: ReturnType<typeof createApiClient>) => c.sessions.regenerateInvite({ id: 's1' })],
    ['templates.archive', (c: ReturnType<typeof createApiClient>) => c.templates.archive({ id: 't1' })],
  ])('%s never sends an empty body labelled application/json (the API answers 400)', async (_name, call) => {
    const { client, fetchMock } = clientWith(json(200, {}));
    await call(client).catch(() => undefined);
    const { req, body } = await requestOf(fetchMock);
    expect(req.method).toBe('POST');
    const isJson = (req.headers.get('content-type') ?? '').includes('application/json');
    expect(isJson && body.length === 0).toBe(false);
  });

  it('decodes typed errors including data.reason', async () => {
    const { client } = clientWith(
      json(403, { defined: false, code: 'FORBIDDEN', status: 403, message: 'Forbidden', data: { reason: 'session_ended' } }),
    );
    const err = await client.room.get({ sessionId: 's1' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ORPCError);
    expect(apiError(err)).toEqual({ code: 'FORBIDDEN', reason: 'session_ended', message: 'Forbidden' });
  });
});

describe('apiError', () => {
  it('returns null for non-oRPC errors and omits a non-string reason', () => {
    expect(apiError(new TypeError('Failed to fetch'))).toBeNull();
    expect(apiError(undefined)).toBeNull();
    expect(apiError(new ORPCError('NOT_FOUND', { data: { reason: 42 } }))).toEqual({ code: 'NOT_FOUND', message: expect.any(String) });
  });
});

describe('fakeApi', () => {
  it('works with createTanstackQueryUtils and throws on unstubbed calls', async () => {
    const api = fakeApi({ me: { get: async () => ({ sub: 's' }) } });
    const utils = createTanstackQueryUtils(api);
    await expect(utils.me.get.queryOptions().queryFn?.({} as never)).resolves.toEqual({ sub: 's' });
    expect(() => api.sessions.list({} as never)).toThrow('unexpected api call: sessions.list');
  });
});
