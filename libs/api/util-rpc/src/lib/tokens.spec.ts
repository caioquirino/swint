import { describe, expect, it } from 'vitest';
import { randomToken, sha256Hex } from './tokens.js';

describe('tokens', () => {
  it('randomToken is 32 bytes of base64url and unique', () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });
  it('sha256Hex is the lowercase hex digest', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
