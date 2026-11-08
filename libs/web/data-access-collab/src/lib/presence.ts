import type { Awareness } from 'y-protocols/awareness';
import { readAwarenessUser, type AwarenessUser } from '@swint/shared-collab-protocol';

/** Everyone in the room (including us), one entry per user, interviewers first. */
export function readParticipants(awareness: Awareness): AwarenessUser[] {
  const byId = new Map<string, AwarenessUser>();
  awareness.getStates().forEach((state) => {
    const user = readAwarenessUser(state);
    if (user && !byId.has(user.userId)) byId.set(user.userId, user);
  });
  return [...byId.values()].sort((a, b) =>
    a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'interviewer' ? -1 : 1,
  );
}
