import { describe, expect, it } from 'vitest';
import { CRITICAL_MS, remainingMs, serverOffsetMs, timerPhase, WARNING_MS } from './timer.js';

const timer = { startedAt: 0, durationSec: 3600, extensionSec: 600 };

describe('remainingMs', () => {
  it('is null before start', () => {
    expect(remainingMs({ ...timer, startedAt: null }, 123)).toBeNull();
  });
  it('includes extensions', () => {
    expect(remainingMs(timer, 0)).toBe(4_200_000);
    expect(remainingMs(timer, 4_200_000)).toBe(0);
  });
  it('goes negative in overtime', () => {
    expect(remainingMs(timer, 4_260_000)).toBe(-60_000);
  });
});

describe('timerPhase', () => {
  it.each([
    [null, 'not-started'],
    [WARNING_MS + 1, 'normal'],
    [WARNING_MS, 'warning'],
    [CRITICAL_MS + 1, 'warning'],
    [CRITICAL_MS, 'critical'],
    [0, 'critical'],
    [-1, 'overtime'],
  ] as const)('%s ms -> %s', (remaining, phase) => {
    expect(timerPhase(remaining)).toBe(phase);
  });
  it('uses the 10 and 2 minute thresholds', () => {
    expect(WARNING_MS).toBe(600_000);
    expect(CRITICAL_MS).toBe(120_000);
  });
});

describe('serverOffsetMs', () => {
  it('is server minus client', () => {
    expect(serverOffsetMs(10_500, 10_000)).toBe(500);
    expect(serverOffsetMs(9_000, 10_000)).toBe(-1_000);
  });
});
