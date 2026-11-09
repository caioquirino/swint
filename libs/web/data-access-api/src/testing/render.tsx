import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { ApiProvider } from '../lib/react.js';
import type { ApiClient } from '../lib/client.js';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

export interface RenderWithApiOptions {
  api: ApiClient;
  /** Initial URL. Default '/'. */
  path?: string;
  /** Route pattern that renders `ui`, e.g. '/s/:sessionId'. Default '*'. */
  routePath?: string;
}

export function renderWithApi(
  ui: ReactElement,
  { api, path = '/', routePath = '*' }: RenderWithApiOptions,
): RenderResult & { queryClient: QueryClient } {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={api}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={routePath} element={ui} />
            {routePath === '*' ? null : <Route path="*" element={null} />}
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </ApiProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}
