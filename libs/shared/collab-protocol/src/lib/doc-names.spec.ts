import { describe, expect, it } from 'vitest';
import { docName, parseDocName } from './doc-names.js';

describe('doc names', () => {
  it('builds names', () => {
    expect(docName.board('01J0ABC')).toBe('session:01J0ABC:board');
    expect(docName.notes('01J0ABC')).toBe('session:01J0ABC:notes');
  });
  it('round-trips', () => {
    expect(parseDocName(docName.notes('s1'))).toEqual({ sessionId: 's1', kind: 'notes' });
  });
  it.each(['', 'session::board', 'session:s1:code', 'room:s1:board', 'session:s1:board:x', 'session:a:b:board'])(
    'rejects %j',
    (name) => {
      expect(parseDocName(name)).toBeNull();
    },
  );
});
