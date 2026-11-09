import { useEffect, useState } from 'react';
import { isFinished, remainingMs, timerPhase, type SessionStatus, type TimerFields } from '@swint/shared-domain';
import { cn } from '@swint/web-ui-primitives';

export function formatClock(ms: number): string {
  const total = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function useNow(intervalMs = 500): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const phaseClass = {
  'not-started': 'bg-slate-100 text-slate-700',
  normal: 'bg-slate-100 text-slate-900',
  warning: 'bg-amber-100 text-amber-900',
  critical: 'bg-red-100 text-red-800',
  overtime: 'bg-red-600 text-white',
  ended: 'bg-slate-200 text-slate-700',
} as const;

export interface TimerBarProps {
  status: SessionStatus;
  timer: TimerFields;
  /** serverNow - clientNow, from session.state. */
  offsetMs: number;
}

/** Spec §6 timer: warnings at 10 and 2 minutes, overtime below zero, frozen once the session is finished. */
export function TimerBar({ status, timer, offsetMs }: TimerBarProps) {
  const now = useNow();
  let phase: keyof typeof phaseClass;
  let label: string;
  if (isFinished(status)) {
    phase = 'ended';
    label = 'Interview ended';
  } else if (status === 'created' || timer.startedAt === null) {
    phase = 'not-started';
    label = `Not started · ${formatClock((timer.durationSec + timer.extensionSec) * 1000)}`;
  } else {
    const remaining = remainingMs(timer, now + offsetMs) ?? 0;
    phase = timerPhase(remaining) as keyof typeof phaseClass;
    label = remaining < 0 ? `+${formatClock(remaining)} overtime` : `${formatClock(remaining)} left`;
  }
  return (
    <span
      role="timer"
      data-phase={phase}
      className={cn('rounded-md px-3 py-1 font-mono text-sm font-semibold tabular-nums', phaseClass[phase])}
    >
      {label}
    </span>
  );
}
