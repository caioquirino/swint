import { describe, expect, it } from 'vitest';
import { devProxy } from './dev-proxy';

const matches = (proxy: Record<string, unknown>, path: string) => Object.keys(proxy).filter((k) => new RegExp(k).test(path));

describe('devProxy', () => {
  const proxy = devProxy('http://localhost:3000/');

  it('proxies API, auth, join and collab (WebSocket) to the API', () => {
    expect(Object.keys(proxy).sort()).toEqual(['^/api/', '^/auth/', '^/collab', '^/join/'].sort());
    expect(proxy['^/collab']).toEqual({ target: 'http://localhost:3000', ws: true });
    expect(proxy['^/api/']).toEqual({ target: 'http://localhost:3000' });
  });

  it.each(['/api/me', '/auth/login', '/auth/callback?code=x', '/join/tok', '/collab'])('proxies %s', (path) => {
    expect(matches(proxy, path)).toHaveLength(1);
  });

  it.each(['/link-invalid?reason=session_ended', '/s/abc', '/', '/templates/new', '/authors', '/joined'])(
    'leaves %s to the SPA',
    (path) => {
      expect(matches(proxy, path)).toHaveLength(0);
    },
  );
});
