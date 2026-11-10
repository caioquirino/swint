import { describe, expect, it, vi } from 'vitest';
import type { SyncedElement } from '@swint/shared-collab-protocol';
import { CLEAN_ROUGHNESS, FONT_CODE, FONT_NORMAL, enforceBoardStyle, normalizeStyle } from './board-style.js';

const rect = (extra: Record<string, unknown> = {}) =>
  ({ id: 'r', type: 'rectangle', version: 3, versionNonce: 1, index: 'a0', isDeleted: false, roughness: 0, ...extra }) as SyncedElement;
const text = (fontFamily: number) =>
  ({ id: 't', type: 'text', version: 2, versionNonce: 1, index: 'a1', isDeleted: false, roughness: 0, fontFamily }) as SyncedElement;

describe('normalizeStyle', () => {
  it('leaves conforming elements untouched (same object)', () => {
    const r = rect();
    expect(normalizeStyle(r)).toBe(r);
    const code = text(FONT_CODE);
    expect(normalizeStyle(code)).toBe(code);
  });

  it('forces clean lines and a new version', () => {
    const out = normalizeStyle(rect({ roughness: 1 })) as SyncedElement & { roughness: number };
    expect(out.roughness).toBe(CLEAN_ROUGHNESS);
    expect(out.version).toBe(4);
  });

  it('turns the hand-written (or any other) font into Normal', () => {
    for (const family of [5, 1, 3, 7]) {
      expect((normalizeStyle(text(family)) as SyncedElement & { fontFamily: number }).fontFamily).toBe(FONT_NORMAL);
    }
  });
});

describe('enforceBoardStyle', () => {
  it('writes the normalized scene back (text re-measured) only when something changed', () => {
    const api = { updateScene: vi.fn(), getSceneElementsIncludingDeleted: () => [], getAppState: () => ({}) };
    const fns = { reconcileElements: vi.fn(), restoreElements: vi.fn(), refreshTextDimensions: vi.fn((els) => els), captureNever: 'NEVER' };
    expect(enforceBoardStyle([rect()], api, fns)).toEqual([rect()]);
    expect(api.updateScene).not.toHaveBeenCalled();

    const out = enforceBoardStyle([rect(), text(5)], api, fns);
    expect((out[1] as SyncedElement & { fontFamily: number }).fontFamily).toBe(FONT_NORMAL);
    expect(fns.refreshTextDimensions).toHaveBeenCalledWith([out[1]]);
    expect(api.updateScene).toHaveBeenCalledWith({ elements: out, captureUpdate: 'NEVER' });
  });
});
