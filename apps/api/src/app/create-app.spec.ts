import { describe, expect, it, vi } from 'vitest';
import type { SessionRecord } from '@swint/api-data-access-persistence';
import { composeEvents } from './create-app.js';

describe('composeEvents', () => {
  it('calls every defined implementation in order and logs (never throws) failures', async () => {
    const calls: string[] = [];
    const error = vi.fn();
    const events = composeEvents(
      { error },
      {
        sessionChanged: () => {
          calls.push('a');
          throw new Error('boom');
        },
      },
      undefined,
      {
        sessionChanged: async () => {
          calls.push('b');
        },
      },
    );
    await expect(events.sessionChanged({ id: 's1' } as SessionRecord)).resolves.toBeUndefined();
    expect(calls).toEqual(['a', 'b']);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1' }), 'session event handler failed');
  });
});
