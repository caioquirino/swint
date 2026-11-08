import * as Y from 'yjs';

/**
 * Two Y.Docs whose updates are queued and only delivered on flush(),
 * so tests can create true concurrent edits.
 */
export function createPeers() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  const toB: Uint8Array[] = [];
  const toA: Uint8Array[] = [];
  a.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'remote') toB.push(update);
  });
  b.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'remote') toA.push(update);
  });

  /** Deliver queued updates in both directions until nothing is left. */
  function flush(maxRounds = 10) {
    for (let round = 0; round < maxRounds; round++) {
      if (toA.length === 0 && toB.length === 0) return;
      for (const u of toB.splice(0)) Y.applyUpdate(b, u, 'remote');
      for (const u of toA.splice(0)) Y.applyUpdate(a, u, 'remote');
    }
    throw new Error('peers did not converge within maxRounds');
  }

  return { a, b, flush };
}
