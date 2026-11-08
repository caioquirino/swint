import { describe, expect, it } from 'vitest';
import { initialConnState, isTerminal, reduceConn, type CollabConnState, type CollabEvent } from './conn-state.js';

const run = (events: CollabEvent[], n = 3): CollabConnState => events.reduce((s, e) => reduceConn(s, e, n), initialConnState);
const close = (code = 1006, reason = ''): CollabEvent => ({ type: 'close', code, reason });

describe('reduceConn', () => {
  it('connects after open + authenticated, recording read-only scope', () => {
    const s = run([{ type: 'open' }, { type: 'authenticated', readOnly: true }]);
    expect(s.phase).toEqual({ kind: 'connected' });
    expect(s.readOnly).toBe(true);
    expect(s.everConnected).toBe(true);
  });

  it('reconnects after a drop of an opened socket', () => {
    const s = run([{ type: 'open' }, { type: 'authenticated', readOnly: false }, close()]);
    expect(s.phase).toEqual({ kind: 'reconnecting' });
    expect(s.failedOpens).toBe(0);
  });

  it('becomes unreachable after N consecutive closes without an open (401 at upgrade)', () => {
    expect(run([close(), close()]).phase).toEqual({ kind: 'reconnecting' });
    expect(run([close(), close(), close()]).phase).toEqual({ kind: 'unreachable' });
  });

  it('an open resets the failed-open count', () => {
    const s = run([close(), close(), { type: 'open' }, close(), close()]);
    expect(s.phase).toEqual({ kind: 'reconnecting' });
  });

  it('recovers from unreachable when the socket opens and authenticates', () => {
    const s = run([close(), close(), close(), { type: 'open' }, { type: 'authenticated', readOnly: false }]);
    expect(s.phase).toEqual({ kind: 'connected' });
  });

  it.each(['forbidden', 'not_started', 'session_ended', 'invite_revoked'] as const)('authFailed %s is terminal', (reason) => {
    const s = run([{ type: 'open' }, { type: 'authFailed', reason }, { type: 'open' }, { type: 'authenticated', readOnly: false }]);
    expect(s.phase).toEqual({ kind: 'rejected', reason });
    expect(isTerminal(s.phase)).toBe(true);
  });

  it('maps unknown or unauthenticated auth failures to forbidden', () => {
    expect(run([{ type: 'authFailed', reason: 'weird' }]).phase).toEqual({ kind: 'rejected', reason: 'forbidden' });
    expect(run([{ type: 'authFailed', reason: 'unauthenticated' }]).phase).toEqual({ kind: 'rejected', reason: 'forbidden' });
  });

  it('4403 closes are terminal with their reason (session_ended by default)', () => {
    expect(run([{ type: 'open' }, close(4403, 'invite_revoked')]).phase).toEqual({ kind: 'closed', reason: 'invite_revoked' });
    expect(run([{ type: 'open' }, close(4403, 'session_ended')]).phase).toEqual({ kind: 'closed', reason: 'session_ended' });
    expect(run([{ type: 'open' }, close(4403, '')]).phase).toEqual({ kind: 'closed', reason: 'session_ended' });
    const after = run([{ type: 'open' }, close(4403, 'session_ended'), { type: 'open' }, { type: 'authenticated', readOnly: false }]);
    expect(after.phase.kind).toBe('closed');
  });
});
