export const CLOSE_REASONS = [
  'unauthenticated',
  'forbidden',
  'invite_revoked',
  'session_ended',
  'not_started',
] as const;

export type CloseReason = (typeof CLOSE_REASONS)[number];

export function isCloseReason(value: unknown): value is CloseReason {
  return typeof value === 'string' && (CLOSE_REASONS as readonly string[]).includes(value);
}
