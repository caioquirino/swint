import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  initialLifecycle,
  InvalidTransitionError,
  isFinished,
  type SessionLifecycleState,
} from './lifecycle.js';

const ctx = { now: 1_000_000, actorId: 'interviewer-1' };
const created = (): SessionLifecycleState => initialLifecycle(45 * 60);
const live = (): SessionLifecycleState => applyCommand(created(), { type: 'start' }, ctx);

describe('initialLifecycle', () => {
  it('starts in created with no timestamps', () => {
    expect(created()).toEqual({
      status: 'created',
      startedAt: null,
      durationSec: 2700,
      extensionSec: 0,
      endedAt: null,
      endedBy: null,
      cancelReason: null,
    });
  });
});

describe('applyCommand', () => {
  it('start: created -> live and records startedAt', () => {
    expect(live()).toMatchObject({ status: 'live', startedAt: 1_000_000 });
  });

  it('extend: adds minutes to extensionSec while live', () => {
    const once = applyCommand(live(), { type: 'extend', minutes: 5 }, ctx);
    const twice = applyCommand(once, { type: 'extend', minutes: 10 }, ctx);
    expect(twice.extensionSec).toBe(900);
  });

  it('end: live -> ended with endedAt and endedBy', () => {
    const ended = applyCommand(live(), { type: 'end' }, { now: 2_000_000, actorId: 'interviewer-2' });
    expect(ended).toMatchObject({ status: 'ended', endedAt: 2_000_000, endedBy: 'interviewer-2' });
  });

  it('cancel: allowed from created and live, keeps the reason', () => {
    const fromCreated = applyCommand(created(), { type: 'cancel', reason: 'no-show' }, ctx);
    const fromLive = applyCommand(live(), { type: 'cancel' }, ctx);
    expect(fromCreated).toMatchObject({ status: 'cancelled', cancelReason: 'no-show', endedBy: 'interviewer-1' });
    expect(fromLive).toMatchObject({ status: 'cancelled', cancelReason: null });
  });

  it('does not mutate the input state', () => {
    const before = created();
    const snapshot = structuredClone(before);
    applyCommand(before, { type: 'start' }, ctx);
    expect(before).toEqual(snapshot);
  });

  it.each([
    ['created', { type: 'extend', minutes: 5 }],
    ['created', { type: 'end' }],
    ['live', { type: 'start' }],
  ] as const)('rejects %s + %o', (status, command) => {
    const state = status === 'created' ? created() : live();
    expect(() => applyCommand(state, command, ctx)).toThrow(InvalidTransitionError);
  });

  it.each(['ended', 'cancelled'] as const)('rejects every command once %s', (finalStatus) => {
    const final = applyCommand(live(), finalStatus === 'ended' ? { type: 'end' } : { type: 'cancel' }, ctx);
    for (const command of [
      { type: 'start' },
      { type: 'extend', minutes: 5 },
      { type: 'end' },
      { type: 'cancel' },
    ] as const) {
      expect(() => applyCommand(final, command, ctx)).toThrow(InvalidTransitionError);
    }
  });

  it('InvalidTransitionError carries from and command', () => {
    try {
      applyCommand(created(), { type: 'end' }, ctx);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidTransitionError);
      expect((e as InvalidTransitionError).from).toBe('created');
      expect((e as InvalidTransitionError).command).toBe('end');
    }
  });
});

describe('isFinished', () => {
  it('is true only for ended and cancelled', () => {
    expect(isFinished('created')).toBe(false);
    expect(isFinished('live')).toBe(false);
    expect(isFinished('ended')).toBe(true);
    expect(isFinished('cancelled')).toBe(true);
  });
});
