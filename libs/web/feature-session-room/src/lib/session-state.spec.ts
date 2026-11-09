import { describe, expect, it } from 'vitest';
import { mergeSessionState } from './session-state.js';

const timer = (extensionSec = 0, startedAt: number | null = 1000) => ({ startedAt, durationSec: 2700, extensionSec });

describe('mergeSessionState', () => {
  it('starts from the first value, offset defaulting to 0', () => {
    expect(mergeSessionState(null, { status: 'created', timer: timer(0, null) })).toEqual({
      status: 'created',
      timer: timer(0, null),
      offsetMs: 0,
    });
  });

  it('never regresses status (a stale REST view after a live end message)', () => {
    const ended = mergeSessionState(null, { status: 'ended', timer: timer(), offsetMs: 50 });
    expect(mergeSessionState(ended, { status: 'live', timer: timer() })).toEqual({ status: 'ended', timer: timer(), offsetMs: 50 });
  });

  it('accepts progress and extensions, keeping the last known offset', () => {
    const live = mergeSessionState(null, { status: 'live', timer: timer(), offsetMs: 120 });
    expect(mergeSessionState(live, { status: 'live', timer: timer(300) })).toEqual({ status: 'live', timer: timer(300), offsetMs: 120 });
    expect(mergeSessionState(live, { status: 'live', timer: timer(300), offsetMs: 80 }).offsetMs).toBe(80);
  });

  it('ignores an older extension count at the same status', () => {
    const extended = mergeSessionState(null, { status: 'live', timer: timer(600) });
    expect(mergeSessionState(extended, { status: 'live', timer: timer(300) }).timer.extensionSec).toBe(600);
  });

  it('created → live → cancelled', () => {
    let s = mergeSessionState(null, { status: 'created', timer: timer(0, null) });
    s = mergeSessionState(s, { status: 'live', timer: timer() });
    s = mergeSessionState(s, { status: 'cancelled', timer: timer() });
    expect(s.status).toBe('cancelled');
  });
});
