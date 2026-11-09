import type { FastifyRequest } from 'fastify';
import { fastifyCookie, type CookieSerializeOptions, type Signer } from '@fastify/cookie';

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

/** Returns the verified (unsigned) value of a signed cookie, or null when absent or invalid. */
export type SignedCookieReader = (name: string) => string | null;

/** Reads signed cookies from a Fastify request (requires @fastify/cookie registered with the secret). */
export function fastifyCookieReader(request: FastifyRequest): SignedCookieReader {
  return (name) => {
    const raw = request.cookies[name];
    if (!raw) return null;
    const result = request.unsignCookie(raw);
    return result.valid ? result.value : null;
  };
}

/**
 * Reads signed cookies from a raw `Cookie` header (e.g. a WebSocket upgrade `IncomingMessage`),
 * verifying signatures exactly like @fastify/cookie does for the same secret.
 */
export function headerCookieReader(cookieHeader: string | undefined, signer: Pick<Signer, 'unsign'>): SignedCookieReader {
  const cookies = cookieHeader ? fastifyCookie.parse(cookieHeader) : {};
  return (name) => {
    const raw = cookies[name];
    if (!raw) return null;
    const result = signer.unsign(raw);
    return result.valid ? result.value : null;
  };
}

export function readSignedJsonWith<T>(read: SignedCookieReader, name: string): T | null {
  const value = read(name);
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function readSignedValue(request: FastifyRequest, name: string): string | null {
  return fastifyCookieReader(request)(name);
}

export function readSignedJson<T>(request: FastifyRequest, name: string): T | null {
  return readSignedJsonWith<T>(fastifyCookieReader(request), name);
}
