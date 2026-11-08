import { describe, expect, inject, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import '@swint/api-data-access-persistence/testing'; // ProvidedContext typings for inject()
import { sha256Hex } from '@swint/api-util-rpc';
import type { OidcClient } from '@swint/api-feature-auth';
import { COOKIE } from '@swint/api-feature-auth';
import { createApp } from './create-app.js';
import { loadConfig } from './config.js';

const fakeOidc: OidcClient = {
  createAuthorization: async () => ({ url: new URL('http://idp.test/auth'), state: 's', verifier: 'v' }),
  exchange: async () => {
    throw new Error('not used');
  },
  endSessionUrl: async () => new URL('http://idp.test/logout'),
};

function defined<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`expected ${what} to be defined`);
  return value;
}

async function setup() {
  const suffix = randomUUID().slice(0, 8);
  const config = loadConfig({
    NODE_ENV: 'test',
    DYNAMODB_ENDPOINT: inject('dynamoEndpoint'),
    S3_ENDPOINT: inject('s3Endpoint'),
    TABLE_NAME: `swint-it-${suffix}`,
    BUCKET_NAME: `swint-it-${suffix}`,
    LOG_LEVEL: 'silent',
  });
  const app = await createApp(config, { oidc: fakeOidc });
  const server = app.server;
  const repos = app.repos; // exposed for tests (see create-app)

  async function interviewerCookie(sub = 'sub-1', orgId = 'default', roles = ['interviewer']) {
    const sid = `sid-${sub}-${orgId}`;
    await repos.authSessions.create({
      idHash: sha256Hex(sid),
      userSub: sub,
      orgId,
      name: `User ${sub}`,
      email: null,
      roles,
      idToken: 'jwt',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    return { [COOKIE.session]: server.signCookie(sid) };
  }

  return {
    server,
    repos,
    interviewerCookie,
    resolveIdentityFromCookieHeader: app.resolveIdentityFromCookieHeader,
    close: app.close,
  };
}

const templateBody = { title: 'URL shortener', instructionsMd: '# Go', rubricMd: '- scaling', durationMin: 45, boardSeed: null };

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
});
