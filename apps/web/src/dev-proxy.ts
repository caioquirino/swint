import type { ProxyOptions } from 'vite';

/** Paths the API serves. Everything else, including /link-invalid and /s/:id, is the SPA. */
export const PROXIED_PATTERNS = ['^/api/', '^/auth/', '^/join/', '^/collab'] as const;

/** Same-origin dev setup (spec §10): the browser only ever talks to the Vite origin. */
export function devProxy(apiUrl: string): Record<string, ProxyOptions> {
  const target = apiUrl.replace(/\/+$/, '');
  return {
    '^/api/': { target },
    '^/auth/': { target },
    '^/join/': { target },
    '^/collab': { target, ws: true },
  };
}
