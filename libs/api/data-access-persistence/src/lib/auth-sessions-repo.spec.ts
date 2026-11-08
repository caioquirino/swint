import { describe, expect, it } from 'vitest';
import { createTestStores } from '../testing/index.js';

const rec = (expiresAtSec: number) => ({
  idHash: 'h1',
  userSub: 'sub-1',
  orgId: 'default',
  name: 'Ada',
  email: null,
  roles: ['interviewer'],
  idToken: 'id.token.jwt',
  expiresAt: expiresAtSec,
});

describe('AuthSessionsRepo', () => {
  it('returns a live session and hides expired ones', async () => {
    const { authSessions } = await createTestStores();
    await authSessions.create(rec(2_000));
    await expect(authSessions.get('h1', 1_999_000)).resolves.toEqual(rec(2_000));
    await expect(authSessions.get('h1', 2_000_000)).resolves.toBeNull();
  });
  it('deletes', async () => {
    const { authSessions } = await createTestStores();
    await authSessions.create(rec(9_999_999_999));
    await authSessions.delete('h1');
    await expect(authSessions.get('h1', 0)).resolves.toBeNull();
  });
});
