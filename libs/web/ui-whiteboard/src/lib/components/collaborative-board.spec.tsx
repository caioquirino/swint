import { describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { act, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { getBoardElements } from '@swint/shared-collab-protocol';

const api = {
  updateScene: vi.fn(),
  getSceneElementsIncludingDeleted: vi.fn(() => []),
  getSceneElements: vi.fn(() => []),
  getAppState: vi.fn(() => ({})),
  getFiles: vi.fn(() => ({})),
  updateLibrary: vi.fn(),
};
let lastProps: Record<string, unknown> = {};
let lastMenuChildren: unknown;

vi.mock('@excalidraw/excalidraw/index.css', () => ({}));
vi.mock('./collaborative-board.css', () => ({}));
vi.mock('@excalidraw/excalidraw', () => ({
  CaptureUpdateAction: { NEVER: 'NEVER', IMMEDIATELY: 'IMMEDIATELY', EVENTUALLY: 'EVENTUALLY' },
  reconcileElements: (_l: unknown[], r: unknown[]) => r,
  restoreElements: (els: unknown[]) => els,
  exportToBlob: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
  exportToSvg: vi.fn(async () => ({ outerHTML: '<svg/>' })),
  serializeAsJSON: vi.fn(() => '{"type":"excalidraw"}'),
  MainMenu: Object.assign(
    (props: { children?: unknown }) => {
      lastMenuChildren = props.children;
      return null;
    },
    { DefaultItems: { Export: () => null, SaveAsImage: () => null } },
  ),
  Excalidraw: (props: Record<string, unknown>) => {
    lastProps = props;
    useEffect(() => {
      (props['excalidrawAPI'] as ((a: unknown) => void) | undefined)?.(api);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
      <div data-testid="excalidraw" data-view-mode={String(props['viewModeEnabled'])}>
        {props['children'] as never}
      </div>
    );
  },
}));

const { CollaborativeBoard } = await import('./collaborative-board.js');

// jsdom's Blob has no text()
const readText = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });

const rect = { id: 'r1', type: 'rectangle', version: 1, versionNonce: 1, index: 'a0', isDeleted: false, x: 0, y: 0, width: 1, height: 1 };

describe('CollaborativeBoard', () => {
  it('renders Excalidraw for collaboration with images disabled', () => {
    render(<CollaborativeBoard doc={new Y.Doc()} awareness={null} readOnly={false} menu="export" />);
    expect(screen.getByTestId('excalidraw')).toHaveAttribute('data-view-mode', 'false');
    expect(lastProps['isCollaborating']).toBe(true);
    expect(lastProps['UIOptions']).toMatchObject({ tools: { image: false } });
  });

  it('switches to view mode when read-only', () => {
    render(<CollaborativeBoard doc={new Y.Doc()} awareness={null} readOnly menu="export" />);
    expect(screen.getByTestId('excalidraw')).toHaveAttribute('data-view-mode', 'true');
  });

  it('applies document elements with captureUpdate NEVER', async () => {
    const doc = new Y.Doc();
    getBoardElements(doc).set('r1', rect);
    api.updateScene.mockClear();
    render(<CollaborativeBoard doc={doc} awareness={null} readOnly={false} menu="export" />);
    await act(async () => undefined);
    expect(api.updateScene).toHaveBeenCalledWith(
      expect.objectContaining({ captureUpdate: 'NEVER', elements: [expect.objectContaining({ id: 'r1' })] }),
    );
  });

  it('refuses pasted image files but allows other pastes', () => {
    render(<CollaborativeBoard doc={new Y.Doc()} awareness={null} readOnly={false} menu="export" />);
    const onPaste = lastProps['onPaste'] as (d: unknown, e: unknown) => boolean;
    const withFiles = (types: string[]) => ({ clipboardData: { files: types.map((type) => ({ type })) } });
    expect(onPaste({}, withFiles(['image/png']))).toBe(false);
    expect(onPaste({}, withFiles([]))).toBe(true);
    expect(onPaste({}, null)).toBe(true);
  });

  it('hands out an export handle', async () => {
    const onReady = vi.fn();
    render(<CollaborativeBoard doc={new Y.Doc()} awareness={null} readOnly menu="export" onReady={onReady} />);
    await act(async () => undefined);
    const handle = onReady.mock.calls[0][0];
    await expect(handle.exportAs('png')).resolves.toBeInstanceOf(Blob);
    const svg = await handle.exportAs('svg');
    expect(svg.type).toBe('image/svg+xml');
    const json = await handle.exportAs('excalidraw');
    expect(await readText(json)).toContain('excalidraw');
  });

  it('exposes the number of visible elements for end-to-end tests', () => {
    render(<CollaborativeBoard doc={new Y.Doc()} awareness={null} readOnly={false} menu="export" />);
    act(() => {
      (lastProps['onChange'] as (els: unknown[], s: unknown) => void)([rect, { ...rect, id: 'gone', isDeleted: true }], {});
    });
    expect(screen.getByTestId('board')).toHaveAttribute('data-element-count', '1');
  });

  it('starts with the Normal font, clean lines and our library, and keeps the library fixed', async () => {
    const { SWINT_LIBRARY } = await import('../library/swint-library.js');
    render(<CollaborativeBoard doc={new Y.Doc()} awareness={null} readOnly={false} menu="export" />);
    const initialData = lastProps['initialData'] as { appState: Record<string, unknown>; libraryItems: unknown };
    expect(initialData.appState).toMatchObject({ currentItemFontFamily: 6, currentItemRoughness: 0 });
    expect(initialData.libraryItems).toBe(SWINT_LIBRARY);
    act(() => {
      (lastProps['onLibraryChange'] as (items: unknown[]) => void)([...SWINT_LIBRARY, { id: 'mine' }]);
    });
    expect(api.updateLibrary).toHaveBeenCalledWith({ libraryItems: SWINT_LIBRARY, merge: false });
    api.updateLibrary.mockClear();
    act(() => {
      (lastProps['onLibraryChange'] as (items: unknown[]) => void)(SWINT_LIBRARY);
    });
    expect(api.updateLibrary).not.toHaveBeenCalled();
  });

  describe('menus and theme', () => {
    const none = {
      changeViewBackgroundColor: false,
      clearCanvas: false,
      export: false,
      loadScene: false,
      saveAsImage: false,
      saveToActiveFile: false,
      toggleTheme: null,
    };
    const press = (init: KeyboardEventInit, target: EventTarget = document.body) => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(event);
      return event;
    };
    const shortcuts: KeyboardEventInit[] = [
      { key: '?', shiftKey: true },
      { key: 'o', ctrlKey: true },
      { key: 'E', ctrlKey: true, shiftKey: true },
      { key: 'f', ctrlKey: true },
      { key: 'D', shiftKey: true, altKey: true },
    ];

    it('menu none: hides the trigger, disables the actions and blocks the shortcuts', () => {
      const { unmount } = render(<CollaborativeBoard doc={new Y.Doc()} awareness={null} readOnly={false} menu="none" />);
      expect(screen.getByTestId('board')).toHaveClass('swint-board--no-menu');
      expect((lastProps['UIOptions'] as { canvasActions: unknown }).canvasActions).toEqual(none);
      const later = vi.fn();
      document.addEventListener('keydown', later);
      for (const init of shortcuts) expect(press(init).defaultPrevented).toBe(true);
      expect(later).not.toHaveBeenCalled();
      document.removeEventListener('keydown', later);
      // Meta works as the modifier, and unrelated keys pass through.
      expect(press({ key: 'o', metaKey: true }).defaultPrevented).toBe(true);
      expect(press({ key: 'o' }).defaultPrevented).toBe(false);
      // Targets inside the board are blocked too.
      expect(press({ key: 'f', ctrlKey: true }, screen.getByTestId('excalidraw')).defaultPrevented).toBe(true);
      // Outside the board (a sibling panel) the browser keeps its keys.
      const outside = document.body.appendChild(document.createElement('button'));
      for (const init of shortcuts) expect(press(init, outside).defaultPrevented).toBe(false);
      outside.remove();
      // Editable targets are left alone.
      for (const tag of ['input', 'textarea']) {
        const el = document.body.appendChild(document.createElement(tag));
        expect(press({ key: 'f', ctrlKey: true }, el).defaultPrevented).toBe(false);
        el.remove();
      }
      const editable = document.body.appendChild(document.createElement('div'));
      for (const value of ['true', '', 'plaintext-only']) {
        editable.setAttribute('contenteditable', value);
        expect(press({ key: 'f', ctrlKey: true }, editable).defaultPrevented).toBe(false);
      }
      editable.remove();
      // Inside the board, an editable child (e.g. Excalidraw's text editor) is left alone too.
      const inner = screen.getByTestId('excalidraw').appendChild(document.createElement('textarea'));
      expect(press({ key: 'f', ctrlKey: true }, inner).defaultPrevented).toBe(false);
      inner.remove();
      unmount();
      for (const init of shortcuts) expect(press(init).defaultPrevented).toBe(false);
    });

    it('menu export: Save to and Export image only, no keys blocked', async () => {
      const { MainMenu } = await import('@excalidraw/excalidraw');
      render(<CollaborativeBoard doc={new Y.Doc()} awareness={null} readOnly={false} menu="export" />);
      expect(screen.getByTestId('board')).not.toHaveClass('swint-board--no-menu');
      expect((lastProps['UIOptions'] as { canvasActions: unknown }).canvasActions).toEqual({
        ...none,
        export: { saveFileToDisk: true },
        saveAsImage: true,
      });
      const items = (Array.isArray(lastMenuChildren) ? lastMenuChildren : [lastMenuChildren]) as { type: unknown }[];
      expect(items.map((c) => c.type)).toEqual([MainMenu.DefaultItems.Export, MainMenu.DefaultItems.SaveAsImage]);
      for (const init of shortcuts) expect(press(init).defaultPrevented).toBe(false);
    });

    it('passes the theme to Excalidraw', () => {
      render(<CollaborativeBoard doc={new Y.Doc()} awareness={null} readOnly={false} menu="export" theme="dark" />);
      expect(lastProps['theme']).toBe('dark');
    });
  });
});
