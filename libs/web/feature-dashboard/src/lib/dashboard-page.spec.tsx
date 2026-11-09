import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeApi, renderWithApi } from '@swint/web-data-access-api/testing';
import { DashboardPage } from './dashboard-page.js';

const sessions = [
  { id: 's1', title: 'URL shortener', candidateName: 'Ada', status: 'live', startedAt: 1, createdAt: 1_700_000_000_000 },
  { id: 's2', title: 'Chat app', candidateName: 'Bo', status: 'ended', startedAt: 1, createdAt: 1_700_000_100_000 },
];
const templates = [{ id: 't1', title: 'URL shortener', durationMin: 45, archived: false, updatedAt: 1_700_000_000_000 }];

function api(overrides: Record<string, Record<string, (...a: never[]) => unknown>> = {}) {
  return {
    sessions: { list: vi.fn(async () => sessions), create: vi.fn(), ...overrides['sessions'] },
    templates: {
      list: vi.fn(async () => templates),
      archive: vi.fn(async () => ({ ...templates[0], archived: true })),
      ...overrides['templates'],
    },
  };
}

describe('DashboardPage', () => {
  it('lists sessions (linking to their rooms) and templates (linking to the editor)', async () => {
    const a = api();
    renderWithApi(<DashboardPage />, { api: fakeApi(a) });
    const sessionsTable = await screen.findByRole('table', { name: 'Sessions' });
    expect(within(sessionsTable).getByRole('link', { name: /Ada/ })).toHaveAttribute('href', '/s/s1');
    expect(within(sessionsTable).getByText('ended')).toBeInTheDocument();
    const templatesTable = screen.getByRole('table', { name: 'Templates' });
    expect(within(templatesTable).getByRole('link', { name: 'URL shortener' })).toHaveAttribute('href', '/templates/t1');
    expect(screen.getByRole('link', { name: 'New template' })).toHaveAttribute('href', '/templates/new');
    expect(a.templates.list).toHaveBeenCalledWith({ includeArchived: false }, expect.anything());
  });

  it('filters sessions by status', async () => {
    const a = api();
    renderWithApi(<DashboardPage />, { api: fakeApi(a) });
    await screen.findByRole('table', { name: 'Sessions' });
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'live');
    await waitFor(() => expect(a.sessions.list).toHaveBeenLastCalledWith({ status: 'live' }, expect.anything()));
  });

  it('creates a session and shows both links', async () => {
    const a = api({
      sessions: {
        create: vi.fn(async () => ({
          session: { ...sessions[0], id: 's9' },
          candidateUrl: 'http://localhost:4200/join/tok',
          interviewerUrl: 'http://localhost:4200/s/s9',
        })),
      },
    });
    renderWithApi(<DashboardPage />, { api: fakeApi(a) });
    await userEvent.click(await screen.findByRole('button', { name: 'New session' }));
    const dialog = await screen.findByRole('dialog', { name: 'New session' });
    await userEvent.selectOptions(within(dialog).getByLabelText('Template'), 't1');
    await userEvent.type(within(dialog).getByLabelText('Candidate name'), 'Grace');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create session' }));
    expect(a.sessions.create).toHaveBeenCalledWith({ templateId: 't1', candidateName: 'Grace' }, expect.anything());
    expect(await within(dialog).findByLabelText('Candidate link')).toHaveValue('http://localhost:4200/join/tok');
    expect(within(dialog).getByLabelText('Interviewer link')).toHaveValue('http://localhost:4200/s/s9');
    expect(within(dialog).getByRole('link', { name: 'Open room' })).toHaveAttribute('href', '/s/s9');
  });

  it('archives a template after confirmation', async () => {
    const a = api();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithApi(<DashboardPage />, { api: fakeApi(a) });
    await userEvent.click(await screen.findByRole('button', { name: 'Archive URL shortener' }));
    expect(a.templates.archive).toHaveBeenCalledWith({ id: 't1' }, expect.anything());
  });
});
