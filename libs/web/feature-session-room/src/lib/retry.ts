export const MAX_NOT_STARTED_RETRY_MS = 30_000;

/** Delay before reconnecting after a `not_started` rejection: exponential from `pollMs`, capped. */
export function notStartedRetryDelay(attempt: number, pollMs: number): number {
  return Math.min(pollMs * 2 ** attempt, MAX_NOT_STARTED_RETRY_MS);
}
