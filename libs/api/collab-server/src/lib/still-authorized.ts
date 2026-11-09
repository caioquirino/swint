import { INTERVIEWER_ROLE, type Identity } from '@swint/api-util-rpc';

/** Whether `fresh` (re-resolved from the same upgrade cookies) still grants what `original` was granted. */
export function stillAuthorized(original: Identity, fresh: Identity | null): boolean {
  if (!fresh || fresh.orgId !== original.orgId) return false;
  if (original.kind === 'interviewer') {
    return fresh.kind === 'interviewer' && fresh.sub === original.sub && fresh.roles.includes(INTERVIEWER_ROLE);
  }
  return fresh.kind === 'candidate' && fresh.sessionId === original.sessionId && fresh.inviteHash === original.inviteHash;
}
