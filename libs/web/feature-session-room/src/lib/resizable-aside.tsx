import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import {
  PANEL_DEFAULT_WIDTH,
  PANEL_KEY_STEP,
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  clampWidth,
  loadPanelLayout,
  savePanelLayout,
  type PanelLayout,
} from './side-panel-layout.js';

const BUTTON =
  'flex h-8 w-8 items-center justify-center rounded text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800';

function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d={direction === 'left' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
    </svg>
  );
}

/** The room's side panel: drag or use the arrow keys to resize, collapse to a rail. Persisted per browser. */
export function ResizableAside({ children, onLayoutChange }: { children: ReactNode; onLayoutChange?: () => void }) {
  const [layout, setLayout] = useState<PanelLayout>(loadPanelLayout);
  const [commits, setCommits] = useState(0);
  const widthRef = useRef(layout.width);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const onChangeRef = useRef(onLayoutChange);
  onChangeRef.current = onLayoutChange;

  // Notify after the DOM has the new size, so the board can re-measure.
  useEffect(() => {
    if (commits > 0) onChangeRef.current?.();
  }, [commits]);

  const commit = (next: PanelLayout) => {
    widthRef.current = next.width;
    setLayout(next);
    savePanelLayout(next);
    setCommits((c) => c + 1);
  };

  const viewport = () => window.innerWidth;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = { startX: e.clientX, startWidth: layout.width };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const width = clampWidth(d.startWidth + (e.clientX - d.startX), viewport());
    widthRef.current = width;
    setLayout((l) => ({ ...l, width }));
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    commit({ width: widthRef.current, collapsed: false });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const delta = e.key === 'ArrowRight' ? PANEL_KEY_STEP : -PANEL_KEY_STEP;
    commit({ width: clampWidth(layout.width + delta, viewport()), collapsed: false });
  };

  return (
    <>
      {layout.collapsed ? (
        <div className="flex w-10 shrink-0 flex-col items-center border-r border-slate-200 bg-white py-2 dark:border-slate-800 dark:bg-slate-900">
          <button type="button" aria-label="Expand side panel" className={BUTTON} onClick={() => commit({ ...layout, collapsed: false })}>
            <Chevron direction="right" />
          </button>
        </div>
      ) : null}
      <aside
        hidden={layout.collapsed}
        style={{ width: layout.width }}
        className="relative flex shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
      >
        <button
          type="button"
          aria-label="Collapse side panel"
          className={`${BUTTON} absolute right-2 top-1`}
          onClick={() => commit({ ...layout, collapsed: true })}
        >
          <Chevron direction="left" />
        </button>
        {children}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize side panel"
          aria-valuemin={PANEL_MIN_WIDTH}
          aria-valuemax={PANEL_MAX_WIDTH}
          aria-valuenow={layout.width}
          tabIndex={0}
          className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize touch-none hover:bg-blue-500/40 focus-visible:bg-blue-500/60 focus-visible:outline-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onKeyDown}
          onDoubleClick={() => commit({ width: PANEL_DEFAULT_WIDTH, collapsed: false })}
        />
      </aside>
    </>
  );
}
