import type { BlobStore } from '@swint/api-data-access-persistence';
import { blobKeys } from '@swint/api-data-access-persistence';
import type { DocTarget } from './access.js';
import type { CollabLogger } from './types.js';

const BACKOFF_MS = [100, 400, 1600] as const;

export interface DocStoreDeps {
  blobs: BlobStore;
  logger: CollabLogger;
  sleep?: (ms: number) => Promise<void>;
}

export interface DocStore {
  load(orgId: string, target: DocTarget): Promise<Uint8Array | null>;
  /** Retries 3 times (100/400/1600 ms), then throws. */
  store(orgId: string, target: DocTarget, state: Uint8Array): Promise<void>;
  /** Same retry policy as `store`. */
  checkpoint(orgId: string, sessionId: string, ts: number, state: Uint8Array): Promise<void>;
}

const keyFor = (orgId: string, t: DocTarget) =>
  t.kind === 'board' ? blobKeys.sessionBoardLatest(orgId, t.sessionId) : blobKeys.sessionNotesLatest(orgId, t.sessionId);

export function createDocStore(deps: DocStoreDeps): DocStore {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function putWithRetry(key: string, bytes: Uint8Array, sessionId: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await deps.blobs.putBytes(key, bytes);
        return;
      } catch (err) {
        if (attempt >= BACKOFF_MS.length) throw err;
        deps.logger.warn({ sessionId, attempt: attempt + 1, err }, 'collab store failed, retrying');
        await sleep(BACKOFF_MS[attempt]);
      }
    }
  }

  return {
    load: (orgId, target) => deps.blobs.getBytes(keyFor(orgId, target)),
    store: (orgId, target, state) => putWithRetry(keyFor(orgId, target), state, target.sessionId),
    checkpoint: (orgId, sessionId, ts, state) =>
      putWithRetry(blobKeys.sessionBoardCheckpoint(orgId, sessionId, ts), state, sessionId),
  };
}
