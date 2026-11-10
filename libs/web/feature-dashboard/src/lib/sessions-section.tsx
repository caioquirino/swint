import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { SessionStatus } from '@swint/shared-domain';
import { useOrpc } from '@swint/web-data-access-api';
import { Badge, Spinner } from '@swint/web-ui-primitives';

const tone = { created: 'neutral', live: 'success', ended: 'info', cancelled: 'danger' } as const;
const STATUSES: SessionStatus[] = ['created', 'live', 'ended', 'cancelled'];

export function SessionsSection() {
  const orpc = useOrpc();
  const [status, setStatus] = useState<SessionStatus | ''>('');
  const sessions = useQuery(orpc.sessions.list.queryOptions({ input: status ? { status } : {} }));
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Sessions</h2>
        <label className="text-sm">
          Status{' '}
          <select
            aria-label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value as SessionStatus | '')}
            className="rounded border border-slate-300 dark:border-slate-700 px-2 py-1"
          >
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>
      {sessions.isPending ? <Spinner /> : null}
      {sessions.isError ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          Could not load sessions.
        </p>
      ) : null}
      {sessions.data ? (
        <table aria-label="Sessions" className="w-full text-left text-sm">
          <thead className="text-slate-500 dark:text-slate-400">
            <tr>
              <th className="py-2">Candidate</th>
              <th>Template</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {sessions.data.map((s) => (
              <tr key={s.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="py-2">
                  <Link className="text-blue-700 dark:text-blue-400 hover:underline" to={`/s/${s.id}`}>
                    {s.candidateName}
                  </Link>
                </td>
                <td>{s.title}</td>
                <td>
                  <Badge tone={tone[s.status]}>{s.status}</Badge>
                </td>
                <td>{new Date(s.createdAt).toLocaleString()}</td>
              </tr>
            ))}
            {sessions.data.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-4 text-slate-500 dark:text-slate-400">
                  No sessions yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
