import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PANEL_DEFAULT_WIDTH,
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  PANEL_STORAGE_KEY,
  clampWidth,
  loadPanelLayout,
  savePanelLayout,
} from './side-panel-layout.js';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('clampWidth', () => {
  it('clamps below the minimum', () => expect(clampWidth(10, 2000)).toBe(PANEL_MIN_WIDTH));
  it('clamps above the maximum', () => expect(clampWidth(5000, 2000)).toBe(PANEL_MAX_WIDTH));
  it('caps at 60% of the viewport', () => expect(clampWidth(700, 1000)).toBe(600));
  it('passes values in range', () => expect(clampWidth(400, 2000)).toBe(400));
});

describe('panel layout storage', () => {
  it('defaults when nothing is stored', () => expect(loadPanelLayout()).toEqual({ width: PANEL_DEFAULT_WIDTH, collapsed: false }));
  it('round-trips', () => {
    savePanelLayout({ width: 500, collapsed: true });
    expect(loadPanelLayout()).toEqual({ width: 500, collapsed: true });
  });
  it('defaults on invalid JSON', () => {
    localStorage.setItem(PANEL_STORAGE_KEY, '{nope');
    expect(loadPanelLayout()).toEqual({ width: PANEL_DEFAULT_WIDTH, collapsed: false });
  });
  it('defaults when storage throws, and saving does not throw', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadPanelLayout()).toEqual({ width: PANEL_DEFAULT_WIDTH, collapsed: false });
    expect(() => savePanelLayout({ width: 300, collapsed: false })).not.toThrow();
  });
});
