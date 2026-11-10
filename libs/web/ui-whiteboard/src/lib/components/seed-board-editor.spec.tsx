import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@excalidraw/excalidraw/index.css', () => ({}));
vi.mock('./collaborative-board.css', () => ({}));
vi.mock('./collaborative-board.js', () => ({ excalidrawFns: {} }));
vi.mock('@excalidraw/excalidraw', () => ({
  MainMenu: Object.assign(() => null, { DefaultItems: { Export: () => null, SaveAsImage: () => null } }),
  Excalidraw: () => <div data-testid="excalidraw" />,
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
});
