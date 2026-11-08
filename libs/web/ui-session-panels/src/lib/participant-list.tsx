import type { AwarenessUser } from '@swint/shared-collab-protocol';
import { Badge } from '@swint/web-ui-primitives';

export function ParticipantList({ participants }: { participants: AwarenessUser[] }) {
  return (
    <ul aria-label="Participants" className="flex items-center gap-2">
      {participants.map((p) => (
        <li key={p.userId} className="flex items-center gap-1 text-sm">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} />
          <span>{p.name}</span>
          <Badge tone={p.role === 'interviewer' ? 'info' : 'success'}>{p.role === 'interviewer' ? 'Interviewer' : 'Candidate'}</Badge>
        </li>
      ))}
    </ul>
  );
}
