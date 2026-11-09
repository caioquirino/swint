import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { apiError } from '@swint/web-data-access-api';
import { Button, Screen, Spinner } from '@swint/web-ui-primitives';
import { rememberCandidate, wasCandidate } from './candidate-memory.js';
import { LiveRoom } from './live-room.js';
import { notStartedRetryDelay } from './retry.js';
import { InterviewEndedScreen, LinkInvalidScreen, RoomUnavailableScreen, SignInRequiredScreen, WaitingRoom } from './screens.js';
import { WAITING_POLL_MS, useRoomQuery } from './use-room.js';

/** /s/:sessionId — one URL for interviewers and the candidate; the server decides the role (spec §5). */
export function SessionRoomPage({ pollMs }: { pollMs?: number }) {
  const { sessionId = '' } = useParams();
  const room = useRoomQuery(sessionId, pollMs);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  const err = apiError(room.error);
  const role = room.data?.role;
  useEffect(() => {
    if (role === 'candidate') rememberCandidate(sessionId);
  }, [role, sessionId]);

  if (err?.code === 'UNAUTHORIZED')
    return wasCandidate(sessionId) ? <LinkInvalidScreen reason={null} /> : <SignInRequiredScreen sessionId={sessionId} />;
  if (err?.code === 'FORBIDDEN' && err.reason === 'session_ended') return <InterviewEndedScreen />;
  if (err?.code === 'FORBIDDEN' || err?.code === 'NOT_FOUND') return <RoomUnavailableScreen />;
  if (room.data) {
    const view = room.data;
    if (view.role === 'candidate' && view.status === 'created') return <WaitingRoom title={view.title} name={view.me.name} />;
    return (
      <LiveRoom
        key={attempt}
        view={view}
        onRetry={retry}
        pollMs={pollMs}
        retryDelayMs={notStartedRetryDelay(attempt, pollMs ?? WAITING_POLL_MS)}
      />
    );
  }
  if (room.isPending)
    return (
      <Screen title="Joining…">
        <Spinner />
      </Screen>
    );
  return (
    <Screen title="Could not load the interview" actions={<Button onClick={() => void room.refetch()}>Retry</Button>}>
      Check your connection and try again.
    </Screen>
  );
}
