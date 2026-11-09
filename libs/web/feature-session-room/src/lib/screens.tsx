import { Link } from 'react-router';
import { loginUrl } from '@swint/web-data-access-api';
import { Screen, Spinner } from '@swint/web-ui-primitives';

export function SignInRequiredScreen({ sessionId }: { sessionId: string }) {
  return (
    <Screen
      title="Sign in to join this interview"
      actions={
        <a className="rounded-md bg-blue-600 px-4 py-2 text-white" href={loginUrl(`/s/${sessionId}`)}>
          Sign in as interviewer
        </a>
      }
    >
      If you are the candidate, open the invitation link you received again.
    </Screen>
  );
}

export function InterviewEndedScreen() {
  return <Screen title="The interview has ended">Thank you for your time. You can close this window.</Screen>;
}

export function LinkInvalidScreen({ reason }: { reason: 'invite_revoked' | 'session_ended' | null }) {
  if (reason === 'session_ended') return <InterviewEndedScreen />;
  return (
    <Screen title="This link is no longer valid">
      {reason === 'invite_revoked'
        ? 'A newer invitation link was issued. Please use the latest link from your interviewer.'
        : 'Please check the link or ask your interviewer for a new one.'}
    </Screen>
  );
}

export function RoomUnavailableScreen() {
  return (
    <Screen
      title="This room is not available"
      actions={
        <Link className="text-blue-700 underline" to="/">
          Go home
        </Link>
      }
    >
      It may not exist, or you may not have access to it.
    </Screen>
  );
}

export function WaitingRoom({ title, name }: { title: string; name: string }) {
  return (
    <Screen title="Waiting for your interviewer to start">
      <p>
        Hi {name}! “{title}” will begin shortly. This page updates automatically.
      </p>
      <div className="mt-4">
        <Spinner label="Waiting…" />
      </div>
    </Screen>
  );
}
