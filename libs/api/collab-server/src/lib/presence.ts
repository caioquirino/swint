import { candidateUserId, type PresenceIdentity } from '@swint/shared-collab-protocol';
import type { Identity } from '@swint/api-util-rpc';

export function presenceIdentity(identity: Identity): PresenceIdentity {
  return identity.kind === 'interviewer'
    ? { userId: identity.sub, name: identity.name, role: 'interviewer' }
    : { userId: candidateUserId(identity.sessionId), name: identity.name, role: 'candidate' };
}
