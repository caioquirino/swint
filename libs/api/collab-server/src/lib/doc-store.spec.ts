import { describe, expect, it, vi } from 'vitest';
import { blobKeys } from '@swint/api-data-access-persistence';
import { createTestStores } from '@swint/api-data-access-persistence/testing';
import { createDocStore } from './doc-store.js';

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe('DocStore', () => {
  it('round-trips board and notes under the spec keys; missing → null', async () => {
    const { blobs } = await createTestStores();
    const store = createDocStore({ blobs, logger });
    await store.store('o1', { sessionId: 's1', kind: 'board' }, new Uint8Array([1, 2]));
    await store.store('o1', { sessionId: 's1', kind: 'notes' }, new Uint8Array([3]));
    await expect(blobs.getBytes(blobKeys.sessionBoardLatest('o1', 's1'))).resolves.toEqual(new Uint8Array([1, 2]));
    await expect(store.load('o1', { sessionId: 's1', kind: 'notes' })).resolves.toEqual(new Uint8Array([3]));
    await expect(store.load('o1', { sessionId: 'nope', kind: 'board' })).resolves.toBeNull();
  });

  it('checkpoint writes under the checkpoint key', async () => {
    const { blobs } = await createTestStores();
    await createDocStore({ blobs, logger }).checkpoint('o1', 's1', 1700000000000, new Uint8Array([9]));
    await expect(blobs.getBytes(blobKeys.sessionBoardCheckpoint('o1', 's1', 1700000000000))).resolves.toEqual(new Uint8Array([9]));
  });

  it('retries failed writes with 100/400/1600 ms backoff, then throws', async () => {
    const putBytes = vi.fn().mockRejectedValue(new Error('s3 down'));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const store = createDocStore({ blobs: { putBytes } as never, logger, sleep });
    await expect(store.store('o1', { sessionId: 's1', kind: 'board' }, new Uint8Array([1]))).rejects.toThrow('s3 down');
    expect(putBytes).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([100, 400, 1600]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('succeeds on a retry', async () => {
    const putBytes = vi.fn().mockRejectedValueOnce(new Error('blip')).mockResolvedValue(undefined);
    const store = createDocStore({ blobs: { putBytes } as never, logger, sleep: async () => undefined });
    await expect(store.store('o1', { sessionId: 's1', kind: 'board' }, new Uint8Array([1]))).resolves.toBeUndefined();
    expect(putBytes).toHaveBeenCalledTimes(2);
  });
});
