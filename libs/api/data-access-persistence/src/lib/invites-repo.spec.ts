import { describe, expect, it } from 'vitest';
import { createTestStores } from '../testing/index.js';

describe('InvitesRepo', () => {
  it('creates, gets, and revokes once', async () => {
    const { invites } = await createTestStores();
    await invites.create({ hash: 'h1', orgId: 'default', sessionId: 's1', createdAt: 1, revokedAt: null });
    await expect(invites.get('h1')).resolves.toEqual({
      hash: 'h1',
      orgId: 'default',
      sessionId: 's1',
      createdAt: 1,
      revokedAt: null,
    });
    await invites.revoke('h1', 50);
    await invites.revoke('h1', 99); // keeps the first revocation time
    await expect(invites.get('h1')).resolves.toMatchObject({ revokedAt: 50 });
    await expect(invites.get('missing')).resolves.toBeNull();
    await expect(invites.revoke('missing', 1)).resolves.toBeUndefined();
  });
});
