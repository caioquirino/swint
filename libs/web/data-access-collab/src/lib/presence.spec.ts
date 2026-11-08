import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { AWARENESS_USER_FIELD } from '@swint/shared-collab-protocol';
import { readParticipants } from './presence.js';

const user = (userId: string, name: string, role: 'candidate' | 'interviewer') => ({
  userId, name, role, color: '#1971c2', selectedElementIds: {},
});

function peer(state: unknown): Awareness {
  const a = new Awareness(new Y.Doc());
  a.setLocalStateField(AWARENESS_USER_FIELD, state);
  return a;
}

describe('readParticipants', () => {
  it('dedupes by userId, drops invalid states, sorts interviewers first then by name', () => {
    const local = peer(user('sub-2', 'Zed', 'interviewer'));
    for (const other of [
      peer(user('sub-1', 'Ada', 'interviewer')),
      peer(user('candidate:s1', 'Bo', 'candidate')),
      peer(user('sub-1', 'Ada', 'interviewer')), // second tab
      peer({ name: 'broken' }),
    ]) {
      applyAwarenessUpdate(local, encodeAwarenessUpdate(other, [other.clientID]), 'remote');
    }
    expect(readParticipants(local).map((p) => p.name)).toEqual(['Ada', 'Zed', 'Bo']);
  });
});
