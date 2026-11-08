import { useState } from 'react';
import type { RoomView } from '@swint/shared-api-contract';
import { InstructionsPanel, PanelBoundary, RubricPanel, TimerBar } from '@swint/web-ui-session-panels';
import { SessionControls } from './session-controls.js';
import { useMergedSessionState } from './session-state.js';

type Tab = 'instructions' | 'rubric' | 'notes';

export function LiveRoom({ view }: { view: RoomView }) {
  const state = useMergedSessionState(view, null);
  const [tab, setTab] = useState<Tab>('instructions');
  const tabs: Tab[] = view.role === 'interviewer' ? ['instructions', 'rubric'] : ['instructions'];
  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-4 border-b border-slate-200 bg-white px-4 py-2">
        <h1 className="font-semibold">{view.title}</h1>
        <TimerBar status={state.status} timer={state.timer} offsetMs={state.offsetMs} />
        <div className="ml-auto">{view.role === 'interviewer' ? <SessionControls sessionId={view.sessionId} status={state.status} /> : null}</div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-96 flex-col border-r border-slate-200 bg-white">
          <div role="tablist" className="flex border-b border-slate-200">
            {tabs.map((t) => (
              <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)} className={tab === t ? 'border-b-2 border-blue-600 px-4 py-2 text-sm font-medium' : 'px-4 py-2 text-sm text-slate-600'}>
                {t === 'instructions' ? 'Instructions' : t === 'rubric' ? 'Rubric' : 'Notes'}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {tab === 'instructions' ? <PanelBoundary title="Instructions"><InstructionsPanel markdown={view.instructionsMd ?? ''} /></PanelBoundary> : null}
            {tab === 'rubric' && view.role === 'interviewer' ? <PanelBoundary title="Rubric"><RubricPanel markdown={view.rubricMd} /></PanelBoundary> : null}
          </div>
        </aside>
        <main aria-label="Board" className="min-w-0 flex-1" />
      </div>
    </div>
  );
}
