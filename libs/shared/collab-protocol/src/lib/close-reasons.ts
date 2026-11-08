/**
 * WebSocket close code for a connection the server closes by policy (application range 4000–4999),
 * with reason `session_ended` or `invite_revoked`. The provider auto-reconnects on it, so clients must
 * `provider.destroy()` when they see it.
 */
export const POLICY_CLOSE_CODE = 4403;

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
