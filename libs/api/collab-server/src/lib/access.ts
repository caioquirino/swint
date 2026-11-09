import { docAccess, isFinished, type DocKind } from '@swint/shared-domain';
import { parseDocName, type CloseReason } from '@swint/shared-collab-protocol';
import { INTERVIEWER_ROLE, type Identity } from '@swint/api-util-rpc';
import type { SessionRecord } from '@swint/api-data-access-persistence';

export class CollabAccessError extends Error {
  constructor(readonly reason: CloseReason) {
    super(reason);
    this.name = 'CollabAccessError';
  }
}

export interface DocTarget {
  sessionId: string;
  kind: DocKind;
}

export function targetOf(documentName: string): DocTarget {
  const parsed = parseDocName(documentName);
  if (!parsed) throw new CollabAccessError('forbidden');
  return parsed;
}

export function authorizeDocument(identity: Identity, target: DocTarget, session: SessionRecord | null): { readOnly: boolean } {
  if (!session || session.orgId !== identity.orgId) throw new CollabAccessError('forbidden');
  if (identity.kind === 'candidate' && identity.sessionId !== target.sessionId) throw new CollabAccessError('forbidden');
  if (identity.kind === 'candidate' && identity.inviteHash !== session.activeInviteHash) {
    throw new CollabAccessError('invite_revoked');
  }
  if (identity.kind === 'interviewer' && !identity.roles.includes(INTERVIEWER_ROLE)) {
    throw new CollabAccessError('forbidden');
  }

  const access = docAccess(identity.kind, target.kind, session.status);
  if (access === 'write') return { readOnly: false };
  if (access === 'read') return { readOnly: true };

  if (identity.kind === 'candidate' && target.kind === 'board') {
    if (session.status === 'created') throw new CollabAccessError('not_started');
    if (isFinished(session.status)) throw new CollabAccessError('session_ended');
  }
  throw new CollabAccessError('forbidden');
}
