import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { navigation } from '@swint/web-data-access-api';
import { fakeApi, orpcError, renderWithApi } from '@swint/web-data-access-api/testing';
import { RequireInterviewer, useMe } from './require-interviewer.js';

const me = { sub: 'sub-1', name: 'Ada', email: null, orgId: 'default', roles: ['interviewer'] };
function WhoAmI() {
  return <p>hello {useMe().name}</p>;
}

afterEach(() => vi.restoreAllMocks());

describe('RequireInterviewer', () => {
  it('renders children with the current user', async () => {
    renderWithApi(
      <RequireInterviewer>
        <WhoAmI />
      </RequireInterviewer>,
      { api: fakeApi({ me: { get: async () => me } }) },
    );
    expect(await screen.findByText('hello Ada')).toBeInTheDocument();
  });

  it('sends anonymous visitors to the login page, returning to where they were', async () => {
    const assign = vi.spyOn(navigation, 'assign').mockImplementation(() => undefined);
    renderWithApi(
      <RequireInterviewer>
        <WhoAmI />
      </RequireInterviewer>,
      {
        api: fakeApi({
          me: {
            get: async () => {
              throw orpcError('UNAUTHORIZED');
            },
          },
        }),
        path: '/templates/new?x=1',
      },
    );
    expect(await screen.findByText(/redirecting to sign-in/i)).toBeInTheDocument();
    expect(assign).toHaveBeenCalledWith('/auth/login?returnTo=%2Ftemplates%2Fnew%3Fx%3D1');
  });

  it('explains when the account is not allowed', async () => {
    renderWithApi(
      <RequireInterviewer>
        <WhoAmI />
      </RequireInterviewer>,
      {
        api: fakeApi({
          me: {
            get: async () => {
              throw orpcError('FORBIDDEN');
            },
          },
        }),
      },
    );
    expect(await screen.findByRole('heading', { name: /no access/i })).toBeInTheDocument();
  });
});
