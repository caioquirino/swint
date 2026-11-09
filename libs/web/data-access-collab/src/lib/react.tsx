import { createContext, useContext, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import type { AwarenessUser } from '@swint/shared-collab-protocol';
import {
  createCollabSession,
  type CollabSession,
  type CollabSessionFactory,
  type CollabSessionOptions,
  type CollabSnapshot,
} from './collab-session.js';
import { readParticipants } from './presence.js';

const FactoryContext = createContext<CollabSessionFactory>(createCollabSession);

/** Lets tests (and future transports) replace how sessions are created. */
export function CollabFactoryProvider({ factory, children }: { factory: CollabSessionFactory; children: ReactNode }) {
  return <FactoryContext.Provider value={factory}>{children}</FactoryContext.Provider>;
}

const noopSubscribe = () => () => undefined;

/** Creates the room's collab session while mounted (and while `opts` is non-null); destroys it on unmount. */
export function useCollabSession(opts: CollabSessionOptions | null): { session: CollabSession | null; snapshot: CollabSnapshot | null } {
  const factory = useContext(FactoryContext);
  const [session, setSession] = useState<CollabSession | null>(null);
  const sessionId = opts?.sessionId;
  const role = opts?.role;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const current = optsRef.current;
    if (!current) return;
    const created = factory(current);
    setSession(created);
    return () => {
      created.destroy();
      setSession(null);
    };
  }, [factory, sessionId, role]);

  const snapshot = useSyncExternalStore(session ? session.subscribe : noopSubscribe, () => session?.getSnapshot() ?? null);
  return { session, snapshot };
}

export function usePresence(awareness: Awareness | null): AwarenessUser[] {
  const cache = useRef<AwarenessUser[]>([]);
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!awareness) return () => undefined;
      const handler = () => {
        cache.current = readParticipants(awareness);
        onChange();
      };
      handler();
      awareness.on('change', handler);
      return () => awareness.off('change', handler);
    },
    [awareness],
  );
  return useSyncExternalStore(subscribe, () => cache.current);
}
