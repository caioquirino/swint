import type { RoomView } from '@swint/shared-api-contract';
import { candidateUserId, colorForUser } from '@swint/shared-collab-protocol';
import type { ParticipantRole } from '@swint/shared-domain';
import type { CollabPhase } from '@swint/web-data-access-collab';
import type { BannerState } from '@swint/web-ui-session-panels';

export function bannerState(phase: CollabPhase | undefined, everConnected: boolean): BannerState {
  if (!phase) return 'connecting';
  switch (phase.kind) {
    case 'connecting':
      return everConnected ? null : 'connecting';
    case 'reconnecting':
      return 'reconnecting';
    case 'unreachable':
      return 'unreachable';
    default:
      return null;
  }
}

/** Our presence identity. It matches the server's stamp (collab-server presenceIdentity). */
export function myPresence(view: RoomView): { userId: string; name: string; role: ParticipantRole; color: string } {
  const userId = view.role === 'interviewer' ? view.me.sub : candidateUserId(view.sessionId);
  return { userId, name: view.me.name, role: view.role, color: colorForUser(userId) };
}
