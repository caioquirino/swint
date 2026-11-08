import { exportToBlob, exportToSvg, serializeAsJSON } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';

export type ExportFormat = 'png' | 'svg' | 'excalidraw';
export const EXPORT_FORMATS: readonly ExportFormat[] = ['png', 'svg', 'excalidraw'];

/** Spec §6: exports are generated in the browser from the (read-only) board. */
export async function exportBoard(api: ExcalidrawImperativeAPI, format: ExportFormat): Promise<Blob> {
  const elements = api.getSceneElements();
  const appState = { ...api.getAppState(), exportBackground: true };
  const files = api.getFiles();
  if (format === 'png') return exportToBlob({ elements, appState, files, mimeType: 'image/png' });
  if (format === 'svg') {
    const svg = await exportToSvg({ elements, appState, files });
    return new Blob([svg.outerHTML], { type: 'image/svg+xml' });
  }
  return new Blob([serializeAsJSON(elements, appState, files, 'local')], { type: 'application/json' });
}

export function exportFileName(title: string, format: ExportFormat): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'board'}.${format}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
