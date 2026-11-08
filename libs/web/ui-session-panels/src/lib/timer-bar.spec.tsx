import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { TimerBar, formatClock } from './timer-bar.js';

const T0 = 1_700_000_000_000;
const timer = { startedAt: T0, durationSec: 45 * 60, extensionSec: 0 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

describe('formatClock', () => {
  it.each([
    [0, '00:00'],
    [61_000, '01:01'],
    [45 * 60_000, '45:00'],
    [3_725_000, '1:02:05'],
    [-90_000, '01:30'],
  ])('%i ms -> %s', (ms, text) => expect(formatClock(ms)).toBe(text));
});

describe('TimerBar', () => {
  it('counts down using the server offset and moves through warning, critical, overtime', () => {
    render(<TimerBar status="live" timer={timer} offsetMs={0} />);
    expect(screen.getByRole('timer')).toHaveTextContent('45:00 left');
    expect(screen.getByRole('timer')).toHaveAttribute('data-phase', 'normal');
    act(() => vi.advanceTimersByTime(36 * 60_000));
    expect(screen.getByRole('timer')).toHaveAttribute('data-phase', 'warning');
    act(() => vi.advanceTimersByTime(8 * 60_000));
    expect(screen.getByRole('timer')).toHaveAttribute('data-phase', 'critical');
    act(() => vi.advanceTimersByTime(2 * 60_000));
    expect(screen.getByRole('timer')).toHaveAttribute('data-phase', 'overtime');
    expect(screen.getByRole('timer')).toHaveTextContent('+01:00 overtime');
  });

  it('applies the server clock offset', () => {
    render(<TimerBar status="live" timer={timer} offsetMs={60_000} />);
    expect(screen.getByRole('timer')).toHaveTextContent('44:00 left');
  });

  it('includes extensions', () => {
    render(<TimerBar status="live" timer={{ ...timer, extensionSec: 600 }} offsetMs={0} />);
    expect(screen.getByRole('timer')).toHaveTextContent('55:00 left');
  });

  it('shows the planned duration before start', () => {
    render(<TimerBar status="created" timer={{ ...timer, startedAt: null }} offsetMs={0} />);
    expect(screen.getByRole('timer')).toHaveAttribute('data-phase', 'not-started');
    expect(screen.getByRole('timer')).toHaveTextContent('Not started · 45:00');
  });

  it.each(['ended', 'cancelled'] as const)('is frozen once the session is %s, even deep into overtime', (status) => {
    render(<TimerBar status={status} timer={timer} offsetMs={0} />);
    act(() => vi.advanceTimersByTime(3 * 60 * 60_000));
    expect(screen.getByRole('timer')).toHaveAttribute('data-phase', 'ended');
    expect(screen.getByRole('timer')).toHaveTextContent('Interview ended');
    expect(screen.getByRole('timer')).not.toHaveTextContent('overtime');
  });
});
