import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { apiError, useOrpc } from '@swint/web-data-access-api';
import { Button, CopyField, Dialog } from '@swint/web-ui-primitives';

export function CreateSessionDialog() {
  const orpc = useOrpc();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState('');
  const [candidateName, setCandidateName] = useState('');
  const templates = useQuery({ ...orpc.templates.list.queryOptions({ input: { includeArchived: false } }), enabled: open });
  const create = useMutation(
    orpc.sessions.create.mutationOptions({ onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.sessions.key() }) }),
  );

  const reset = (next: boolean) => {
    setOpen(next);
    if (!next) {
      create.reset();
      setTemplateId('');
      setCandidateName('');
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({ templateId, candidateName });
  };

  return (
    <>
      <Button onClick={() => reset(true)}>New session</Button>
      <Dialog open={open} onOpenChange={reset} title="New session" description="Pick a template and share the links.">
        {create.data ? (
          <div className="space-y-4">
            <CopyField label="Candidate link" value={create.data.candidateUrl} />
            <CopyField label="Interviewer link" value={create.data.interviewerUrl} />
            <p className="text-xs text-slate-500">
              Send the candidate link only to the candidate. Anyone with it can join as the candidate.
            </p>
            <Link to={`/s/${create.data.session.id}`} className="inline-block rounded-md bg-blue-600 px-4 py-2 text-white">
              Open room
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <label className="block text-sm">
              Template
              <select
                aria-label="Template"
                required
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5"
              >
                <option value="" disabled>
                  Choose a template…
                </option>
                {templates.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              Candidate name
              <input
                aria-label="Candidate name"
                required
                maxLength={100}
                value={candidateName}
                onChange={(e) => setCandidateName(e.target.value)}
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5"
              />
            </label>
            {create.isError ? (
              <p role="alert" className="text-sm text-red-700">
                {apiError(create.error)?.message ?? 'Could not create the session.'}
              </p>
            ) : null}
            <Button type="submit" disabled={create.isPending || !templateId || !candidateName.trim()}>
              Create session
            </Button>
          </form>
        )}
      </Dialog>
    </>
  );
}
