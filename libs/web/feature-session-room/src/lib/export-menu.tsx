import { useState } from 'react';
import { Button } from '@swint/web-ui-primitives';
import { EXPORT_FORMATS, downloadBlob, exportFileName, type BoardHandle } from '@swint/web-ui-whiteboard';

const LABEL = { png: 'Export PNG', svg: 'Export SVG', excalidraw: 'Export .excalidraw' } as const;

export function ExportMenu({ board, title }: { board: BoardHandle | null; title: string }) {
  const [error, setError] = useState(false);
  return (
    <div className="flex items-center gap-2">
      {EXPORT_FORMATS.map((format) => (
        <Button
          key={format}
          size="sm"
          variant="secondary"
          disabled={!board}
          onClick={async () => {
            if (!board) return;
            try {
              setError(false);
              downloadBlob(await board.exportAs(format), exportFileName(title, format));
            } catch {
              setError(true);
            }
          }}
        >
          {LABEL[format]}
        </Button>
      ))}
      {error ? (
        <span role="alert" className="text-sm text-red-700 dark:text-red-400">
          Export failed.
        </span>
      ) : null}
    </div>
  );
}
