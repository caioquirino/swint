import { describe, expect, it } from 'vitest';
import { MAX_NOT_STARTED_RETRY_MS, notStartedRetryDelay } from './retry.js';

describe('notStartedRetryDelay', () => {
  it('doubles per attempt and caps at 30 s', () => {
    expect([0, 1, 2, 3].map((a) => notStartedRetryDelay(a, 3000))).toEqual([3000, 6000, 12000, 24000]);
    expect(notStartedRetryDelay(4, 3000)).toBe(MAX_NOT_STARTED_RETRY_MS);
    expect(notStartedRetryDelay(50, 3000)).toBe(30_000);
  });
});
