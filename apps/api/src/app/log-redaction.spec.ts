import { describe, expect, it } from 'vitest';
import { redactUrl, serializeRequest } from './log-redaction.js';

describe('redactUrl', () => {
  it('redacts the invite token in /join/:token', () => {
    expect(redactUrl('/join/abcDEF123_-xyz')).toBe('/join/[redacted]');
    expect(redactUrl('/join/abcDEF123_-xyz?utm=1')).toBe('/join/[redacted]?utm=1');
  });

  it('strips the query string of /auth/callback', () => {
    expect(redactUrl('/auth/callback?code=secret-code&state=s1')).toBe('/auth/callback');
    expect(redactUrl('/auth/callback')).toBe('/auth/callback');
  });

  it('leaves other urls untouched', () => {
    expect(redactUrl('/api/templates?includeArchived=true')).toBe('/api/templates?includeArchived=true');
    expect(redactUrl('/api/room/01ABC')).toBe('/api/room/01ABC');
    expect(redactUrl('/joinery/x')).toBe('/joinery/x');
    expect(redactUrl('/auth/login?returnTo=/s/1')).toBe('/auth/login?returnTo=/s/1');
  });
});

describe('serializeRequest', () => {
  it('serializes like Fastify but with a redacted url', () => {
    const out = serializeRequest({
      method: 'GET',
      url: '/join/raw-token',
      headers: { 'accept-version': '1' },
      host: 'localhost:3000',
      ip: '127.0.0.1',
      socket: { remotePort: 51234 },
    });
    expect(out).toEqual({
      method: 'GET',
      url: '/join/[redacted]',
      version: '1',
      host: 'localhost:3000',
      remoteAddress: '127.0.0.1',
      remotePort: 51234,
    });
    expect(JSON.stringify(out)).not.toContain('raw-token');
  });
});
