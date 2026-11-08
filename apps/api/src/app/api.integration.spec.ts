import { describe, expect, it, vi } from 'vitest';
import { createORPCClient, ORPCError } from '@orpc/client';
import type { ContractRouterClient } from '@orpc/contract';
import { OpenAPILink } from '@orpc/openapi-client/fetch';
import { contract } from '@swint/shared-api-contract';
import { COOKIE } from '@swint/api-feature-auth';
import { setup, templateBody } from '../test/app-test-setup.js';

function defined<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`expected ${what} to be defined`);
  return value;
}

describe('API over HTTP', () => {
  it('healthz and openapi.json', async () => {
    const { server, close } = await setup();
    expect((await server.inject({ method: 'GET', url: '/healthz' })).json()).toEqual({ ok: true });
    const spec = (await server.inject({ method: 'GET', url: '/api/openapi.json' })).json();
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(['/me', '/templates', '/sessions/{id}/extend', '/room/{sessionId}']));
    await close();
  });

  it('anonymous /api/me is 401; interviewer /api/me is 200', async () => {
    const { server, interviewerCookie, close } = await setup();
    expect((await server.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(401);
    const res = await server.inject({ method: 'GET', url: '/api/me', cookies: await interviewerCookie() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ sub: 'sub-1', orgId: 'default' });
    await close();
  });

  it('full interview flow: template → session → candidate join → room → start → concurrent end → ended', async () => {
    const { server, interviewerCookie, close } = await setup();
    const ic = await interviewerCookie();

    const tpl = (await server.inject({ method: 'POST', url: '/api/templates', cookies: ic, payload: templateBody })).json();
    const archived = (
      await server.inject({ method: 'POST', url: '/api/templates', cookies: ic, payload: { ...templateBody, title: 'Old' } })
    ).json();
    await server.inject({ method: 'POST', url: `/api/templates/${archived.id}/archive`, cookies: ic });
    const listFalse = await server.inject({ method: 'GET', url: '/api/templates?includeArchived=false', cookies: ic });
    expect(listFalse.json().map((t: { title: string }) => t.title)).toEqual(['URL shortener']);
    const listTrue = await server.inject({ method: 'GET', url: '/api/templates?includeArchived=true', cookies: ic });
    expect(listTrue.json()).toHaveLength(2);

    const created = await server.inject({
      method: 'POST',
      url: '/api/sessions',
      cookies: ic,
      payload: { templateId: tpl.id, candidateName: 'Bo' },
    });
    expect(created.statusCode).toBe(200);
    const { session, candidateUrl } = created.json();
    const token = defined(new URL(candidateUrl).pathname.split('/').pop(), 'invite token');

    const join = await server.inject({ method: 'GET', url: `/join/${token}` });
    expect(join.statusCode).toBe(302);
    expect(join.headers.location).toBe(`/s/${session.id}`);
    const cc = {
      [COOKIE.candidate]: defined(
        join.cookies.find((c) => c.name === COOKIE.candidate),
        'candidate cookie',
      ).value,
    };

    const waiting = await server.inject({ method: 'GET', url: `/api/room/${session.id}`, cookies: cc });
    expect(waiting.statusCode).toBe(200);
    expect(waiting.json()).toMatchObject({ role: 'candidate', status: 'created', instructionsMd: null });
    expect(waiting.json()).not.toHaveProperty('rubricMd');

    // candidates can never read session details (rubric, cancel reason)
    expect((await server.inject({ method: 'GET', url: `/api/sessions/${session.id}`, cookies: cc })).statusCode).toBe(403);
    expect((await server.inject({ method: 'GET', url: '/api/templates', cookies: cc })).statusCode).toBe(403);

    expect((await server.inject({ method: 'POST', url: `/api/sessions/${session.id}/start`, cookies: ic })).statusCode).toBe(200);
    const live = (await server.inject({ method: 'GET', url: `/api/room/${session.id}`, cookies: cc })).json();
    expect(live).toMatchObject({ status: 'live', instructionsMd: '# Go' });

    const ic2 = await interviewerCookie('sub-2');
    const [a, b] = await Promise.all([
      server.inject({ method: 'POST', url: `/api/sessions/${session.id}/end`, cookies: ic }),
      server.inject({ method: 'POST', url: `/api/sessions/${session.id}/end`, cookies: ic2 }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);

    const after = await server.inject({ method: 'GET', url: `/api/room/${session.id}`, cookies: cc });
    expect(after.statusCode).toBe(403);
    expect(after.json()).toMatchObject({ data: { reason: 'session_ended' } });
    expect((await server.inject({ method: 'GET', url: `/join/${token}` })).headers.location).toBe(
      '/link-invalid?reason=session_ended',
    );
    await close();
  });

  it('exposes a raw Cookie-header identity resolver (for WebSocket upgrades)', async () => {
    const { interviewerCookie, resolveIdentityFromCookieHeader, close } = await setup();
    const ic = await interviewerCookie();
    const header = Object.entries(ic)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('; ');
    expect(await resolveIdentityFromCookieHeader(header)).toMatchObject({ kind: 'interviewer', sub: 'sub-1' });
    expect(await resolveIdentityFromCookieHeader(undefined)).toBeNull();
    await close();
  });

  it('regenerating the invite kills the old link and the old candidate cookie', async () => {
    const { server, interviewerCookie, close } = await setup();
    const ic = await interviewerCookie();
    const tpl = (await server.inject({ method: 'POST', url: '/api/templates', cookies: ic, payload: templateBody })).json();
    const { session, candidateUrl } = (
      await server.inject({ method: 'POST', url: '/api/sessions', cookies: ic, payload: { templateId: tpl.id, candidateName: 'Bo' } })
    ).json();
    const oldToken = defined(new URL(candidateUrl).pathname.split('/').pop(), 'invite token');
    const join = await server.inject({ method: 'GET', url: `/join/${oldToken}` });
    const oldCc = {
      [COOKIE.candidate]: defined(
        join.cookies.find((c) => c.name === COOKIE.candidate),
        'candidate cookie',
      ).value,
    };
    expect((await server.inject({ method: 'GET', url: `/api/room/${session.id}`, cookies: oldCc })).statusCode).toBe(200);

    const regen = await server.inject({ method: 'POST', url: `/api/sessions/${session.id}/invite`, cookies: ic });
    expect(regen.statusCode).toBe(200);
    expect(regen.json().candidateUrl).not.toBe(candidateUrl);

    expect((await server.inject({ method: 'GET', url: `/join/${oldToken}` })).headers.location).toBe(
      '/link-invalid?reason=invite_revoked',
    );
    expect((await server.inject({ method: 'GET', url: `/api/room/${session.id}`, cookies: oldCc })).statusCode).toBe(401);
    await close();
  });

  it('org isolation over HTTP', async () => {
    const { server, interviewerCookie, close } = await setup();
    const tpl = (
      await server.inject({ method: 'POST', url: '/api/templates', cookies: await interviewerCookie(), payload: templateBody })
    ).json();
    const other = await interviewerCookie('sub-9', 'other-org');
    expect((await server.inject({ method: 'GET', url: `/api/templates/${tpl.id}`, cookies: other })).statusCode).toBe(404);
    await close();
  });

  it('oversized JSON body is rejected with 413 before auth', async () => {
    const { server, close } = await setup();
    const big = JSON.stringify({ ...templateBody, instructionsMd: 'x'.repeat(2.1 * 1024 * 1024) });
    const res = await server.inject({
      method: 'POST',
      url: '/api/templates',
      headers: { 'content-type': 'application/json' },
      payload: big,
    });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({ code: 'PAYLOAD_TOO_LARGE', message: 'Payload Too Large' });
    await close();
  });

  it('non-JSON request bodies under /api are rejected with 415', async () => {
    const { server, interviewerCookie, close } = await setup();
    const res = await server.inject({
      method: 'POST',
      url: '/api/templates',
      cookies: await interviewerCookie(),
      headers: { 'content-type': 'text/plain' },
      payload: 'hello',
    });
    expect(res.statusCode).toBe(415);
    expect(res.json()).toEqual({ code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported Media Type' });
    await close();
  });

  it('unexpected errors outside oRPC return a generic 500 without internals (and are logged)', async () => {
    const logLines: string[] = [];
    const { server, repos, close } = await setup({ logLines });
    vi.spyOn(repos.invites, 'get').mockRejectedValueOnce(new Error('dynamo exploded: table swint-secret'));
    const res = await server.inject({ method: 'GET', url: '/join/some-token' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' });
    expect(res.body).not.toContain('dynamo exploded');
    expect(logLines.join('')).toContain('dynamo exploded');
    expect(logLines.join('')).not.toContain('some-token');
    await close();
  });

  it('unexpected rpc errors are logged with the request id', async () => {
    const logLines: string[] = [];
    const { server, repos, interviewerCookie, close } = await setup({ logLines });
    const ic = await interviewerCookie();
    vi.spyOn(repos.templates, 'listByOrg').mockRejectedValueOnce(new Error('dynamo exploded'));
    const res = await server.inject({ method: 'GET', url: '/api/templates', cookies: ic });
    expect(res.statusCode).toBe(500);
    const entries = logLines.map((l) => JSON.parse(l) as Record<string, unknown>);
    const incoming = entries.find((e) => e.msg === 'incoming request' && (e.req as { url?: string })?.url === '/api/templates');
    const rpcError = entries.find((e) => e.msg === 'rpc error');
    expect(incoming?.reqId).toEqual(expect.any(String));
    expect(rpcError).toMatchObject({ requestId: incoming?.reqId });
    await close();
  });

  it('unknown routes return a generic 404 and never log the raw URL', async () => {
    const logLines: string[] = [];
    const { server, close } = await setup({ logLines });
    const res = await server.inject({ method: 'GET', url: '/join/abcSecretInviteToken/def' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ code: 'NOT_FOUND', message: 'Not found' });
    expect(res.body).not.toContain('abcSecretInviteToken');
    expect(logLines.length).toBeGreaterThan(0);
    expect(logLines.join('')).toContain('/join/[redacted]/def');
    expect(logLines.join('')).not.toContain('abcSecretInviteToken');
    await close();
  });

  it('validation errors are 400', async () => {
    const { server, interviewerCookie, close } = await setup();
    const res = await server.inject({
      method: 'POST',
      url: '/api/templates',
      cookies: await interviewerCookie(),
      payload: { ...templateBody, durationMin: 1 },
    });
    expect(res.statusCode).toBe(400);
    await close();
  });

  it('works with the browser oRPC client (OpenAPILink): bodyless POSTs, cookies, typed errors', async () => {
    const app = await setup({ listen: true });
    const cookie = Object.entries(await app.interviewerCookie())
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('; ');
    const client: ContractRouterClient<typeof contract> = createORPCClient(
      new OpenAPILink(contract, { url: `http://127.0.0.1:${app.port}/api`, headers: { cookie } }),
    );
    const t = await client.templates.create(templateBody);
    const { session } = await client.sessions.create({ templateId: t.id, candidateName: 'Ada' });
    await expect(client.sessions.start({ id: session.id })).resolves.toMatchObject({ status: 'live' });
    await expect(client.sessions.extend({ id: session.id, minutes: 5 })).resolves.toMatchObject({ extensionSec: 300 });
    await expect(client.sessions.regenerateInvite({ id: session.id })).resolves.toHaveProperty('candidateUrl');
    await expect(client.sessions.end({ id: session.id })).resolves.toMatchObject({ status: 'ended' });
    await expect(client.templates.archive({ id: t.id })).resolves.toMatchObject({ archived: true });
    await expect(client.templates.list({ includeArchived: false })).resolves.toEqual([]);
    const err = await client.sessions.start({ id: session.id }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ORPCError);
    expect((err as ORPCError<string, unknown>).code).toBe('CONFLICT');
    await app.close();
  });
});
