import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { sha256Hex } from '@swint/api-util-rpc';
import { createTestStores } from '@swint/api-data-access-persistence/testing';
import type { SessionRecord } from '@swint/api-data-access-persistence';
import { COOKIE } from './cookies.js';
import { registerJoinRoute } from './join-route.js';

const SECRET = 'test-cookie-secret-that-is-long-enough-123';
const NOW = 1_700_000_000_000;

async function setup(status: SessionRecord['status'] = 'created') {
  const stores = await createTestStores();
  const app = Fastify();
  await app.register(cookie, { secret: SECRET });
  registerJoinRoute(app, { invites: stores.invites, sessions: stores.sessions, clock: { now: () => NOW }, secureCookies: false });
  await app.ready();
  await stores.sessions.create({
    id: 's1',
    orgId: 'default',
    templateId: 't1',
    templateSnapshot: { title: 'T', instructionsMd: '', rubricMd: '', durationMin: 45, boardSeedKey: null },
    candidateName: 'Bo',
    status,
    startedAt: null,
    durationSec: 2700,
    extensionSec: 0,
    endedAt: null,
    endedBy: null,
    cancelReason: null,
    activeInviteHash: sha256Hex('tok'),
    createdBy: 'sub-1',
    createdAt: 1,
    version: 1,
  });
  await stores.invites.create({ hash: sha256Hex('tok'), orgId: 'default', sessionId: 's1', createdAt: 1, revokedAt: null });
  return { stores, app };
}

describe('GET /join/:token', () => {
  it('valid token → signed httpOnly candidate cookie and redirect to the room', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/join/tok' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/s/s1');
    const c = res.cookies.find((x) => x.name === COOKIE.candidate);
    expect(c).toBeDefined();
    if (!c) return;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe('Lax');
    expect(c.path).toBe('/');
    const unsigned = app.unsignCookie(c.value);
    expect(unsigned.valid).toBe(true);
    expect(JSON.parse(unsigned.value ?? 'null')).toEqual({ sessionId: 's1', inviteHash: sha256Hex('tok'), exp: NOW + 12 * 3600_000 });
  });

  it('unknown or revoked token → invalid page with invite_revoked', async () => {
    const { app, stores } = await setup();
    const unknown = await app.inject({ method: 'GET', url: '/join/nope' });
    expect(unknown.headers.location).toBe('/link-invalid?reason=invite_revoked');
    await stores.invites.revoke(sha256Hex('tok'), NOW);
    const revoked = await app.inject({ method: 'GET', url: '/join/tok' });
    expect(revoked.headers.location).toBe('/link-invalid?reason=invite_revoked');
    expect(revoked.cookies.find((x) => x.name === COOKIE.candidate)).toBeUndefined();
  });

  it('non-revoked invite that is no longer the session active invite → invite_revoked', async () => {
    const { app, stores } = await setup();
    await stores.invites.create({ hash: sha256Hex('old'), orgId: 'default', sessionId: 's1', createdAt: 0, revokedAt: null });
    const res = await app.inject({ method: 'GET', url: '/join/old' });
    expect(res.headers.location).toBe('/link-invalid?reason=invite_revoked');
    expect(res.cookies.find((x) => x.name === COOKIE.candidate)).toBeUndefined();
  });

  it('finished session → invalid page with session_ended', async () => {
    const { app } = await setup('ended');
    const res = await app.inject({ method: 'GET', url: '/join/tok' });
    expect(res.headers.location).toBe('/link-invalid?reason=session_ended');
  });
});
