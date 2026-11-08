import { describe, expect, it } from 'vitest';
import { docAccess } from './doc-access.js';

describe('docAccess (spec §7.1)', () => {
  it.each([
    // role, kind, status, expected
    ['candidate', 'board', 'created', 'none'],
    ['candidate', 'board', 'live', 'write'],
    ['candidate', 'board', 'ended', 'none'],
    ['candidate', 'board', 'cancelled', 'none'],
    ['candidate', 'notes', 'created', 'none'],
    ['candidate', 'notes', 'live', 'none'],
    ['candidate', 'notes', 'ended', 'none'],
    ['interviewer', 'board', 'created', 'write'],
    ['interviewer', 'board', 'live', 'write'],
    ['interviewer', 'board', 'ended', 'read'],
    ['interviewer', 'board', 'cancelled', 'read'],
    ['interviewer', 'notes', 'created', 'write'],
    ['interviewer', 'notes', 'live', 'write'],
    ['interviewer', 'notes', 'ended', 'read'],
    ['interviewer', 'notes', 'cancelled', 'read'],
  ] as const)('%s / %s / %s -> %s', (role, kind, status, expected) => {
    expect(docAccess(role, kind, status)).toBe(expected);
  });
});
