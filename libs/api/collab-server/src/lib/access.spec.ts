import { describe, expect, it } from 'vitest';
import type { Identity } from '@swint/api-util-rpc';
import type { SessionRecord } from '@swint/api-data-access-persistence';
import type { SessionStatus } from '@swint/shared-domain';
import { authorizeDocument, CollabAccessError, targetOf } from './access.js';

const session = (status: SessionStatus, over: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 's1',
  orgId: 'default',
  templateId: 't1',
  templateSnapshot: { title: 'T', instructionsMd: '', rubricMd: '', durationMin: 45, boardSeedKey: null },
  candidateName: 'Bo',
  status,
  startedAt: status === 'created' ? null : 1,
  durationSec: 2700,
  extensionSec: 0,
  endedAt: null,
  endedBy: null,
  cancelReason: null,
  activeInviteHash: 'h',
  createdBy: 'sub-1',
  createdAt: 1,
  version: 1,
  ...over,
});
const interviewer: Identity = { kind: 'interviewer', sub: 'sub-1', name: 'Ada', email: null, orgId: 'default', roles: ['interviewer'] };
const candidate: Identity = { kind: 'candidate', sessionId: 's1', orgId: 'default', inviteHash: 'h', name: 'Bo' };

const reasonOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(CollabAccessError);
    return (e as CollabAccessError).reason;
  }
  throw new Error('expected CollabAccessError');
};

describe('targetOf', () => {
  it('parses valid names and rejects others as forbidden', () => {
    expect(targetOf('session:s1:board')).toEqual({ sessionId: 's1', kind: 'board' });
    expect(reasonOf(() => targetOf('session:s1:code'))).toBe('forbidden');
    expect(reasonOf(() => targetOf('anything'))).toBe('forbidden');
  });
});

describe('authorizeDocument (spec §7.1)', () => {
  it.each([
    ['created', 'board', false],
    ['live', 'board', false],
    ['ended', 'board', true],
    ['cancelled', 'board', true],
    ['created', 'notes', false],
    ['live', 'notes', false],
    ['ended', 'notes', true],
  ] as const)('interviewer %s/%s → readOnly %s', (status, kind, readOnly) => {
    expect(authorizeDocument(interviewer, { sessionId: 's1', kind }, session(status))).toEqual({ readOnly });
  });

  it('candidate: live board is writable', () => {
    expect(authorizeDocument(candidate, { sessionId: 's1', kind: 'board' }, session('live'))).toEqual({ readOnly: false });
  });

  it.each([
    ['created', 'board', 'not_started'],
    ['ended', 'board', 'session_ended'],
    ['cancelled', 'board', 'session_ended'],
    ['created', 'notes', 'forbidden'],
    ['live', 'notes', 'forbidden'],
    ['ended', 'notes', 'forbidden'],
  ] as const)('candidate %s/%s → %s', (status, kind, reason) => {
    expect(reasonOf(() => authorizeDocument(candidate, { sessionId: 's1', kind }, session(status)))).toBe(reason);
  });

  it('missing session, other org, other session, missing role → forbidden', () => {
    expect(reasonOf(() => authorizeDocument(interviewer, { sessionId: 's1', kind: 'board' }, null))).toBe('forbidden');
    expect(
      reasonOf(() => authorizeDocument(interviewer, { sessionId: 's1', kind: 'board' }, session('live', { orgId: 'other' }))),
    ).toBe('forbidden');
    expect(
      reasonOf(() => authorizeDocument({ ...candidate, sessionId: 's2' }, { sessionId: 's1', kind: 'board' }, session('live'))),
    ).toBe('forbidden');
    expect(
      reasonOf(() => authorizeDocument({ ...interviewer, roles: [] }, { sessionId: 's1', kind: 'board' }, session('live'))),
    ).toBe('forbidden');
  });
});
