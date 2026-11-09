import { describe, expect, it, vi } from 'vitest';
import type { GetCommand } from '@aws-sdk/lib-dynamodb';
import { createTestStores } from '../testing/index.js';

describe('repositories', () => {
  it('read single items with ConsistentRead (access checks must not see stale records)', async () => {
    const s = await createTestStores();
    const send = vi.spyOn(s.table.doc, 'send');
    await s.sessions.get('default', 'missing');
    await s.invites.get('missing');
    await s.authSessions.get('missing', 0);
    await s.users.get('missing');
    await s.templates.get('default', 'missing');
    const inputs = send.mock.calls.map(([cmd]) => (cmd as GetCommand).input);
    expect(inputs).toHaveLength(5);
    for (const input of inputs) expect(input.ConsistentRead).toBe(true);
  });
});
