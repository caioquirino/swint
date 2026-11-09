import { describe, expect, it } from 'vitest';
import { bannerState, myPresence } from './connection.js';

describe('bannerState', () => {
  it.each([
    [{ kind: 'connecting' }, false, 'connecting'],
    [{ kind: 'connecting' }, true, null],
    [{ kind: 'connected' }, true, null],
    [{ kind: 'reconnecting' }, true, 'reconnecting'],
    [{ kind: 'unreachable' }, false, 'unreachable'],
    [{ kind: 'closed', reason: 'session_ended' }, true, null],
  ] as const)('%j (everConnected=%s) → %s', (phase, ever, expected) => {
    expect(bannerState(phase, ever)).toBe(expected);
  });
});

describe('myPresence', () => {
  it('matches what the server stamps', () => {
    expect(myPresence({ role: 'interviewer', me: { name: 'Ada', sub: 'sub-1' } } as never)).toMatchObject({
      userId: 'sub-1',
      role: 'interviewer',
    });
    expect(myPresence({ role: 'candidate', sessionId: 's1', me: { name: 'Bo' } } as never)).toMatchObject({
      userId: 'candidate:s1',
      role: 'candidate',
    });
  });
});
