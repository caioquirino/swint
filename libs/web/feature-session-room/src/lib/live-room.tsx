import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { RoomView } from '@swint/shared-api-contract';
import { AWARENESS_USER_FIELD } from '@swint/shared-collab-protocol';
import { isFinished } from '@swint/shared-domain';
import { useOrpc } from '@swint/web-data-access-api';
import { usePresence, useCollabSession } from '@swint/web-data-access-collab';
import { Screen, Spinner } from '@swint/web-ui-primitives';
import {
  ConnectionBanner,
  InstructionsPanel,
  NotesEditor,
  PanelBoundary,
  ParticipantList,
  RubricPanel,
  TimerBar,
} from '@swint/web-ui-session-panels';
import { CollaborativeBoard, type BoardHandle } from '@swint/web-ui-whiteboard';
import { bannerState, myPresence } from './connection.js';
import { ExportMenu } from './export-menu.js';
import { InterviewEndedScreen, LinkInvalidScreen, RoomUnavailableScreen } from './screens.js';
import { SessionControls } from './session-controls.js';
import { useMergedSessionState } from './session-state.js';

type Tab = 'instructions' | 'rubric' | 'notes';

export function LiveRoom({ view }: { view: RoomView }) {
  const orpc = useOrpc();
  const queryClient = useQueryClient();
  const { session, snapshot } = useCollabSession({ sessionId: view.sessionId, role: view.role });
  const state = useMergedSessionState(view, snapshot?.sessionState ?? null);
  const participants = usePresence(session?.board.awareness ?? null);
  const [tab, setTab] = useState<Tab>('instructions');
  const [board, setBoard] = useState<BoardHandle | null>(null);
  const me = myPresence(view);
  const phase = snapshot?.conn.phase;
  const finished = isFinished(state.status);
  const interviewer = view.role === 'interviewer';
  const terminalReason = phase && (phase.kind === 'rejected' || phase.kind === 'closed') ? phase.reason : null;
  // An interviewer whose socket was closed with session_ended is read-only until REST confirms the end.
  const readOnly = interviewer ? finished || terminalReason === 'session_ended' || Boolean(snapshot?.conn.readOnly) : finished;

  // Announce ourselves. The server re-stamps identity fields anyway (spec §7.3).
  useEffect(() => {
    session?.board.awareness.setLocalStateField(AWARENESS_USER_FIELD, {
      userId: me.userId, name: me.name, role: me.role, color: me.color, selectedElementIds: {},
    });
  }, [session, me.userId, me.name, me.role, me.color]);

  // The REST view decides what the WebSocket cannot tell us: unreachable (maybe a 401 at upgrade), not started, ended.
  const needsProbe = phase?.kind === 'unreachable' || terminalReason === 'not_started' || (interviewer && terminalReason === 'session_ended');
  useEffect(() => {
    if (needsProbe) void queryClient.invalidateQueries({ queryKey: orpc.room.key() });
  }, [needsProbe, queryClient, orpc]);

  if (terminalReason === 'invite_revoked') return <LinkInvalidScreen reason="invite_revoked" />;
  if (!interviewer && (terminalReason === 'session_ended' || finished)) return <InterviewEndedScreen />;
  if (terminalReason === 'forbidden') return <RoomUnavailableScreen />;
  if (terminalReason === 'not_started') return <Screen title="Waiting for the interview to start…"><Spinner /></Screen>;

  const tabs: Tab[] = interviewer ? ['instructions', 'rubric', 'notes'] : ['instructions'];
  const notes = interviewer ? session?.notes ?? null : null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-4 border-b border-slate-200 bg-white px-4 py-2">
        <h1 className="font-semibold">{view.title}</h1>
        <TimerBar status={state.status} timer={state.timer} offsetMs={state.offsetMs} />
        <ParticipantList participants={participants} />
        <div className="ml-auto flex items-center gap-2">
          {interviewer && !finished ? <SessionControls sessionId={view.sessionId} status={state.status} /> : null}
          {interviewer && finished ? <ExportMenu board={board} title={view.title} /> : null}
        </div>
      </header>
      <ConnectionBanner state={bannerState(phase, Boolean(snapshot?.conn.everConnected))} />
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
            {tab === 'notes' && notes ? (
              <PanelBoundary title="Notes">
                {snapshot?.notesError ? (
                  <p className="p-4 text-sm text-slate-600">Notes are unavailable.</p>
                ) : (
                  <NotesEditor doc={notes.doc} awarenessProvider={notes.provider as unknown as { awareness: typeof notes.awareness }} user={{ name: me.name, color: me.color }} readOnly={readOnly} />
                )}
              </PanelBoundary>
            ) : null}
          </div>
        </aside>
        <main aria-label="Board" className="relative min-w-0 flex-1">
          {session ? (
            <PanelBoundary title="Board">
              <CollaborativeBoard doc={session.board.doc} awareness={session.board.awareness} readOnly={readOnly} onReady={setBoard} />
            </PanelBoundary>
          ) : null}
        </main>
      </div>
    </div>
  );
}
