import { encodeServerMessage } from '@swint/shared-collab-protocol';
import type { SessionRecord } from '@swint/api-data-access-persistence';

export function sessionStateMessage(
  rec: Pick<SessionRecord, 'status' | 'startedAt' | 'durationSec' | 'extensionSec'>,
  nowMs: number,
): string {
  return encodeServerMessage({
    type: 'session.state',
    status: rec.status,
    startedAt: rec.startedAt,
    durationSec: rec.durationSec,
    extensionSec: rec.extensionSec,
    serverNow: nowMs,
  });
}
