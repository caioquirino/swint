const key = (sessionId: string) => `swint.candidate.${sessionId}`;

/** Remembers that this browser joined `sessionId` as the candidate (copy only; no security meaning). */
export function rememberCandidate(sessionId: string): void {
  try {
    localStorage.setItem(key(sessionId), '1');
  } catch {
    // Storage unavailable (private mode, blocked): the generic sign-in copy is shown instead.
  }
}

export function wasCandidate(sessionId: string): boolean {
  try {
    return localStorage.getItem(key(sessionId)) === '1';
  } catch {
    return false;
  }
}
