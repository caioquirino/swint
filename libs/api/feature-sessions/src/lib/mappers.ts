import type { RoomView, Session, SessionSummary } from '@swint/shared-api-contract';
import type { SessionRecord } from '@swint/api-data-access-persistence';
import type { Identity } from '@swint/api-util-rpc';

export function toSession(rec: SessionRecord): Session {
  return {
    id: rec.id,
    title: rec.templateSnapshot.title,
    candidateName: rec.candidateName,
    status: rec.status,
    startedAt: rec.startedAt,
    durationSec: rec.durationSec,
    extensionSec: rec.extensionSec,
    endedAt: rec.endedAt,
    endedBy: rec.endedBy,
    cancelReason: rec.cancelReason,
    instructionsMd: rec.templateSnapshot.instructionsMd,
    rubricMd: rec.templateSnapshot.rubricMd,
    createdBy: rec.createdBy,
    createdAt: rec.createdAt,
  };
}

export function toSessionSummary(rec: SessionRecord): SessionSummary {
  return {
    id: rec.id,
    title: rec.templateSnapshot.title,
    candidateName: rec.candidateName,
    status: rec.status,
    startedAt: rec.startedAt,
    createdAt: rec.createdAt,
  };
}

export function toRoomView(rec: SessionRecord, identity: Identity): RoomView {
  const common = {
    sessionId: rec.id,
    title: rec.templateSnapshot.title,
    status: rec.status,
    timer: { startedAt: rec.startedAt, durationSec: rec.durationSec, extensionSec: rec.extensionSec },
  };
  if (identity.kind === 'interviewer') {
    return {
      ...common,
      role: 'interviewer',
      instructionsMd: rec.templateSnapshot.instructionsMd,
      rubricMd: rec.templateSnapshot.rubricMd,
      candidateName: rec.candidateName,
      me: { name: identity.name, sub: identity.sub },
    };
  }
  return {
    ...common,
    role: 'candidate',
    instructionsMd: rec.status === 'created' ? null : rec.templateSnapshot.instructionsMd,
    me: { name: rec.candidateName },
  };
}
