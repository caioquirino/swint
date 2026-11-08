import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeApi, orpcError, renderWithApi } from '@swint/web-data-access-api/testing';
import { SessionControls } from './session-controls.js';

afterEach(() => vi.restoreAllMocks());
const ok = async () => ({});

describe('SessionControls', () => {
  it('offers Start, Cancel and a new candidate link before the interview starts', async () => {
    const start = vi.fn(ok);
    renderWithApi(<SessionControls sessionId="s1" status="created" />, { api: fakeApi({ sessions: { start } }) });
    expect(screen.queryByRole('button', { name: /\+5 min/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start interview' }));
    expect(start).toHaveBeenCalledWith({ id: 's1' }, expect.anything());
    expect(screen.getByRole('button', { name: 'Cancel…' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New candidate link' })).toBeInTheDocument();
  });

  it('extends by 5 and 10 minutes while live', async () => {
    const extend = vi.fn(ok);
    renderWithApi(<SessionControls sessionId="s1" status="live" />, { api: fakeApi({ sessions: { extend } }) });
    await userEvent.click(screen.getByRole('button', { name: '+5 min' }));
    await userEvent.click(screen.getByRole('button', { name: '+10 min' }));
    expect(extend.mock.calls.map((c) => (c as unknown[])[0])).toEqual([{ id: 's1', minutes: 5 }, { id: 's1', minutes: 10 }]);
  });

  it('ends only after confirmation', async () => {
    const end = vi.fn(ok);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderWithApi(<SessionControls sessionId="s1" status="live" />, { api: fakeApi({ sessions: { end } }) });
    await userEvent.click(screen.getByRole('button', { name: 'End interview' }));
    expect(end).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'End interview' }));
    expect(end).toHaveBeenCalledWith({ id: 's1' }, expect.anything());
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('cancels with an optional private reason', async () => {
    const cancel = vi.fn(ok);
    renderWithApi(<SessionControls sessionId="s1" status="live" />, { api: fakeApi({ sessions: { cancel } }) });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancel interview' });
    await userEvent.type(within(dialog).getByLabelText(/reason/i), 'no-show');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel interview' }));
    expect(cancel).toHaveBeenCalledWith({ id: 's1', reason: 'no-show' }, expect.anything());
  });

  it('regenerates the candidate link and shows it', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const regenerateInvite = vi.fn(async () => ({ candidateUrl: 'http://localhost:4200/join/new' }));
    renderWithApi(<SessionControls sessionId="s1" status="live" />, { api: fakeApi({ sessions: { regenerateInvite } }) });
    await userEvent.click(screen.getByRole('button', { name: 'New candidate link' }));
    expect(await screen.findByLabelText('Candidate link')).toHaveValue('http://localhost:4200/join/new');
  });

  it('shows nothing once the session is finished', () => {
    const { container } = renderWithApi(<SessionControls sessionId="s1" status="ended" />, { api: fakeApi({}) });
    expect(within(container).queryAllByRole('button')).toHaveLength(0);
  });

  it('explains a conflict', async () => {
    const start = vi.fn(async () => {
      throw orpcError('CONFLICT');
    });
    renderWithApi(<SessionControls sessionId="s1" status="created" />, { api: fakeApi({ sessions: { start } }) });
    await userEvent.click(screen.getByRole('button', { name: 'Start interview' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/changed/i));
  });
});
