import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import type { ParticipantRole } from '@swint/shared-domain';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { initialConnState } from '../lib/conn-state.js';
import type { CollabDoc, CollabSession, CollabSessionFactory, CollabSnapshot } from '../lib/collab-session.js';

function fakeDoc(): CollabDoc {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  return { doc, awareness, provider: { awareness } as unknown as HocuspocusProvider };
}

/** In-memory CollabSession for component tests: drive it with `update()`. */
export function createFakeCollabSession({ role }: { role: ParticipantRole }) {
  const listeners = new Set<() => void>();
  let snapshot: CollabSnapshot = {
    conn: { ...initialConnState, phase: { kind: 'connected' }, everConnected: true },
    sessionState: null,
    notesError: null,
  };
  const session: CollabSession = {
    board: fakeDoc(),
    notes: role === 'interviewer' ? fakeDoc() : null,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy: () => listeners.clear(),
  };
  const update = (patch: Partial<CollabSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const l of [...listeners]) l();
  };
  const factory: CollabSessionFactory = () => session;
  return { session, update, factory };
}
