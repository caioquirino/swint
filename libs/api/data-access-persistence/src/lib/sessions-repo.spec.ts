import { describe, expect, it } from 'vitest';
import { createTestStores } from '../testing/index.js';
import { StaleWriteError } from './errors.js';
import type { SessionRecord } from './records.js';

const session = (over: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 's1',
  orgId: 'default',
  templateId: 't1',
  templateSnapshot: { title: 'URL shortener', instructionsMd: '# Go', rubricMd: '- x', durationMin: 45, boardSeedKey: null },
  candidateName: 'Bo',
  status: 'created',
  startedAt: null,
  durationSec: 2700,
  extensionSec: 0,
  endedAt: null,
  endedBy: null,
  cancelReason: null,
  activeInviteHash: 'h1',
  createdBy: 'sub-1',
  createdAt: 100,
  version: 1,
  ...over,
});

describe('SessionsRepo', () => {
  it('creates and gets within the same org only', async () => {
    const { sessions } = await createTestStores();
    await sessions.create(session());
    await expect(sessions.get('default', 's1')).resolves.toEqual(session());
    await expect(sessions.get('other-org', 's1')).resolves.toBeNull();
  });

  it('lists newest first and filters by status', async () => {
    const { sessions } = await createTestStores();
    await sessions.create(session({ id: 's1', createdAt: 100 }));
    await sessions.create(session({ id: 's2', createdAt: 300, status: 'live' }));
    await sessions.create(session({ id: 's3', createdAt: 200 }));
    await sessions.create(session({ id: 's4', createdAt: 400, orgId: 'other-org' }));
    expect((await sessions.listByOrg('default', {})).map((s) => s.id)).toEqual(['s2', 's3', 's1']);
    expect((await sessions.listByOrg('default', { status: 'created' })).map((s) => s.id)).toEqual(['s3', 's1']);
  });

  it('update bumps the version when the expected version matches', async () => {
    const { sessions } = await createTestStores();
    await sessions.create(session());
    const stored = await sessions.update(session({ status: 'live', startedAt: 500 }), 1);
    expect(stored).toMatchObject({ status: 'live', startedAt: 500, version: 2 });
    await expect(sessions.get('default', 's1')).resolves.toEqual(stored);
  });

  it('update with a stale version throws StaleWriteError, and exactly one of two racing updates wins', async () => {
    const { sessions } = await createTestStores();
    await sessions.create(session());
    const results = await Promise.allSettled([
      sessions.update(session({ status: 'live', startedAt: 1 }), 1),
      sessions.update(session({ status: 'cancelled', endedAt: 1 }), 1),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(StaleWriteError);
  });

  it('update cannot move a session to another org', async () => {
    const { sessions } = await createTestStores();
    await sessions.create(session());
    await expect(sessions.update(session({ orgId: 'other-org' }), 1)).rejects.toBeInstanceOf(StaleWriteError);
  });
});
