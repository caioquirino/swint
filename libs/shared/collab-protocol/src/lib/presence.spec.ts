import { describe, expect, it } from 'vitest';
import { AWARENESS_USER_FIELD, awarenessUserSchema } from './awareness.js';
import { PRESENCE_COLORS, candidateUserId, colorForUser, readAwarenessUser, stampAwarenessState } from './presence.js';

const who = { userId: 'sub-1', name: 'Ada', role: 'interviewer' as const };

describe('colorForUser', () => {
  it('is deterministic and picks from the palette', () => {
    expect(colorForUser('sub-1')).toBe(colorForUser('sub-1'));
    expect(PRESENCE_COLORS).toContain(colorForUser('sub-1'));
    expect(PRESENCE_COLORS).toContain(colorForUser(''));
  });
  it('spreads different users over several colours', () => {
    const colors = new Set(Array.from({ length: 50 }, (_, i) => colorForUser(`user-${i}`)));
    expect(colors.size).toBeGreaterThan(3);
  });
});

describe('candidateUserId', () => {
  it('namespaces the session id', () => {
    expect(candidateUserId('s1')).toBe('candidate:s1');
  });
});

describe('stampAwarenessState', () => {
  it('overwrites identity fields claimed by the client', () => {
    const state = {
      [AWARENESS_USER_FIELD]: { userId: 'evil', name: 'Mallory', role: 'interviewer', color: '#000000', selectedElementIds: {} },
    };
    const out = stampAwarenessState(state, { userId: 'candidate:s1', name: 'Bo', role: 'candidate' });
    expect(out[AWARENESS_USER_FIELD]).toEqual({
      userId: 'candidate:s1',
      name: 'Bo',
      role: 'candidate',
      color: colorForUser('candidate:s1'),
      selectedElementIds: {},
    });
  });
  it('keeps a valid pointer and selection, drops invalid ones and unknown user keys', () => {
    const ok = stampAwarenessState(
      { [AWARENESS_USER_FIELD]: { pointer: { x: 1, y: 2, tool: 'laser' }, selectedElementIds: { a: true }, isAdmin: true } },
      who,
    );
    expect(ok[AWARENESS_USER_FIELD]).toMatchObject({ pointer: { x: 1, y: 2, tool: 'laser' }, selectedElementIds: { a: true } });
    expect(ok[AWARENESS_USER_FIELD]).not.toHaveProperty('isAdmin');
    const bad = stampAwarenessState({ [AWARENESS_USER_FIELD]: { pointer: { x: 'no' }, selectedElementIds: { a: 'yes' } } }, who);
    expect(bad[AWARENESS_USER_FIELD]).not.toHaveProperty('pointer');
    expect((bad[AWARENESS_USER_FIELD] as { selectedElementIds: object }).selectedElementIds).toEqual({});
  });
  it('drops oversized selections', () => {
    const huge = Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`e${i}`, true]));
    const out = stampAwarenessState({ [AWARENESS_USER_FIELD]: { selectedElementIds: huge } }, who);
    expect((out[AWARENESS_USER_FIELD] as { selectedElementIds: object }).selectedElementIds).toEqual({});
  });
  it('preserves other awareness fields (e.g. the TipTap cursor) and adds a user when none was sent', () => {
    const out = stampAwarenessState({ cursor: { anchor: 1 } }, who);
    expect(out['cursor']).toEqual({ anchor: 1 });
    expect(awarenessUserSchema.safeParse(out[AWARENESS_USER_FIELD]).success).toBe(true);
  });
  it('truncates long names and never produces an empty one', () => {
    const long = stampAwarenessState({}, { ...who, name: 'x'.repeat(150) });
    expect((long[AWARENESS_USER_FIELD] as { name: string }).name).toHaveLength(100);
    const empty = stampAwarenessState({}, { ...who, name: '' });
    expect((empty[AWARENESS_USER_FIELD] as { name: string }).name).toBe('Unknown');
  });
});

describe('readAwarenessUser', () => {
  it('returns the parsed user or null', () => {
    const stamped = stampAwarenessState({}, who);
    expect(readAwarenessUser(stamped)?.name).toBe('Ada');
    expect(readAwarenessUser({ [AWARENESS_USER_FIELD]: { name: 'x' } })).toBeNull();
    expect(readAwarenessUser(undefined)).toBeNull();
  });
});
