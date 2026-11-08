import { describe, expect, it } from 'vitest';
import { encodeServerMessage, parseServerMessage, type SessionStateMessage } from './stateless.js';
import { isCloseReason } from './close-reasons.js';
import { awarenessUserSchema } from './awareness.js';

const msg: SessionStateMessage = {
  type: 'session.state',
  status: 'live',
  startedAt: 1000,
  durationSec: 2700,
  extensionSec: 300,
  serverNow: 5000,
};

describe('server messages', () => {
  it('round-trips a session.state message', () => {
    expect(parseServerMessage(encodeServerMessage(msg))).toEqual(msg);
  });
  it('returns null for malformed JSON', () => {
    expect(parseServerMessage('{nope')).toBeNull();
  });
  it('returns null for unknown types or bad fields', () => {
    expect(parseServerMessage(JSON.stringify({ ...msg, type: 'session.hack' }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ ...msg, status: 'paused' }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ ...msg, durationSec: -1 }))).toBeNull();
  });
  it('refuses to encode an invalid message', () => {
    expect(() => encodeServerMessage({ ...msg, extensionSec: -5 })).toThrow();
  });
});

describe('close reasons', () => {
  it('recognises known reasons only', () => {
    expect(isCloseReason('session_ended')).toBe(true);
    expect(isCloseReason('whatever')).toBe(false);
    expect(isCloseReason(42)).toBe(false);
  });
});

describe('awareness user', () => {
  it('accepts a valid user and rejects an unknown role', () => {
    const user = { userId: 'u1', name: 'Ada', role: 'candidate', color: '#ff0000', selectedElementIds: { e1: true } };
    expect(awarenessUserSchema.parse(user)).toEqual(user);
    expect(awarenessUserSchema.safeParse({ ...user, role: 'admin' }).success).toBe(false);
  });
});
