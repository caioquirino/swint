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

export interface StoreOptions {
  /** Number of retries after the first attempt; default 3. Use 0 for a single attempt. */
  retries?: number;
}

export interface DocStore {
  load(orgId: string, target: DocTarget): Promise<Uint8Array | null>;
  /** Retries 3 times (100/400/1600 ms), then throws. */
  store(orgId: string, target: DocTarget, state: Uint8Array, opts?: StoreOptions): Promise<void>;
  /** Same retry policy as `store`. */
  checkpoint(orgId: string, sessionId: string, ts: number, state: Uint8Array): Promise<void>;
}

const keyFor = (orgId: string, t: DocTarget) =>
  t.kind === 'board' ? blobKeys.sessionBoardLatest(orgId, t.sessionId) : blobKeys.sessionNotesLatest(orgId, t.sessionId);

export function createDocStore(deps: DocStoreDeps): DocStore {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function putWithRetry(key: string, bytes: Uint8Array, sessionId: string, retries: number = BACKOFF_MS.length): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await deps.blobs.putBytes(key, bytes);
        return;
      } catch (err) {
        if (attempt >= retries) throw err;
        deps.logger.warn({ sessionId, attempt: attempt + 1, err }, 'collab store failed, retrying');
        await sleep(BACKOFF_MS[attempt]);
      }
    }
  }

  return {
    load: (orgId, target) => deps.blobs.getBytes(keyFor(orgId, target)),
    store: (orgId, target, state, opts) => putWithRetry(keyFor(orgId, target), state, target.sessionId, opts?.retries),
    checkpoint: (orgId, sessionId, ts, state) => putWithRetry(blobKeys.sessionBoardCheckpoint(orgId, sessionId, ts), state, sessionId),
  };
}
