import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { sha256Hex } from '@swint/api-util-rpc';
import { createTestStores } from '@swint/api-data-access-persistence/testing';
import type { SessionRecord } from '@swint/api-data-access-persistence';
import { COOKIE } from './cookies.js';
import { createCookieIdentityResolver, createIdentityResolver } from './identity-resolver.js';

const SECRET = 'test-cookie-secret-that-is-long-enough-123';
const NOW = 1_700_000_000_000;

async function setup() {
  const stores = await createTestStores();
  const resolve = createIdentityResolver({
    authSessions: stores.authSessions,
    invites: stores.invites,
    sessions: stores.sessions,
    clock: { now: () => NOW },
  });
  const app = Fastify();
  await app.register(cookie, { secret: SECRET });
  app.get('/whoami', async (req) => ({ identity: await resolve(req) }));
  await app.ready();
  const session: SessionRecord = {
    id: 's1',
    orgId: 'default',
    templateId: 't1',
    templateSnapshot: { title: 'T', instructionsMd: '', rubricMd: '', durationMin: 45, boardSeedKey: null },
    candidateName: 'Bo',
    status: 'created',
    startedAt: null,
    durationSec: 2700,
    extensionSec: 0,
    endedAt: null,
    endedBy: null,
    cancelReason: null,
    activeInviteHash: 'inv-hash',
    createdBy: 'sub-1',
    createdAt: 1,
    version: 1,
  };
  await stores.sessions.create(session);
  await stores.invites.create({ hash: 'inv-hash', orgId: 'default', sessionId: 's1', createdAt: 1, revokedAt: null });
  const whoami = async (cookies: Record<string, string>) =>
    (await app.inject({ method: 'GET', url: '/whoami', cookies })).json().identity;
  return { stores, app, whoami };
}

describe('identity resolver', () => {
  it('no cookies → null', async () => {
    const { whoami } = await setup();
    expect(await whoami({})).toBeNull();
  });

  it('valid interviewer session cookie → interviewer identity', async () => {
    const { stores, app, whoami } = await setup();
    await stores.authSessions.create({
      idHash: sha256Hex('sid-1'),
      userSub: 'sub-1',
      orgId: 'default',
      name: 'Ada',
      email: 'a@x.io',
      roles: ['interviewer'],
      idToken: 'jwt',
      expiresAt: NOW / 1000 + 3600,
    });
    expect(await whoami({ [COOKIE.session]: app.signCookie('sid-1') })).toEqual({
      kind: 'interviewer',
      sub: 'sub-1',
      name: 'Ada',
      email: 'a@x.io',
      orgId: 'default',
      roles: ['interviewer'],
    });
  });

  it('unsigned / tampered / expired session cookie → null', async () => {
    const { stores, app, whoami } = await setup();
    await stores.authSessions.create({
      idHash: sha256Hex('sid-old'),
      userSub: 'sub-1',
      orgId: 'default',
      name: 'Ada',
      email: null,
      roles: ['interviewer'],
      idToken: 'jwt',
      expiresAt: NOW / 1000 - 1,
    });
    expect(await whoami({ [COOKIE.session]: 'sid-old' })).toBeNull();
    expect(await whoami({ [COOKIE.session]: app.signCookie('sid-old') })).toBeNull();
    expect(await whoami({ [COOKIE.session]: app.signCookie('unknown') })).toBeNull();
  });

  it('valid candidate cookie → candidate identity with the session candidate name', async () => {
    const { app, whoami } = await setup();
    const value = app.signCookie(JSON.stringify({ sessionId: 's1', inviteHash: 'inv-hash', exp: NOW + 1000 }));
    expect(await whoami({ [COOKIE.candidate]: value })).toEqual({
      kind: 'candidate',
      sessionId: 's1',
      orgId: 'default',
      inviteHash: 'inv-hash',
      name: 'Bo',
    });
  });

  it('candidate cookie: expired, revoked invite, or mismatched session → null', async () => {
    const { stores, app, whoami } = await setup();
    const sign = (o: object) => app.signCookie(JSON.stringify(o));
    expect(await whoami({ [COOKIE.candidate]: sign({ sessionId: 's1', inviteHash: 'inv-hash', exp: NOW - 1 }) })).toBeNull();
    expect(
      await whoami({ [COOKIE.candidate]: sign({ sessionId: 'other', inviteHash: 'inv-hash', exp: NOW + 1 }) }),
    ).toBeNull();
    await stores.invites.revoke('inv-hash', NOW);
    expect(
      await whoami({ [COOKIE.candidate]: sign({ sessionId: 's1', inviteHash: 'inv-hash', exp: NOW + 1 }) }),
    ).toBeNull();
  });

  it('candidate cookie for a non-revoked invite that is no longer the session active invite → null', async () => {
    const { stores, app, whoami } = await setup();
    await stores.invites.create({ hash: 'old-hash', orgId: 'default', sessionId: 's1', createdAt: 0, revokedAt: null });
    const value = app.signCookie(JSON.stringify({ sessionId: 's1', inviteHash: 'old-hash', exp: NOW + 1000 }));
    expect(await whoami({ [COOKIE.candidate]: value })).toBeNull();
  });
});

describe('cookie-header identity resolver (raw upgrade requests)', () => {
  async function headerSetup() {
    const base = await setup();
    const resolveHeader = createCookieIdentityResolver({
      authSessions: base.stores.authSessions,
      invites: base.stores.invites,
      sessions: base.stores.sessions,
      clock: { now: () => NOW },
      cookieSecret: SECRET,
    });
    const header = (cookies: Record<string, string>) =>
      Object.entries(cookies)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('; ');
    return { ...base, resolveHeader, header };
  }

  it('missing or empty header → null', async () => {
    const { resolveHeader } = await headerSetup();
    expect(await resolveHeader(undefined)).toBeNull();
    expect(await resolveHeader('')).toBeNull();
  });

  it('signed interviewer session cookie → interviewer identity (takes precedence over candidate)', async () => {
    const { stores, app, resolveHeader, header } = await headerSetup();
    await stores.authSessions.create({
      idHash: sha256Hex('sid-1'),
      userSub: 'sub-1',
      orgId: 'default',
      name: 'Ada',
      email: 'a@x.io',
      roles: ['interviewer'],
      idToken: 'jwt',
      expiresAt: NOW / 1000 + 3600,
    });
    const cand = app.signCookie(JSON.stringify({ sessionId: 's1', inviteHash: 'inv-hash', exp: NOW + 1000 }));
    expect(
      await resolveHeader(header({ other: 'x', [COOKIE.candidate]: cand, [COOKIE.session]: app.signCookie('sid-1') })),
    ).toEqual({
      kind: 'interviewer',
      sub: 'sub-1',
      name: 'Ada',
      email: 'a@x.io',
      orgId: 'default',
      roles: ['interviewer'],
    });
  });

  it('signed candidate cookie → candidate identity', async () => {
    const { app, resolveHeader, header } = await headerSetup();
    const value = app.signCookie(JSON.stringify({ sessionId: 's1', inviteHash: 'inv-hash', exp: NOW + 1000 }));
    expect(await resolveHeader(header({ [COOKIE.candidate]: value }))).toEqual({
      kind: 'candidate',
      sessionId: 's1',
      orgId: 'default',
      inviteHash: 'inv-hash',
      name: 'Bo',
    });
  });

  it('candidate cookie for a superseded (but unrevoked) invite → null', async () => {
    const { stores, app, resolveHeader, header } = await headerSetup();
    await stores.invites.create({ hash: 'old-hash', orgId: 'default', sessionId: 's1', createdAt: 0, revokedAt: null });
    const value = app.signCookie(JSON.stringify({ sessionId: 's1', inviteHash: 'old-hash', exp: NOW + 1000 }));
    expect(await resolveHeader(header({ [COOKIE.candidate]: value }))).toBeNull();
  });

  it('tampered or unsigned cookies → null', async () => {
    const { app, resolveHeader, header } = await headerSetup();
    const json = JSON.stringify({ sessionId: 's1', inviteHash: 'inv-hash', exp: NOW + 1000 });
    const signed = app.signCookie(json);
    const tampered = signed.replace('"s1"', '"s2"');
    expect(await resolveHeader(header({ [COOKIE.candidate]: tampered }))).toBeNull();
    expect(await resolveHeader(header({ [COOKIE.candidate]: json }))).toBeNull();
    expect(await resolveHeader(header({ [COOKIE.candidate]: `${json}.bogus` }))).toBeNull();
  });
});
