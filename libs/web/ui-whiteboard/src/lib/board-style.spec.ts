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
    expect(fns.refreshTextDimensions).toHaveBeenCalledWith(out); // whole scene, so containers resolve
    expect(api.updateScene).toHaveBeenCalledWith({ elements: out, captureUpdate: 'NEVER' });
  });

  it('re-measures normalized text with lineHeight 1.35, keeps it bound to its container and leaves other elements alone', () => {
    const api = { updateScene: vi.fn(), getSceneElementsIncludingDeleted: () => [], getAppState: () => ({}) };
    const container = rect({ id: 'c', boundElements: [{ id: 't', type: 'text' }] });
    const bound = { ...text(5), containerId: 'c', width: 10, height: 10 } as SyncedElement;
    const fns = {
      reconcileElements: vi.fn(),
      restoreElements: vi.fn(),
      // Fake re-measure: only elements whose container is in the passed scene keep containerId.
      refreshTextDimensions: vi.fn((els: readonly SyncedElement[]) =>
        els.map((e) => ((e as SyncedElement & { type?: string }).type === 'text' ? ({ ...e, width: 99, height: 99 } as SyncedElement) : e)),
      ),
      captureNever: 'NEVER',
    };
    const out = enforceBoardStyle([container, bound], api, fns);
    expect(out[0]).toBe(container);
    const t = out[1] as SyncedElement & { fontFamily: number; lineHeight: number; containerId: string; width: number };
    expect(t).toMatchObject({ fontFamily: FONT_NORMAL, lineHeight: 1.35, containerId: 'c', width: 99 });
  });
});
