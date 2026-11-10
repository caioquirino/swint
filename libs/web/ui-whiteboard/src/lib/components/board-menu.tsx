import { useEffect, type RefObject } from 'react';
import { MainMenu } from '@excalidraw/excalidraw';

export type BoardMenuKind = 'none' | 'export';

/** Interviewers get Save to… and Export image… only; candidates get an empty menu (its trigger is hidden by CSS). */
export function BoardMenu({ menu }: { menu: BoardMenuKind }) {
  if (menu === 'none') return <MainMenu />;
  return (
    <MainMenu>
      <MainMenu.DefaultItems.Export />
      <MainMenu.DefaultItems.SaveAsImage />
    </MainMenu>
  );
}

/** Excalidraw's `canvasActions`: `false` also disables the action's keyboard shortcut. */
export function boardCanvasActions(menu: BoardMenuKind) {
  const exporting = menu === 'export';
  return {
    changeViewBackgroundColor: false,
    clearCanvas: false,
    export: exporting ? { saveFileToDisk: true } : (false as const),
    loadScene: false,
    saveAsImage: exporting,
    saveToActiveFile: false,
    toggleTheme: null,
  };
}

/** Shortcuts that would reach hidden menu actions (help, open, save, find, theme). */
const isBlockedShortcut = (event: KeyboardEvent): boolean => {
  const key = event.key.toLowerCase();
  if (key === '?') return true;
  if (key === 'd') return event.shiftKey && event.altKey;
  const mod = event.ctrlKey || event.metaKey;
  return mod && (key === 'o' || key === 'f' || (key === 'e' && event.shiftKey));
};

const isEditable = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])') !== null;

/** Only keys aimed at the board (or at body, where Excalidraw's canvas often leaves focus) are blocked. */
const isBoardTarget = (target: EventTarget | null, board: HTMLElement | null): boolean =>
  target === document.body || (target instanceof Node && board !== null && board.contains(target));

export function useBlockedShortcuts(enabled: boolean, boardRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isBoardTarget(event.target, boardRef.current) || isEditable(event.target) || !isBlockedShortcut(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [enabled, boardRef]);
}
