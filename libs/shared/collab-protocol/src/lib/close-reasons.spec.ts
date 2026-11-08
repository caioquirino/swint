import { describe, expect, it } from 'vitest';
import { CLOSE_REASONS, isCloseReason, POLICY_CLOSE_CODE } from '../index.js';

describe('close reasons', () => {
  it('policy close code is 4403 (application range)', () => {
    expect(POLICY_CLOSE_CODE).toBe(4403);
  });

  it('recognises every close reason and nothing else', () => {
    for (const r of CLOSE_REASONS) expect(isCloseReason(r)).toBe(true);
    expect(isCloseReason('nope')).toBe(false);
    expect(isCloseReason(4403)).toBe(false);
  });
});
