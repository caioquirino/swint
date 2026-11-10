import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const boardApi = { refresh: vi.fn(), updateLibrary: vi.fn() };

vi.mock('@excalidraw/excalidraw/index.css', () => ({}));
vi.mock('./collaborative-board.css', () => ({}));
vi.mock('./collaborative-board.js', () => ({ excalidrawFns: {} }));
vi.mock('@excalidraw/excalidraw', () => ({
  MainMenu: Object.assign(() => null, { DefaultItems: { Export: () => null, SaveAsImage: () => null } }),
  Excalidraw: ({ excalidrawAPI }: { excalidrawAPI?: (api: unknown) => void }) => {
    useEffect(() => excalidrawAPI?.(boardApi), [excalidrawAPI]);
    return <div data-testid="excalidraw" />;
  },
}));

const { SeedBoardEditor } = await import('./seed-board-editor.js');

describe('SeedBoardEditor', () => {
  it('blocks file drops before they reach Excalidraw', () => {
    render(<SeedBoardEditor initialElements={[]} onChange={() => undefined} />);
    const child = screen.getByTestId('excalidraw');
    const onDrop = vi.fn();
    child.addEventListener('drop', onDrop);
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'] } });
    child.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('blocks find, since the board has no search', () => {
    render(<SeedBoardEditor initialElements={[]} onChange={() => undefined} />);
    const press = (init: KeyboardEventInit) => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      screen.getByTestId('excalidraw').dispatchEvent(event);
      return event;
    };
    expect(press({ key: 'f', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(press({ key: 'o', ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it('hands out a refresh handle once Excalidraw is ready', async () => {
    const onReady = vi.fn();
    render(<SeedBoardEditor initialElements={[]} onChange={() => undefined} onReady={onReady} />);
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    onReady.mock.calls[0][0].refresh();
    expect(boardApi.refresh).toHaveBeenCalledTimes(1);
  });

  it('fills its container', () => {
    render(<SeedBoardEditor initialElements={[]} onChange={() => undefined} />);
    expect(screen.getByTestId('seed-board')).toHaveClass('h-full');
    expect(screen.getByTestId('seed-board')).not.toHaveClass('h-[420px]');
  });
});
