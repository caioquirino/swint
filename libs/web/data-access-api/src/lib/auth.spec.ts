import { describe, expect, it, vi } from 'vitest';
import { ORPCError } from '@orpc/client';
import { createQueryClient } from './query-client.js';
import { loginUrl, logout } from './auth.js';

describe('auth helpers', () => {
  it('builds the login URL with an encoded returnTo', () => {
    expect(loginUrl('/s/abc?x=1')).toBe('/auth/login?returnTo=%2Fs%2Fabc%3Fx%3D1');
  });

  it('logs out with a bodyless POST and returns the redirect URL', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ redirectUrl: 'http://kc/logout' }), { status: 200 }));
    await expect(logout(fetchMock as unknown as typeof fetch)).resolves.toBe('http://kc/logout');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/auth/logout');
    expect(init).toEqual({ method: 'POST', credentials: 'same-origin' });
  });

  it('falls back to / when logout fails', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 500 }));
    await expect(logout(fetchMock as unknown as typeof fetch)).resolves.toBe('/');
  });
});

describe('createQueryClient', () => {
  it('does not retry client errors but retries other failures twice', () => {
    const retry = createQueryClient().getDefaultOptions().queries?.retry as (n: number, e: unknown) => boolean;
    expect(retry(0, new ORPCError('UNAUTHORIZED'))).toBe(false);
    expect(retry(0, new ORPCError('NOT_FOUND'))).toBe(false);
    expect(retry(0, new TypeError('network'))).toBe(true);
    expect(retry(1, new ORPCError('INTERNAL_SERVER_ERROR'))).toBe(true);
    expect(retry(2, new TypeError('network'))).toBe(false);
  });
});
