import { describe, expect, it } from 'vitest';
import {
  boardSeedSchema,
  createSessionInputSchema,
  roomViewSchema,
  sessionSchema,
  templateInputSchema,
} from './schemas.js';

const session = {
  id: '01JABCDEF0000000000000000',
  title: 'Design a URL shortener',
  candidateName: 'Ada',
  status: 'live',
  startedAt: 1000,
  durationSec: 2700,
  extensionSec: 0,
  endedAt: null,
  endedBy: null,
  cancelReason: null,
  instructionsMd: '# Task',
  rubricMd: '- scalability',
  createdBy: 'sub-1',
  createdAt: 500,
};

describe('templateInputSchema', () => {
  it('accepts a valid template', () => {
    const input = { title: 'URL shortener', instructionsMd: '# Go', rubricMd: '- x', durationMin: 45, boardSeed: null };
    expect(templateInputSchema.parse(input)).toEqual(input);
  });
  it.each([
    { title: '', instructionsMd: '', rubricMd: '', durationMin: 45, boardSeed: null },
    { title: 'x', instructionsMd: '', rubricMd: '', durationMin: 4, boardSeed: null },
    { title: 'x', instructionsMd: '', rubricMd: '', durationMin: 241, boardSeed: null },
  ])('rejects %o', (input) => {
    expect(templateInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('boardSeedSchema', () => {
  it('keeps unknown Excalidraw element fields', () => {
    const seed = { elements: [{ id: 'e1', type: 'rectangle', x: 1, y: 2, version: 1, versionNonce: 7, index: 'a0', isDeleted: false }] };
    expect(boardSeedSchema.parse(seed)).toEqual(seed);
  });
  it('requires an id on each element', () => {
    expect(boardSeedSchema.safeParse({ elements: [{ type: 'rectangle' }] }).success).toBe(false);
  });
});

describe('createSessionInputSchema', () => {
  it('trims and requires a candidate name', () => {
    expect(createSessionInputSchema.parse({ templateId: 't1', candidateName: '  Ada  ' }).candidateName).toBe('Ada');
    expect(createSessionInputSchema.safeParse({ templateId: 't1', candidateName: '   ' }).success).toBe(false);
  });
});

describe('sessionSchema', () => {
  it('accepts a valid session and rejects an unknown status', () => {
    expect(sessionSchema.parse(session)).toEqual(session);
    expect(sessionSchema.safeParse({ ...session, status: 'paused' }).success).toBe(false);
  });
});

describe('roomViewSchema', () => {
  const candidateView = {
    role: 'candidate',
    sessionId: session.id,
    title: session.title,
    status: 'live',
    timer: { startedAt: 1000, durationSec: 2700, extensionSec: 0 },
    instructionsMd: '# Task',
    me: { name: 'Ada' },
  };

  it('accepts a candidate view', () => {
    expect(roomViewSchema.parse(candidateView)).toEqual(candidateView);
  });

  it('strips rubric and other private fields from candidate views', () => {
    const parsed = roomViewSchema.parse({ ...candidateView, rubricMd: 'SECRET', cancelReason: 'SECRET' });
    expect(parsed).not.toHaveProperty('rubricMd');
    expect(parsed).not.toHaveProperty('cancelReason');
  });

  it('allows instructions to be null for a candidate in the waiting room', () => {
    expect(roomViewSchema.parse({ ...candidateView, status: 'created', instructionsMd: null }).role).toBe('candidate');
  });

  it('interviewer view includes rubric', () => {
    const view = {
      ...candidateView,
      role: 'interviewer',
      rubricMd: '- x',
      candidateName: 'Ada',
      me: { name: 'Grace', sub: 'sub-1' },
    };
    expect(roomViewSchema.parse(view)).toMatchObject({ role: 'interviewer', rubricMd: '- x' });
  });
});
