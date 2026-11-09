export interface TokenBucket {
  /** Takes one token; false when the budget is exhausted. */
  take(): boolean;
}

export function createTokenBucket(opts: { ratePerSec: number; burst: number; now?: () => number }): TokenBucket {
  const now = opts.now ?? (() => performance.now());
  let tokens = opts.burst;
  let last = now();
  return {
    take() {
      const t = now();
      tokens = Math.min(opts.burst, tokens + ((t - last) / 1000) * opts.ratePerSec);
      last = t;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}
