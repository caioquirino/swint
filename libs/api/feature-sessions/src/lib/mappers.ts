import type { Session, SessionSummary } from '@swint/shared-api-contract';
import type { SessionRecord } from '@swint/api-data-access-persistence';

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
