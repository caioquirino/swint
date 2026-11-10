import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ResizableAside } from './resizable-aside.js';
import { PANEL_STORAGE_KEY, loadPanelLayout } from './side-panel-layout.js';

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 2000, configurable: true });
});
afterEach(() => localStorage.clear());

const aside = () => document.querySelector('aside') as HTMLElement;
const separator = () => screen.getByRole('separator', { name: 'Resize side panel' });

describe('ResizableAside', () => {
  it('renders at the stored width and exposes it', () => {
    localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify({ width: 500, collapsed: false }));
    render(<ResizableAside>content</ResizableAside>);
    expect(aside().style.width).toBe('500px');
    expect(separator().getAttribute('aria-valuenow')).toBe('500');
  });

  it('drags to a new width and saves on pointer up', () => {
    const onLayoutChange = vi.fn();
    render(<ResizableAside onLayoutChange={onLayoutChange}>content</ResizableAside>);
    fireEvent.pointerDown(separator(), { clientX: 384, pointerId: 1 });
    fireEvent.pointerMove(separator(), { clientX: 484, pointerId: 1 });
    expect(aside().style.width).toBe('484px');
    expect(onLayoutChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(separator(), { clientX: 484, pointerId: 1 });
    expect(loadPanelLayout().width).toBe(484);
    expect(onLayoutChange).toHaveBeenCalledTimes(1);
  });

  it('clamps a drag past the maximum', () => {
    render(<ResizableAside>content</ResizableAside>);
    fireEvent.pointerDown(separator(), { clientX: 384, pointerId: 1 });
    fireEvent.pointerMove(separator(), { clientX: 1900, pointerId: 1 });
    fireEvent.pointerUp(separator(), { clientX: 1900, pointerId: 1 });
    expect(aside().style.width).toBe('720px');
  });

  it('resizes with ArrowRight and resets on double click', () => {
    const onLayoutChange = vi.fn();
    render(<ResizableAside onLayoutChange={onLayoutChange}>content</ResizableAside>);
    fireEvent.keyDown(separator(), { key: 'ArrowRight' });
    expect(aside().style.width).toBe('400px');
    expect(onLayoutChange).toHaveBeenCalledTimes(1);
    fireEvent.doubleClick(separator());
    expect(aside().style.width).toBe('384px');
    expect(onLayoutChange).toHaveBeenCalledTimes(2);
  });

  it('collapses keeping children mounted, and restores the width on expand', () => {
    const onLayoutChange = vi.fn();
    render(<ResizableAside onLayoutChange={onLayoutChange}>content</ResizableAside>);
    fireEvent.keyDown(separator(), { key: 'ArrowRight' });
    fireEvent.click(screen.getByRole('button', { name: 'Collapse side panel', hidden: true }));
    expect(aside().hidden).toBe(true);
    expect(screen.getByText('content')).toBeTruthy();
    expect(loadPanelLayout().collapsed).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Expand side panel' }));
    expect(aside().hidden).toBe(false);
    expect(aside().style.width).toBe('400px');
    expect(onLayoutChange).toHaveBeenCalledTimes(3);
  });
});
