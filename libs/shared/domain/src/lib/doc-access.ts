import { isFinished } from './lifecycle.js';
import type { ParticipantRole, SessionStatus } from './roles.js';

export type DocKind = 'board' | 'notes';
export type DocAccess = 'none' | 'read' | 'write';

export function docAccess(role: ParticipantRole, kind: DocKind, status: SessionStatus): DocAccess {
  if (role === 'interviewer') {
    return isFinished(status) ? 'read' : 'write';
  }
  // candidate
  if (kind === 'notes') return 'none';
  return status === 'live' ? 'write' : 'none';
}
