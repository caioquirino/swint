import type { SyncedElement } from '@swint/shared-collab-protocol';
import type { ExcalidrawFns, SceneApi } from './binding/excalidraw-binding.js';

/** Excalidraw 0.18.1 FONT_FAMILY ids (hard-coded: importing them would load the Excalidraw bundle in jsdom). */
export const FONT_NORMAL = 6; // Nunito ("Normal")
/** Nunito's line height (Excalidraw FONT_METADATA); a font change resets lineHeight to the new font's value. */
export const LINE_HEIGHT_NORMAL = 1.35;
export const FONT_CODE = 8; // Comic Shanns ("Code")
export const ALLOWED_FONT_FAMILIES: readonly number[] = [FONT_NORMAL, FONT_CODE];
/** Sloppiness "Architect": clean, straight lines. */
export const CLEAN_ROUGHNESS = 0;

/** Defaults for new elements on every board (collaborative and template editor). */
export const BOARD_APP_STATE = { currentItemFontFamily: FONT_NORMAL, currentItemRoughness: CLEAN_ROUGHNESS } as const;

type Styled = SyncedElement & { type?: string; roughness?: number; fontFamily?: number };

/** Brings one element to the board style. Returns the same object when it already conforms. */
export function normalizeStyle(element: SyncedElement): SyncedElement {
  const e = element as Styled;
  const badLines = typeof e.roughness === 'number' && e.roughness !== CLEAN_ROUGHNESS;
  const badFont = e.type === 'text' && !ALLOWED_FONT_FAMILIES.includes(e.fontFamily ?? -1);
  if (!badLines && !badFont) return element;
  return {
    ...e,
    ...(badLines ? { roughness: CLEAN_ROUGHNESS } : {}),
    ...(badFont ? { fontFamily: FONT_NORMAL, lineHeight: LINE_HEIGHT_NORMAL } : {}),
    // A real edit: peers must see a newer version.
    version: e.version + 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
  } as SyncedElement;
}

/**
 * Normalizes `scene`. When anything changed, re-measures the changed text (fonts have different metrics), writes the
 * result back to Excalidraw without an undo entry, and returns it; otherwise returns `scene` unchanged.
 * Pasted content, old templates and other clients' defaults all pass through here.
 */
export function enforceBoardStyle(scene: readonly SyncedElement[], api: SceneApi, fns: ExcalidrawFns): readonly SyncedElement[] {
  const normalized = scene.map(normalizeStyle);
  const changed = normalized.filter((e, i) => e !== scene[i]);
  if (changed.length === 0) return scene;
  // Re-measure with the whole scene so containers resolve (bound text keeps its container); keep only the changed text.
  const changedTextIds = new Set(changed.filter((e) => (e as Styled).type === 'text').map((e) => e.id));
  const refreshed = changedTextIds.size
    ? new Map(
        fns
          .refreshTextDimensions(normalized)
          .filter((e) => changedTextIds.has(e.id))
          .map((e) => [e.id, e]),
      )
    : new Map<string, SyncedElement>();
  const result = normalized.map((e) => refreshed.get(e.id) ?? e);
  api.updateScene({ elements: result, captureUpdate: fns.captureNever });
  return result;
}
