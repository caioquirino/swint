import type { ExtensionMinutes, SessionStatus } from './roles.js';

export interface SessionLifecycleState {
  status: SessionStatus;
  startedAt: number | null;
  durationSec: number;
  extensionSec: number;
  endedAt: number | null;
  endedBy: string | null;
  cancelReason: string | null;
}

export type SessionCommand =
  { type: 'start' } | { type: 'extend'; minutes: ExtensionMinutes } | { type: 'end' } | { type: 'cancel'; reason?: string };

export interface CommandContext {
  now: number;
  actorId: string;
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: SessionStatus,
    readonly command: SessionCommand['type'],
  ) {
    super(`Cannot apply "${command}" to a session that is "${from}"`);
    this.name = 'InvalidTransitionError';
  }
}

export function isFinished(status: SessionStatus): boolean {
  return status === 'ended' || status === 'cancelled';
}

export function initialLifecycle(durationSec: number): SessionLifecycleState {
  return {
    status: 'created',
    startedAt: null,
    durationSec,
    extensionSec: 0,
    endedAt: null,
    endedBy: null,
    cancelReason: null,
  };
}

export function applyCommand(state: SessionLifecycleState, command: SessionCommand, ctx: CommandContext): SessionLifecycleState {
  const reject = (): never => {
    throw new InvalidTransitionError(state.status, command.type);
  };

  switch (command.type) {
    case 'start':
      if (state.status !== 'created') return reject();
      return { ...state, status: 'live', startedAt: ctx.now };
    case 'extend':
      if (state.status !== 'live') return reject();
      return { ...state, extensionSec: state.extensionSec + command.minutes * 60 };
    case 'end':
      if (state.status !== 'live') return reject();
      return { ...state, status: 'ended', endedAt: ctx.now, endedBy: ctx.actorId };
    case 'cancel':
      if (isFinished(state.status)) return reject();
      return {
        ...state,
        status: 'cancelled',
        endedAt: ctx.now,
        endedBy: ctx.actorId,
        cancelReason: command.reason ?? null,
      };
  }
}
