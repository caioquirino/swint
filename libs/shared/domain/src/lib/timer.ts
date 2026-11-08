import type { SessionLifecycleState } from './lifecycle.js';

export type TimerFields = Pick<SessionLifecycleState, 'startedAt' | 'durationSec' | 'extensionSec'>;
export type TimerPhase = 'not-started' | 'normal' | 'warning' | 'critical' | 'overtime';

export const WARNING_MS = 10 * 60 * 1000;
export const CRITICAL_MS = 2 * 60 * 1000;

export function remainingMs(timer: TimerFields, nowMs: number): number | null {
  if (timer.startedAt === null) return null;
  return timer.startedAt + (timer.durationSec + timer.extensionSec) * 1000 - nowMs;
}

export function timerPhase(remaining: number | null): TimerPhase {
  if (remaining === null) return 'not-started';
  if (remaining < 0) return 'overtime';
  if (remaining <= CRITICAL_MS) return 'critical';
  if (remaining <= WARNING_MS) return 'warning';
  return 'normal';
}

export function serverOffsetMs(serverNow: number, clientNow: number): number {
  return serverNow - clientNow;
}
