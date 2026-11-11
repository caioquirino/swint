import { useEffect, useRef, useState } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import '@excalidraw/excalidraw/index.css';
import './collaborative-board.css';
import type { SyncedElement } from '@swint/shared-collab-protocol';
import { isSupportedElementType } from '@swint/shared-collab-protocol';
import type { SceneApi } from '../binding/excalidraw-binding.js';
import { BOARD_APP_STATE, enforceBoardStyle } from '../board-style.js';
import { isSwintLibrary, SWINT_LIBRARY } from '../library/swint-library.js';
import { BoardMenu, blockFileDrop, boardCanvasActions, useBlockedShortcuts } from './board-menu.js';
import { excalidrawFns } from './collaborative-board.js';

/** Lets the host re-measure the board after its container was hidden or resized. */
export interface SeedBoardHandle {
  refresh(): void;
}

export interface SeedBoardEditorProps {
  initialElements: readonly SyncedElement[];
  /** Live (non-deleted, non-image) elements after every scene change. */
  onChange: (elements: SyncedElement[]) => void;
  theme?: 'light' | 'dark';
  /** Called once Excalidraw is ready. */
  onReady?: (handle: SeedBoardHandle) => void;
}

/** A local, non-collaborative Excalidraw used to author a template's starting board. */
export function SeedBoardEditor({ initialElements, onChange, theme = 'light', onReady }: SeedBoardEditorProps) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  useBlockedShortcuts('export', containerRef);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => {
    if (api) onReadyRef.current?.({ refresh: () => api.refresh() });
  }, [api]);
  return (
    <div
      ref={containerRef}
      className="swint-board relative h-full min-h-[320px] w-full overflow-hidden rounded-md border border-slate-300 dark:border-slate-700"
      data-testid="seed-board"
      onDragOverCapture={blockFileDrop}
      onDropCapture={blockFileDrop}
    >
      {/* Excalidraw sizes itself to 100% of its parent. An absolutely positioned layer resolves that against the board's
          real height even when the board only has its min-height (no definite height from the page), so it never collapses. */}
      <div className="absolute inset-0">
        <Excalidraw
          excalidrawAPI={setApi}
          initialData={{ elements: initialElements as never, appState: BOARD_APP_STATE, libraryItems: SWINT_LIBRARY as never }}
          theme={theme}
          UIOptions={{ tools: { image: false }, canvasActions: boardCanvasActions('export') }}
          onLibraryChange={(items) => {
            if (!isSwintLibrary(items)) void api?.updateLibrary({ libraryItems: SWINT_LIBRARY as never, merge: false });
          }}
          onChange={(elements) => {
            const live = (elements as unknown as readonly SyncedElement[]).filter(
              (e) => !e.isDeleted && isSupportedElementType((e as { type?: unknown }).type),
            );
            const styled = api ? enforceBoardStyle(live, api as unknown as SceneApi, excalidrawFns) : live;
            onChange(styled.map((e) => structuredClone(e)));
          }}
        >
          <BoardMenu menu="export" />
        </Excalidraw>
      </div>
    </div>
  );
}
