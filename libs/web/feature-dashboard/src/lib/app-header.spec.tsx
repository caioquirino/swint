import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { navigation } from '@swint/web-data-access-api';
import { fakeApi, renderWithApi } from '@swint/web-data-access-api/testing';
import { InterviewerLayout } from './interviewer-layout.js';

describe('InterviewerLayout / AppHeader', () => {
  it('shows the user and logs out through the API', async () => {
    const assign = vi.spyOn(navigation, 'assign').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ redirectUrl: 'http://kc/logout' }), { status: 200 })),
    );
    renderWithApi(<InterviewerLayout />, {
      api: fakeApi({ me: { get: async () => ({ sub: 's', name: 'Ada', email: null, orgId: 'default', roles: ['interviewer'] }) } }),
    });
    expect(await screen.findByText('Ada')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(assign).toHaveBeenCalledWith('http://kc/logout');
    vi.unstubAllGlobals();
  });
});
