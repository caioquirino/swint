import { describe, expect, it } from 'vitest';
import type { SyncedElement } from '@swint/shared-collab-protocol';
import { isSameRevision, shouldReplace, sortByIndex } from './element-order.js';

const el = (id: string, version: number, versionNonce: number, index: string | null = 'a0'): SyncedElement => ({
  id,
  version,
  versionNonce,
  index,
  isDeleted: false,
});

describe('shouldReplace', () => {
  it('replaces when nothing exists', () => {
    expect(shouldReplace(undefined, el('a', 1, 5))).toBe(true);
  });
  it('prefers the higher version', () => {
    expect(shouldReplace(el('a', 2, 5), el('a', 3, 9))).toBe(true);
    expect(shouldReplace(el('a', 3, 9), el('a', 2, 5))).toBe(false);
  });
  it('on equal version, the lower versionNonce wins', () => {
    expect(shouldReplace(el('a', 2, 9), el('a', 2, 5))).toBe(true);
    expect(shouldReplace(el('a', 2, 5), el('a', 2, 9))).toBe(false);
  });
  it('does not replace an identical revision', () => {
    expect(shouldReplace(el('a', 2, 5), el('a', 2, 5))).toBe(false);
  });
});

describe('isSameRevision', () => {
  it('compares version and nonce', () => {
    expect(isSameRevision(el('a', 2, 5), el('a', 2, 5))).toBe(true);
    expect(isSameRevision(el('a', 2, 5), el('a', 2, 6))).toBe(false);
    expect(isSameRevision(undefined, el('a', 2, 5))).toBe(false);
  });
});

describe('sortByIndex', () => {
  it('orders by fractional index, nulls last, id as tie-breaker', () => {
    const sorted = sortByIndex([el('c', 1, 1, null), el('b', 1, 1, 'a1'), el('a', 1, 1, 'a0'), el('d', 1, 1, 'a1')]);
    expect(sorted.map((e) => e.id)).toEqual(['a', 'b', 'd', 'c']);
  });
});
