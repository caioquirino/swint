import { createORPCClient } from '@orpc/client';
import type { ContractRouterClient } from '@orpc/contract';
import { OpenAPILink } from '@orpc/openapi-client/fetch';
import { contract } from '@swint/shared-api-contract';

export type ApiClient = ContractRouterClient<typeof contract>;

export interface ApiClientOptions {
  /** Default: `${window.location.origin}/api` (same origin; the dev server proxies /api). */
  baseUrl?: string;
  fetch?: typeof fetch;
}

export function createApiClient(opts: ApiClientOptions = {}): ApiClient {
  const doFetch = opts.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  const link = new OpenAPILink(contract, {
    url: opts.baseUrl ?? `${window.location.origin}/api`,
    fetch: (request, init) => doFetch(request, { ...init, credentials: 'same-origin' }),
  });
  return createORPCClient(link);
}
