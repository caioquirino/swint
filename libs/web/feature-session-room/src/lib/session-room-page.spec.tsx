import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { fakeApi, orpcError, renderWithApi } from '@swint/web-data-access-api/testing';
import { CollabFactoryProvider } from '@swint/web-data-access-collab';
import { createFakeCollabSession } from '@swint/web-data-access-collab/testing';
import { SessionRoomPage } from './session-room-page.js';

vi.mock('@swint/web-ui-whiteboard', () => ({
  CollaborativeBoard: () => <div data-testid="board" />,
  EXPORT_FORMATS: ['png', 'svg', 'excalidraw'],
  exportFileName: (t: string, f: string) => `${t}.${f}`,
  downloadBlob: vi.fn(),
}));

const base = { sessionId: 's1', title: 'URL shortener', timer: { startedAt: 1000, durationSec: 2700, extensionSec: 0 } };
const candidate = (status: 'created' | 'live') => ({ ...base, role: 'candidate', status, instructionsMd: status === 'created' ? null : '# Task', me: { name: 'Bo' } });
const interviewer = (status: 'created' | 'live' | 'ended') => ({
  ...base, role: 'interviewer', status, instructionsMd: '# Task', rubricMd: '- secret rubric', candidateName: 'Bo', me: { name: 'Ada', sub: 'sub-1' },
});

const renderRoom = (get: () => Promise<unknown>, pollMs?: number) => {
  const fake = createFakeCollabSession({ role: 'interviewer' });
  return renderWithApi(
    <CollabFactoryProvider factory={fake.factory}><SessionRoomPage pollMs={pollMs} /></CollabFactoryProvider>,
    { api: fakeApi({ room: { get } }), path: '/s/s1', routePath: '/s/:sessionId' },
  );
};

describe('SessionRoomPage gate', () => {
  it('asks anonymous visitors to sign in (or use their invitation link)', async () => {
    renderRoom(async () => { throw orpcError('UNAUTHORIZED'); });
    expect(await screen.findByRole('link', { name: /sign in as interviewer/i })).toHaveAttribute('href', '/auth/login?returnTo=%2Fs%2Fs1');
    expect(screen.getByText(/invitation link/i)).toBeInTheDocument();
  });

  it('shows the ended screen when the candidate session is over', async () => {
    renderRoom(async () => { throw orpcError('FORBIDDEN', { reason: 'session_ended' }); });
    expect(await screen.findByRole('heading', { name: 'The interview has ended' })).toBeInTheDocument();
  });

  it.each([['FORBIDDEN'], ['NOT_FOUND']])('%s → unavailable', async (code) => {
    renderRoom(async () => { throw orpcError(code); });
    expect(await screen.findByRole('heading', { name: 'This room is not available' })).toBeInTheDocument();
  });

  it('keeps a candidate in the waiting room until the interview starts', async () => {
    const get = vi.fn().mockResolvedValueOnce(candidate('created')).mockResolvedValue(candidate('live'));
    renderRoom(get, 20);
    expect(await screen.findByRole('heading', { name: /waiting for your interviewer/i })).toBeInTheDocument();
    expect(screen.queryByText('Task')).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Task' }, { timeout: 2000 })).toBeInTheDocument();
  });

  it('candidates see instructions but no rubric or controls', async () => {
    renderRoom(async () => candidate('live'));
    expect(await screen.findByRole('heading', { name: 'Task' })).toBeInTheDocument();
    expect(screen.queryByText(/secret rubric/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End interview' })).not.toBeInTheDocument();
  });

  it('interviewers see the rubric tab and controls, even before start', async () => {
    renderRoom(async () => interviewer('created'));
    expect(await screen.findByRole('button', { name: 'Start interview' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Rubric' })).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveAttribute('data-phase', 'not-started');
  });
});
