import type { SessionRecord } from '@swint/api-data-access-persistence';

/** Notified after every successful lifecycle change. Plan 3 broadcasts session.state to collaborators. */
export interface SessionEvents {
  sessionChanged(session: SessionRecord): void | Promise<void>;
}

export const noopSessionEvents: SessionEvents = { sessionChanged: () => undefined };
