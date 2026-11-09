import { describe, expect, it } from 'vitest';
import { createTokenBucket } from './rate-limit.js';

describe('createTokenBucket', () => {
  it('allows a burst, then refills at the configured rate, never above the burst', () => {
    let t = 0;
    const bucket = createTokenBucket({ ratePerSec: 4, burst: 3, now: () => t });
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([true, true, true, false]);
    t = 500; // +2 tokens
    expect([bucket.take(), bucket.take(), bucket.take()]).toEqual([true, true, false]);
    t = 60_000; // long idle: capped at burst
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([true, true, true, false]);
  });
});
