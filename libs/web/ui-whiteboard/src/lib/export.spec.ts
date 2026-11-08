import { describe, expect, it, vi } from 'vitest';

vi.mock('@excalidraw/excalidraw', () => ({ exportToBlob: vi.fn(), exportToSvg: vi.fn(), serializeAsJSON: vi.fn() }));

const { exportFileName } = await import('./export.js');

describe('exportFileName', () => {
  it('slugs the title and appends the extension', () => {
    expect(exportFileName('Design a URL shortener!', 'png')).toBe('design-a-url-shortener.png');
    expect(exportFileName('   ', 'excalidraw')).toBe('board.excalidraw');
  });
});
