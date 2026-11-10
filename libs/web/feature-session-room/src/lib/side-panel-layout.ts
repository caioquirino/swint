export const PANEL_STORAGE_KEY = 'swint.room.panel';
export const PANEL_DEFAULT_WIDTH = 384;
export const PANEL_MIN_WIDTH = 240;
export const PANEL_MAX_WIDTH = 720;
export const PANEL_KEY_STEP = 16;

export interface PanelLayout {
  width: number;
  collapsed: boolean;
}

/** Clamps to [MIN, min(MAX, 60% of the viewport)]; the minimum wins on tiny viewports. */
export function clampWidth(w: number, viewport: number): number {
  const max = Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, viewport * 0.6));
  return Math.round(Math.min(max, Math.max(PANEL_MIN_WIDTH, w)));
}

export function loadPanelLayout(): PanelLayout {
  const defaults = { width: PANEL_DEFAULT_WIDTH, collapsed: false };
  try {
    const raw = localStorage.getItem(PANEL_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<PanelLayout> | null;
    const width = typeof parsed?.width === 'number' && Number.isFinite(parsed.width) ? parsed.width : PANEL_DEFAULT_WIDTH;
    return { width: Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, width)), collapsed: parsed?.collapsed === true };
  } catch {
    return defaults;
  }
}

export function savePanelLayout(layout: PanelLayout): void {
  try {
    localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Storage unavailable (private mode, blocked): the layout just is not remembered.
  }
}
