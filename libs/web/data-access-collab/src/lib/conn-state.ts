import { isCloseReason, POLICY_CLOSE_CODE, type CloseReason } from '@swint/shared-collab-protocol';

export type EndReason = 'session_ended' | 'invite_revoked';
export type RejectReason = Exclude<CloseReason, 'unauthenticated'>;

export type CollabPhase =
  | { kind: 'connecting' }
  | { kind: 'connected' }
  | { kind: 'reconnecting' }
  /** N consecutive closes without an open: likely HTTP 401 at upgrade. Callers probe REST. Still retrying. */
  | { kind: 'unreachable' }
  /** onAuthenticationFailed for the board. Terminal: the provider does not retry. */
  | { kind: 'rejected'; reason: RejectReason }
  /** Closed by policy (4403). Terminal: we destroy the providers so they don't reconnect. */
  | { kind: 'closed'; reason: EndReason };

export interface CollabConnState {
  phase: CollabPhase;
  failedOpens: number;
  openedThisAttempt: boolean;
  everConnected: boolean;
  readOnly: boolean;
}

export type CollabEvent =
  | { type: 'open' }
  | { type: 'authenticated'; readOnly: boolean }
  | { type: 'authFailed'; reason: string }
  | { type: 'close'; code: number; reason: string };

export const initialConnState: CollabConnState = {
  phase: { kind: 'connecting' },
  failedOpens: 0,
  openedThisAttempt: false,
  everConnected: false,
  readOnly: false,
};

export function isTerminal(phase: CollabPhase): boolean {
  return phase.kind === 'rejected' || phase.kind === 'closed';
}

export function reduceConn(state: CollabConnState, event: CollabEvent, failedOpensBeforeProbe: number): CollabConnState {
  if (isTerminal(state.phase)) return state;
  switch (event.type) {
    case 'open':
      return { ...state, openedThisAttempt: true, failedOpens: 0 };
    case 'authenticated':
      return { ...state, phase: { kind: 'connected' }, everConnected: true, readOnly: event.readOnly };
    case 'authFailed': {
      const reason: RejectReason =
        isCloseReason(event.reason) && event.reason !== 'unauthenticated' ? event.reason : 'forbidden';
      return { ...state, phase: { kind: 'rejected', reason } };
    }
    case 'close': {
      if (event.code === POLICY_CLOSE_CODE) {
        const reason: EndReason = event.reason === 'invite_revoked' ? 'invite_revoked' : 'session_ended';
        return { ...state, phase: { kind: 'closed', reason } };
      }
      const failedOpens = state.openedThisAttempt ? 0 : state.failedOpens + 1;
      const phase: CollabPhase = failedOpens >= failedOpensBeforeProbe ? { kind: 'unreachable' } : { kind: 'reconnecting' };
      return { ...state, failedOpens, openedThisAttempt: false, phase };
    }
  }
}
