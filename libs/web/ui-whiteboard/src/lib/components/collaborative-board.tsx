import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { CaptureUpdateAction, Excalidraw, reconcileElements, restoreElements } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import '@excalidraw/excalidraw/index.css';
import type { SyncedElement } from '@swint/shared-collab-protocol';
import { ExcalidrawBinding, type ExcalidrawFns, type SceneApi } from '../binding/excalidraw-binding.js';
import { exportBoard, type ExportFormat } from '../export.js';

/** The real Excalidraw functions. Casts happen here, once, at the boundary to Excalidraw's branded types. */
export const excalidrawFns: ExcalidrawFns = {
  reconcileElements: (local, remote, appState) =>
    reconcileElements(local as never, remote as never, appState as never) as unknown as readonly SyncedElement[],
  restoreElements: (elements) =>
    restoreElements(elements as never, null, { refreshDimensions: false, repairBindings: false }) as unknown as readonly SyncedElement[],
  captureNever: CaptureUpdateAction.NEVER,
};

export interface BoardHandle {
  exportAs(format: ExportFormat): Promise<Blob>;
}

export interface CollaborativeBoardProps {
  doc: Y.Doc;
  awareness: Awareness | null;
  readOnly: boolean;
  onReady?: (handle: BoardHandle) => void;
}

const hasImageFile = (event: ClipboardEvent | null): boolean =>
  Array.from(event?.clipboardData?.files ?? []).some((file) => file.type.startsWith('image/'));

export function CollaborativeBoard({ doc, awareness, readOnly, onReady }: CollaborativeBoardProps) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
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
    onReadyRef.current?.({ exportAs: (format) => exportBoard(api, format) });
    return () => {
      binding.destroy();
      bindingRef.current = null;
    };
  }, [api, doc, awareness]);

  useEffect(() => {
    bindingRef.current?.setReadOnly(readOnly);
  }, [readOnly]);

  return (
    <div className="h-full w-full" data-testid="board">
      <Excalidraw
        excalidrawAPI={setApi}
        isCollaborating
        viewModeEnabled={readOnly}
        UIOptions={{ tools: { image: false } }}
        onChange={(elements, appState) =>
          bindingRef.current?.handleChange(elements as unknown as readonly SyncedElement[], appState)
        }
        onPointerUpdate={({ pointer }) => bindingRef.current?.handlePointer(pointer)}
        onPaste={(_data, event) => !hasImageFile(event)}
      />
    </div>
  );
}
