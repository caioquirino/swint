import { describe, expect, it } from 'vitest';
import type { Identity } from '@swint/api-util-rpc';
import { stillAuthorized } from './still-authorized.js';

const ada: Identity = { kind: 'interviewer', sub: 'sub-1', name: 'Ada', email: null, orgId: 'default', roles: ['interviewer'] };
const bo: Identity = { kind: 'candidate', sessionId: 's1', orgId: 'default', inviteHash: 'h1', name: 'Bo' };

describe('stillAuthorized', () => {
  it('keeps the same interviewer with the interviewer role', () => {
    expect(stillAuthorized(ada, { ...ada, name: 'Ada L.' })).toBe(true);
  });
  it.each([
    ['signed out / expired', null],
    ['another user', { ...ada, sub: 'sub-2' }],
    ['role removed', { ...ada, roles: [] }],
    ['another org', { ...ada, orgId: 'other' }],
    ['now a candidate', bo],
  ])('drops an interviewer who is %s', (_label, fresh) => {
    expect(stillAuthorized(ada, fresh as Identity | null)).toBe(false);
  });
  it('keeps a candidate with the same invite, drops one whose invite changed', () => {
    expect(stillAuthorized(bo, bo)).toBe(true);
    expect(stillAuthorized(bo, { ...bo, inviteHash: 'h2' })).toBe(false);
    expect(stillAuthorized(bo, { ...bo, sessionId: 's2' })).toBe(false);
  });
});
