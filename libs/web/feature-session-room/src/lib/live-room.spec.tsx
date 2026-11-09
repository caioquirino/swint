import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AWARENESS_USER_FIELD, candidateUserId, colorForUser } from '@swint/shared-collab-protocol';
import { CollabFactoryProvider, initialConnState, type CollabPhase } from '@swint/web-data-access-collab';
import { createFakeCollabSession } from '@swint/web-data-access-collab/testing';
import { fakeApi, orpcError, renderWithApi } from '@swint/web-data-access-api/testing';

const exportAs = vi.fn(async () => new Blob(['x']));
const downloadBlob = vi.fn();
vi.mock('@swint/web-ui-whiteboard', async () => {
  const { useEffect } = await import('react');
  return {
    CollaborativeBoard: ({ readOnly, onReady }: { readOnly: boolean; onReady?: (h: unknown) => void }) => {
      // Like the real board: the handle is handed out after mount, never during render.
      useEffect(() => onReady?.({ exportAs }), [onReady]);
      return <div data-testid="board" data-readonly={String(readOnly)} />;
    },
    EXPORT_FORMATS: ['png', 'svg', 'excalidraw'],
    exportFileName: (t: string, f: string) => `${t}.${f}`,
    downloadBlob: (...a: unknown[]) => downloadBlob(...a),
  };
});
vi.mock('@swint/web-ui-session-panels', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@swint/web-ui-session-panels')>()),
  NotesEditor: ({ readOnly }: { readOnly: boolean }) => <div data-testid="notes" data-readonly={String(readOnly)} />,
}));

const { SessionRoomPage } = await import('./session-room-page.js');

const timer = { startedAt: Date.now(), durationSec: 2700, extensionSec: 0 };
const candidateView = {
  sessionId: 's1',
  title: 'URL shortener',
  status: 'live',
  timer,
  role: 'candidate',
  instructionsMd: '# Task',
  me: { name: 'Bo' },
};
const interviewerView = { ...candidateView, role: 'interviewer', rubricMd: '- r', candidateName: 'Bo', me: { name: 'Ada', sub: 'sub-1' } };
const stateMsg = (status: 'live' | 'ended' | 'cancelled') => ({
  message: {
    type: 'session.state' as const,
    status,
    startedAt: timer.startedAt,
    durationSec: 2700,
    extensionSec: 0,
    serverNow: Date.now(),
  },
  offsetMs: 0,
});
const phase = (p: CollabPhase, everConnected = true) => ({ conn: { ...initialConnState, phase: p, everConnected } });

function renderLive(view: object, get = vi.fn(async () => view), pollMs?: number) {
  const fake = createFakeCollabSession({ role: (view as { role: 'candidate' | 'interviewer' }).role });
  const utils = renderWithApi(
    <CollabFactoryProvider factory={fake.factory}>
      <SessionRoomPage pollMs={pollMs} />
    </CollabFactoryProvider>,
    { api: fakeApi({ room: { get } }), path: '/s/s1', routePath: '/s/:sessionId' },
  );
  return { ...utils, fake, get };
}

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('LiveRoom (candidate)', () => {
  it('edits the board and announces itself with the server-consistent identity', async () => {
    const { fake } = renderLive(candidateView);
    expect(await screen.findByTestId('board')).toHaveAttribute('data-readonly', 'false');
    await waitFor(() =>
      expect(fake.session.board.awareness.getLocalState()?.[AWARENESS_USER_FIELD]).toEqual({
        userId: candidateUserId('s1'),
        name: 'Bo',
        role: 'candidate',
        color: colorForUser(candidateUserId('s1')),
        selectedElementIds: {},
      }),
    );
    expect(screen.queryByRole('tab', { name: 'Notes' })).not.toBeInTheDocument();
  });

  it('shows the ended screen as soon as session.state says ended', async () => {
    const { fake } = renderLive(candidateView);
    await screen.findByTestId('board');
    act(() => fake.update({ sessionState: stateMsg('ended') }));
    expect(await screen.findByRole('heading', { name: 'The interview has ended' })).toBeInTheDocument();
  });

  it('4403 session_ended → ended screen; invite_revoked → invalid link screen', async () => {
    const a = renderLive(candidateView);
    await screen.findByTestId('board');
    act(() => a.fake.update(phase({ kind: 'closed', reason: 'session_ended' })));
    expect(await screen.findByRole('heading', { name: 'The interview has ended' })).toBeInTheDocument();
    a.unmount();
    const b = renderLive(candidateView);
    await screen.findByTestId('board');
    act(() => b.fake.update(phase({ kind: 'closed', reason: 'invite_revoked' })));
    expect(await screen.findByRole('heading', { name: 'This link is no longer valid' })).toBeInTheDocument();
  });

  it('when the socket is unreachable, probes REST and follows its verdict', async () => {
    const get = vi.fn().mockResolvedValueOnce(candidateView).mockRejectedValue(orpcError('UNAUTHORIZED'));
    const { fake } = renderLive(candidateView, get);
    await screen.findByTestId('board');
    act(() => fake.update(phase({ kind: 'unreachable' })));
    expect(await screen.findByRole('heading', { name: 'This link is no longer valid' })).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('not_started → back to the waiting room via REST', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce(candidateView)
      .mockResolvedValue({ ...candidateView, status: 'created', instructionsMd: null });
    const { fake } = renderLive(candidateView, get);
    await screen.findByTestId('board');
    act(() => fake.update(phase({ kind: 'rejected', reason: 'not_started' })));
    expect(await screen.findByRole('heading', { name: /waiting for your interviewer/i })).toBeInTheDocument();
  });

  it('not_started while REST already says live → remounts and reconnects with a new session', async () => {
    const fake = createFakeCollabSession({ role: 'candidate' });
    const factory = vi.fn(() => {
      // a fresh session starts connected again
      fake.update(phase({ kind: 'connected' }));
      return fake.session;
    });
    const get = vi.fn(async () => candidateView);
    renderWithApi(
      <CollabFactoryProvider factory={factory}>
        <SessionRoomPage pollMs={30} />
      </CollabFactoryProvider>,
      { api: fakeApi({ room: { get } }), path: '/s/s1', routePath: '/s/:sessionId' },
    );
    await screen.findByTestId('board');
    const before = factory.mock.calls.length;
    act(() => fake.update(phase({ kind: 'rejected', reason: 'not_started' })));
    await waitFor(() => expect(factory.mock.calls.length).toBeGreaterThan(before));
    expect(await screen.findByTestId('board')).toBeInTheDocument();
  });

  it('keeps re-probing REST while the socket stays unreachable', async () => {
    const { fake, get } = renderLive(candidateView, undefined, 30);
    await screen.findByTestId('board');
    act(() => fake.update(phase({ kind: 'unreachable' })));
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThanOrEqual(4));
  });

  it('shows connection banners', async () => {
    const { fake } = renderLive(candidateView);
    await screen.findByTestId('board');
    act(() => fake.update(phase({ kind: 'reconnecting' })));
    expect(await screen.findByRole('status')).toHaveTextContent(/reconnecting/i);
    act(() => fake.update(phase({ kind: 'connected' })));
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });
});

describe('LiveRoom (interviewer)', () => {
  it('has notes; after the session ends everything is read-only and exportable', async () => {
    const { fake } = renderLive(interviewerView);
    expect(await screen.findByTestId('board')).toHaveAttribute('data-readonly', 'false');
    await userEvent.click(screen.getByRole('tab', { name: 'Notes' }));
    expect(screen.getByTestId('notes')).toHaveAttribute('data-readonly', 'false');
    expect(screen.queryByRole('button', { name: /export png/i })).not.toBeInTheDocument();

    act(() => fake.update({ sessionState: stateMsg('ended') }));
    await waitFor(() => expect(screen.getByTestId('board')).toHaveAttribute('data-readonly', 'true'));
    expect(screen.getByTestId('notes')).toHaveAttribute('data-readonly', 'true');
    expect(screen.queryByRole('button', { name: 'End interview' })).not.toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveAttribute('data-phase', 'ended');

    await userEvent.click(screen.getByRole('button', { name: /export png/i }));
    expect(exportAs).toHaveBeenCalledWith('png');
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'URL shortener.png');
  });

  it('is read-only when the server granted only read access (revisit after the end)', async () => {
    const { fake } = renderLive(interviewerView);
    await screen.findByTestId('board');
    act(() => fake.update({ conn: { ...initialConnState, phase: { kind: 'connected' }, everConnected: true, readOnly: true } }));
    await waitFor(() => expect(screen.getByTestId('board')).toHaveAttribute('data-readonly', 'true'));
  });

  it('4403 session_ended: read-only at once, then REST confirms ended and export appears', async () => {
    let resolveSecond: (v: unknown) => void = () => undefined;
    const get = vi
      .fn()
      .mockResolvedValueOnce(interviewerView)
      .mockReturnValueOnce(
        new Promise((r) => {
          resolveSecond = r;
        }),
      );
    const { fake } = renderLive(interviewerView, get);
    await screen.findByTestId('board');
    act(() => fake.update(phase({ kind: 'closed', reason: 'session_ended' })));
    await waitFor(() => expect(screen.getByTestId('board')).toHaveAttribute('data-readonly', 'true'));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await act(async () => resolveSecond({ ...interviewerView, status: 'ended' }));
    expect(await screen.findByRole('button', { name: /export png/i })).toBeInTheDocument();
    expect(screen.getByTestId('board')).toHaveAttribute('data-readonly', 'true');
  });
});
