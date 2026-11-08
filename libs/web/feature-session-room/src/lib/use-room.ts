import { useQuery } from '@tanstack/react-query';
import { useOrpc } from '@swint/web-data-access-api';

export const WAITING_POLL_MS = 3000;

/** room.get; polls while a candidate waits for the interview to start (spec §6, contract README). */
export function useRoomQuery(sessionId: string, pollMs = WAITING_POLL_MS) {
  const orpc = useOrpc();
  return useQuery({
    ...orpc.room.get.queryOptions({ input: { sessionId } }),
    retry: false,
    refetchInterval: (query) => {
      const view = query.state.data;
      return view && view.role === 'candidate' && view.status === 'created' ? pollMs : false;
    },
  });
}
