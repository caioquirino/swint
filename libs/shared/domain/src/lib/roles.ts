export type ParticipantRole = 'candidate' | 'interviewer';
export const PARTICIPANT_ROLES: readonly ParticipantRole[] = ['candidate', 'interviewer'];

export type SessionStatus = 'created' | 'live' | 'ended' | 'cancelled';
export const SESSION_STATUSES: readonly SessionStatus[] = ['created', 'live', 'ended', 'cancelled'];

export const EXTENSION_MINUTES = [5, 10] as const;
export type ExtensionMinutes = (typeof EXTENSION_MINUTES)[number];
