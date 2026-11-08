import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import type { ApiClient } from './client.js';

const ApiContext = createContext<ApiClient | null>(null);

export function ApiProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiClient {
  const client = useContext(ApiContext);
  if (!client) throw new Error('useApi must be used inside <ApiProvider>');
  return client;
}

/** TanStack Query utils for the contract: `useQuery(orpc.me.get.queryOptions())`, `orpc.sessions.key()`. */
export function useOrpc() {
  const client = useApi();
  return useMemo(() => createTanstackQueryUtils(client), [client]);
}
