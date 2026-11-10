import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { CaptureUpdateAction, Excalidraw, reconcileElements, restoreElements } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import '@excalidraw/excalidraw/index.css';
import type { SyncedElement } from '@swint/shared-collab-protocol';
import { ExcalidrawBinding, type ExcalidrawFns, type SceneApi } from '../binding/excalidraw-binding.js';
import './collaborative-board.css';
import { BOARD_APP_STATE } from '../board-style.js';
import { isSwintLibrary, SWINT_LIBRARY } from '../library/swint-library.js';
import { BoardMenu, boardCanvasActions, useBlockedShortcuts, type BoardMenuKind } from './board-menu.js';
import { exportBoard, type ExportFormat } from '../export.js';

/** The real Excalidraw functions. Casts happen here, once, at the boundary to Excalidraw's branded types. */
export const excalidrawFns: ExcalidrawFns = {
  reconcileElements: (local, remote, appState) =>
    reconcileElements(local as never, remote as never, appState as never) as unknown as readonly SyncedElement[],
  restoreElements: (elements) =>
    restoreElements(elements as never, null, { refreshDimensions: false, repairBindings: false }) as unknown as readonly SyncedElement[],
  refreshTextDimensions: (elements) =>
    restoreElements(elements as never, null, { refreshDimensions: true, repairBindings: true }) as unknown as readonly SyncedElement[],
  captureNever: CaptureUpdateAction.NEVER,
};

export interface BoardHandle {
  exportAs(format: ExportFormat): Promise<Blob>;
  /** Re-measures the canvas offsets after its container changed size. */
  refresh(): void;
}

export interface CollaborativeBoardProps {
  doc: Y.Doc;
  awareness: Awareness | null;
  readOnly: boolean;
  /** `none`: no main menu at all (candidates). `export`: Save to… and Export image… only (interviewers). */
  menu: BoardMenuKind;
  theme?: 'light' | 'dark';
  onReady?: (handle: BoardHandle) => void;
}

const hasImageFile = (event: ClipboardEvent | null): boolean =>
  Array.from(event?.clipboardData?.files ?? []).some((file) => file.type.startsWith('image/'));

export function CollaborativeBoard({ doc, awareness, readOnly, menu, theme = 'light', onReady }: CollaborativeBoardProps) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const bindingRef = useRef<ExcalidrawBinding | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  useEffect(() => {
    if (!api) return;
    const binding = new ExcalidrawBinding({ doc, api: api as unknown as SceneApi, awareness, fns: excalidrawFns });
    binding.setReadOnly(readOnlyRef.current);
    bindingRef.current = binding;
    onReadyRef.current?.({ exportAs: (format) => exportBoard(api, format), refresh: () => api.refresh() });
    return () => {
      binding.destroy();
      bindingRef.current = null;
    };
  }, [api, doc, awareness]);

  useBlockedShortcuts(menu === 'none', containerRef);

  useEffect(() => {
    bindingRef.current?.setReadOnly(readOnly);
  }, [readOnly]);

  return (
    <div
      ref={containerRef}
      className={`swint-board h-full w-full${menu === 'none' ? ' swint-board--no-menu' : ''}`}
      data-testid="board"
      data-element-count="0"
    >
      <Excalidraw
        excalidrawAPI={setApi}
        isCollaborating
        initialData={{ appState: BOARD_APP_STATE, libraryItems: SWINT_LIBRARY as never }}
        // The library is ours and fixed: any addition, import or removal is undone right away.
        onLibraryChange={(items) => {
          if (!isSwintLibrary(items)) void api?.updateLibrary({ libraryItems: SWINT_LIBRARY as never, merge: false });
        }}
        viewModeEnabled={readOnly}
        theme={theme}
        UIOptions={{ tools: { image: false }, canvasActions: boardCanvasActions(menu) }}
        onChange={(elements, appState) => {
          // Written to the DOM directly (no re-render): e2e tests read it to see remote edits arrive.
          if (containerRef.current) containerRef.current.dataset['elementCount'] = String(elements.filter((e) => !e.isDeleted).length);
          bindingRef.current?.handleChange(elements as unknown as readonly SyncedElement[], appState);
        }}
        onPointerUpdate={({ pointer, button }) => bindingRef.current?.handlePointer(pointer, button)}
        onPaste={(_data, event) => !hasImageFile(event)}
      >
        <BoardMenu menu={menu} />
      </Excalidraw>
    </div>
  );
}
