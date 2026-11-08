import { useMemo, useRef } from 'react';
import type { RoomView } from '@swint/shared-api-contract';
import type { SessionStateMessage } from '@swint/shared-collab-protocol';
import type { SessionStatus, TimerFields } from '@swint/shared-domain';

export interface RoomSessionState {
  status: SessionStatus;
  timer: TimerFields;
  /** serverNow - clientNow (0 until the first session.state). */
  offsetMs: number;
}

const RANK: Record<SessionStatus, number> = { created: 0, live: 1, ended: 2, cancelled: 2 };

/** REST and WebSocket state can arrive in any order; never move backwards. */
export function mergeSessionState(
  current: RoomSessionState | null,
  incoming: { status: SessionStatus; timer: TimerFields; offsetMs?: number },
): RoomSessionState {
  const offsetMs = incoming.offsetMs ?? current?.offsetMs ?? 0;
  if (!current) return { status: incoming.status, timer: incoming.timer, offsetMs };
  const a = RANK[current.status];
  const b = RANK[incoming.status];
  const newer = b > a || (b === a && incoming.timer.extensionSec >= current.timer.extensionSec);
  return newer ? { status: incoming.status, timer: incoming.timer, offsetMs } : { ...current, offsetMs };
}

export function useMergedSessionState(
  view: RoomView,
  live: { message: SessionStateMessage; offsetMs: number } | null,
): RoomSessionState {
  const last = useRef<RoomSessionState | null>(null);
  return useMemo(() => {
    let next = mergeSessionState(last.current, { status: view.status, timer: view.timer });
    if (live) {
      const { status, startedAt, durationSec, extensionSec } = live.message;
      next = mergeSessionState(next, { status, timer: { startedAt, durationSec, extensionSec }, offsetMs: live.offsetMs });
    }
    last.current = next;
    return next;
  }, [view, live]);
}
