import type { ParticipantRole } from '@swint/shared-domain';
import { AWARENESS_USER_FIELD, awarenessUserSchema, type AwarenessUser } from './awareness.js';

/** Cursor colours that read well on a white canvas. */
export const PRESENCE_COLORS: readonly string[] = [
  '#e03131', '#2f9e44', '#1971c2', '#f08c00', '#9c36b5', '#0c8599', '#e8590c', '#5c940d',
];

const MAX_SELECTED = 1000;

/** Stable colour per user (FNV-1a hash over the id). */
export function colorForUser(userId: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return PRESENCE_COLORS[hash % PRESENCE_COLORS.length] as string;
}

export function candidateUserId(sessionId: string): string {
  return `candidate:${sessionId}`;
}

export interface PresenceIdentity {
  userId: string;
  name: string;
  role: ParticipantRole;
}

const pointerSchema = awarenessUserSchema.shape.pointer;
const selectionSchema = awarenessUserSchema.shape.selectedElementIds;

/**
 * Rewrites the awareness `user` field so identity comes from the server, not the client.
 * Keeps a valid pointer and selection, drops every other client-claimed user key, and leaves
 * other top-level fields (e.g. TipTap's `cursor`) untouched.
 */
export function stampAwarenessState(state: Record<string, unknown>, who: PresenceIdentity): Record<string, unknown> {
  const raw = state[AWARENESS_USER_FIELD];
  const claimed = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const pointer = pointerSchema.safeParse(claimed['pointer']);
  const selection = selectionSchema.safeParse(claimed['selectedElementIds']);
  const selectedElementIds =
    selection.success && Object.keys(selection.data).length <= MAX_SELECTED ? selection.data : {};
  const user: AwarenessUser = {
    userId: who.userId,
    name: who.name.slice(0, 100) || 'Unknown',
    role: who.role,
    color: colorForUser(who.userId),
    selectedElementIds,
    ...(pointer.success && pointer.data ? { pointer: pointer.data } : {}),
  };
  return { ...state, [AWARENESS_USER_FIELD]: user };
}

export function readAwarenessUser(state: Record<string, unknown> | undefined): AwarenessUser | null {
  const parsed = awarenessUserSchema.safeParse(state?.[AWARENESS_USER_FIELD]);
  return parsed.success ? parsed.data : null;
}
