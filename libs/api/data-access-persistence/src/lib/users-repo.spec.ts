import { describe, expect, it } from 'vitest';
import { createTestStores } from '../testing/index.js';

describe('UsersRepo', () => {
  it('upserts and reads back by sub', async () => {
    const { users } = await createTestStores();
    const user = { sub: 'sub-1', orgId: 'default', name: 'Ada', email: 'a@x.io', roles: ['interviewer'], lastLoginAt: 1 };
    await users.upsert(user);
    await users.upsert({ ...user, name: 'Ada L.', lastLoginAt: 2 });
    await expect(users.get('sub-1')).resolves.toEqual({ ...user, name: 'Ada L.', lastLoginAt: 2 });
    await expect(users.get('nobody')).resolves.toBeNull();
  });
});
