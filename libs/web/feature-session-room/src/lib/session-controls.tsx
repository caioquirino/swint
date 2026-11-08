import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { EXTENSION_MINUTES, isFinished, type SessionStatus } from '@swint/shared-domain';
import { apiError, useOrpc } from '@swint/web-data-access-api';
import { Button, CopyField, Dialog } from '@swint/web-ui-primitives';

const describeError = (err: unknown): string =>
  apiError(err)?.code === 'CONFLICT'
    ? 'The session changed in the meantime. The view has been refreshed; please try again.'
    : 'Something went wrong. Please try again.';

/** Interviewer commands (spec §6). The server is authoritative; state updates arrive via session.state. */
export function SessionControls({ sessionId, status }: { sessionId: string; status: SessionStatus }) {
  const orpc = useOrpc();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.room.key() });
  const opts = { onSettled: refresh };
  const start = useMutation(orpc.sessions.start.mutationOptions(opts));
  const extend = useMutation(orpc.sessions.extend.mutationOptions(opts));
  const end = useMutation(orpc.sessions.end.mutationOptions(opts));
  const cancel = useMutation(orpc.sessions.cancel.mutationOptions(opts));
  const invite = useMutation(orpc.sessions.regenerateInvite.mutationOptions());
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);

  if (isFinished(status)) return null;
  const failed = [start, extend, end, cancel, invite].find((m) => m.isError);
  const busy = [start, extend, end, cancel].some((m) => m.isPending);

  const submitCancel = (e: FormEvent) => {
    e.preventDefault();
    cancel.mutate({ id: sessionId, reason: reason.trim() || undefined }, { onSuccess: () => setCancelOpen(false) });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === 'created' ? <Button size="sm" disabled={busy} onClick={() => start.mutate({ id: sessionId })}>Start interview</Button> : null}
      {status === 'live'
        ? EXTENSION_MINUTES.map((minutes) => (
            <Button key={minutes} size="sm" variant="secondary" disabled={busy} onClick={() => extend.mutate({ id: sessionId, minutes })}>
              +{minutes} min
            </Button>
          ))
        : null}
      {status === 'live' ? (
        <Button size="sm" variant="danger" disabled={busy} onClick={() => window.confirm('End the interview for everyone?') && end.mutate({ id: sessionId })}>
          End interview
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setCancelOpen(true)}>Cancel…</Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={invite.isPending}
        onClick={() => {
          if (window.confirm('Create a new candidate link? The current link stops working immediately.')) {
            invite.mutate({ id: sessionId }, { onSuccess: () => setInviteOpen(true) });
          }
        }}
      >
        New candidate link
      </Button>
      {failed ? <p role="alert" className="text-sm text-red-700">{describeError(failed.error)}</p> : null}

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen} title="Cancel interview" description="The candidate will see that the interview has ended. The reason is never shown to them.">
        <form onSubmit={submitCancel} className="space-y-3">
          <label className="block text-sm">
            Reason (optional, private)
            <textarea value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 p-2" />
          </label>
          <Button type="submit" variant="danger" disabled={cancel.isPending}>Cancel interview</Button>
        </form>
      </Dialog>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen} title="New candidate link" description="The previous link no longer works.">
        {invite.data ? <CopyField label="Candidate link" value={invite.data.candidateUrl} /> : null}
      </Dialog>
    </div>
  );
}
