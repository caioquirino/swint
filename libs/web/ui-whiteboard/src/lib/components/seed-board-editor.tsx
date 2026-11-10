import { useState } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import '@excalidraw/excalidraw/index.css';
import './collaborative-board.css';
import type { SyncedElement } from '@swint/shared-collab-protocol';
import { isSupportedElementType } from '@swint/shared-collab-protocol';
import type { SceneApi } from '../binding/excalidraw-binding.js';
import { BOARD_APP_STATE, enforceBoardStyle } from '../board-style.js';
import { isSwintLibrary, SWINT_LIBRARY } from '../library/swint-library.js';
import { excalidrawFns } from './collaborative-board.js';

export interface SeedBoardEditorProps {
  initialElements: readonly SyncedElement[];
  /** Live (non-deleted, non-image) elements after every scene change. */
  onChange: (elements: SyncedElement[]) => void;
}

/** A local, non-collaborative Excalidraw used to author a template's starting board. */
export function SeedBoardEditor({ initialElements, onChange }: SeedBoardEditorProps) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  return (
    <div className="swint-board h-[420px] w-full overflow-hidden rounded-md border border-slate-300" data-testid="seed-board">
      <Excalidraw
        excalidrawAPI={setApi}
        initialData={{ elements: initialElements as never, appState: BOARD_APP_STATE, libraryItems: SWINT_LIBRARY as never }}
        UIOptions={{ tools: { image: false } }}
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
      />
    </div>
  );
}
