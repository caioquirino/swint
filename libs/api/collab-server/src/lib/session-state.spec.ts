import { describe, expect, it } from 'vitest';
import { parseServerMessage } from '@swint/shared-collab-protocol';
import { sessionStateMessage } from './session-state.js';

describe('sessionStateMessage', () => {
  it('encodes the record timer fields plus serverNow', () => {
    const payload = sessionStateMessage({ status: 'live', startedAt: 1000, durationSec: 2700, extensionSec: 300 }, 5000);
    expect(parseServerMessage(payload)).toEqual({
      type: 'session.state',
      status: 'live',
      startedAt: 1000,
      durationSec: 2700,
      extensionSec: 300,
      serverNow: 5000,
    });
  });
  it('throws for an impossible record (live without startedAt)', () => {
    expect(() => sessionStateMessage({ status: 'live', startedAt: null, durationSec: 1, extensionSec: 0 }, 1)).toThrow();
  });
});
