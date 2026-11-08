import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ApiProvider, navigation } from '@swint/web-data-access-api';
import { fakeApi, orpcError } from '@swint/web-data-access-api/testing';
import { AppRoutes } from './app';

vi.mock('@swint/web-ui-whiteboard', () => ({ SeedBoardEditor: () => null, CollaborativeBoard: () => null, EXPORT_FORMATS: [] }));

function renderAt(path: string, api = fakeApi({})) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ApiProvider client={api}>
        <MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>
      </ApiProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('AppRoutes', () => {
  it('renders the not-found page for unknown paths', () => {
    renderAt('/nope');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it.each([
    ['/link-invalid?reason=session_ended', 'The interview has ended'],
    ['/link-invalid?reason=invite_revoked', 'This link is no longer valid'],
    ['/link-invalid?reason=<script>', 'This link is no longer valid'],
  ])('%s', (path, heading) => {
    renderAt(path);
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
  });

  it.each(['/', '/templates/new', '/templates/t1'])('%s requires an interviewer', async (path) => {
    const assign = vi.spyOn(navigation, 'assign').mockImplementation(() => undefined);
    renderAt(path, fakeApi({ me: { get: async () => { throw orpcError('UNAUTHORIZED'); } } }));
    await screen.findByText(/redirecting to sign-in/i);
    expect(assign).toHaveBeenCalledWith(`/auth/login?returnTo=${encodeURIComponent(path)}`);
  });

  it('/s/:id is open to candidates (no interviewer gate)', async () => {
    renderAt('/s/s1', fakeApi({ room: { get: async () => { throw orpcError('FORBIDDEN', { reason: 'session_ended' }); } } }));
    expect(await screen.findByRole('heading', { name: 'The interview has ended' })).toBeInTheDocument();
  });
});
