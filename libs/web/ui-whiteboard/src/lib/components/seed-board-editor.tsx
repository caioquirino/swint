import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { SyncedElement } from '@swint/shared-collab-protocol';

export interface SeedBoardEditorProps {
  initialElements: readonly SyncedElement[];
  /** Live (non-deleted, non-image) elements after every scene change. */
  onChange: (elements: SyncedElement[]) => void;
}

/** A local, non-collaborative Excalidraw used to author a template's starting board. */
export function SeedBoardEditor({ initialElements, onChange }: SeedBoardEditorProps) {
  return (
    <div className="h-[420px] w-full overflow-hidden rounded-md border border-slate-300" data-testid="seed-board">
      <Excalidraw
        initialData={{ elements: initialElements as never }}
        UIOptions={{ tools: { image: false } }}
        onChange={(elements) =>
          onChange(
            elements
              .filter((e) => !e.isDeleted && e.type !== 'image')
              .map((e) => structuredClone(e) as unknown as SyncedElement),
          )
        }
      />
    </div>
  );
}
