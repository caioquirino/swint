import { useParams } from 'react-router';
import { apiError } from '@swint/web-data-access-api';
import { Button, Screen, Spinner } from '@swint/web-ui-primitives';
import { LiveRoom } from './live-room.js';
import { InterviewEndedScreen, RoomUnavailableScreen, SignInRequiredScreen, WaitingRoom } from './screens.js';
import { useRoomQuery } from './use-room.js';

/** /s/:sessionId — one URL for interviewers and the candidate; the server decides the role (spec §5). */
export function SessionRoomPage({ pollMs }: { pollMs?: number }) {
  const { sessionId = '' } = useParams();
  const room = useRoomQuery(sessionId, pollMs);
  const err = apiError(room.error);

  if (err?.code === 'UNAUTHORIZED') return <SignInRequiredScreen sessionId={sessionId} />;
  if (err?.code === 'FORBIDDEN' && err.reason === 'session_ended') return <InterviewEndedScreen />;
  if (err?.code === 'FORBIDDEN' || err?.code === 'NOT_FOUND') return <RoomUnavailableScreen />;
  if (room.data) {
    const view = room.data;
    if (view.role === 'candidate' && view.status === 'created') return <WaitingRoom title={view.title} name={view.me.name} />;
    return <LiveRoom view={view} />;
  }
  if (room.isPending) return <Screen title="Joining…"><Spinner /></Screen>;
  return (
    <Screen title="Could not load the interview" actions={<Button onClick={() => void room.refetch()}>Retry</Button>}>
      Check your connection and try again.
    </Screen>
  );
}
