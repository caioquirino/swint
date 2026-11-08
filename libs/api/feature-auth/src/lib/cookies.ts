import type { FastifyRequest } from 'fastify';
import type { CookieSerializeOptions } from '@fastify/cookie';

export const COOKIE = { session: 'swint_sid', candidate: 'swint_cand', oidc: 'swint_oidc' } as const;
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const OIDC_STATE_TTL_MS = 10 * 60 * 1000;

export interface CandidateCookie {
  sessionId: string;
  inviteHash: string;
  exp: number;
}

export function cookieOptions(opts: { secure: boolean; maxAgeMs?: number }): CookieSerializeOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: opts.secure,
    signed: true,
    ...(opts.maxAgeMs !== undefined ? { maxAge: Math.floor(opts.maxAgeMs / 1000) } : {}),
  };
}

export function readSignedValue(request: FastifyRequest, name: string): string | null {
  const raw = request.cookies[name];
  if (!raw) return null;
  const result = request.unsignCookie(raw);
  return result.valid ? result.value : null;
}

export function readSignedJson<T>(request: FastifyRequest, name: string): T | null {
  const value = readSignedValue(request, name);
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
