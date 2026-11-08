import { ORPCError } from '@orpc/client';

export interface ApiErrorInfo {
  code: string;
  reason?: string;
  message: string;
}

/** Typed view of an oRPC error. Returns null for anything else (network failures, bugs). */
export function apiError(err: unknown): ApiErrorInfo | null {
  if (!(err instanceof ORPCError)) return null;
  const data = err.data as { reason?: unknown } | undefined;
  const reason = typeof data?.reason === 'string' ? data.reason : undefined;
  return { code: err.code, message: err.message, ...(reason ? { reason } : {}) };
}

const CLIENT_ERROR_CODES = new Set(['BAD_REQUEST', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT']);

export function isClientError(err: unknown): boolean {
  const info = apiError(err);
  return info !== null && CLIENT_ERROR_CODES.has(info.code);
}
