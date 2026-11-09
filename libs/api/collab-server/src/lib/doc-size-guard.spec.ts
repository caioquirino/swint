import { describe, expect, it } from 'vitest';
import { createDocSizeGuard } from './doc-size-guard.js';

describe('createDocSizeGuard', () => {
  it('admits messages while the running estimate stays under the cap, without measuring again', () => {
    let measured = 0;
    const guard = createDocSizeGuard(100, () => {
      measured++;
      return 10;
    });
    expect(guard.admit('d', 40)).toBe(true); // first use measures (10) → 50
    expect(guard.admit('d', 40)).toBe(true); // 90
    expect(measured).toBe(1);
  });

  it('re-measures once the estimate crosses the cap, and admits when the real size leaves room', () => {
    let real = 10;
    const guard = createDocSizeGuard(100, () => real);
    expect(guard.admit('d', 80)).toBe(true); // estimate 90
    real = 20; // messages overestimate growth
    expect(guard.admit('d', 50)).toBe(true); // 140 > 100 → measure 20 + 50 = 70
  });

  it('rejects when the real size plus the message exceeds the cap', () => {
    const guard = createDocSizeGuard(100, () => 90);
    expect(guard.admit('d', 20)).toBe(false);
    expect(guard.admit('d', 5)).toBe(true);
  });

  it('forget drops the estimate (the next use measures again)', () => {
    let measured = 0;
    const guard = createDocSizeGuard(100, () => {
      measured++;
      return 0;
    });
    guard.admit('d', 1);
    guard.forget('d');
    guard.admit('d', 1);
    expect(measured).toBe(2);
  });
});
