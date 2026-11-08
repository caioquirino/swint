import * as Y from 'yjs';

export interface CreatePeersOptions {
  /** Deterministic Yjs clientIDs, one per peer. Yjs settles same-key conflicts by clientID. */
  clientIds?: number[];
}

/**
 * N Y.Docs (default 2) whose updates are queued and only delivered on flush(),
 * so tests can create true concurrent edits. Delivery is all-to-all.
 */
export function createPeers(options: CreatePeersOptions = {}) {
  const clientIds = options.clientIds ?? [1, 2];
  const docs = clientIds.map((id) => {
    const doc = new Y.Doc();
    doc.clientID = id;
    return doc;
  });
  const inbox: Uint8Array[][] = docs.map(() => []);

  docs.forEach((doc, i) => {
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote') return;
      docs.forEach((_, j) => {
        if (j !== i) inbox[j].push(update);
      });
    });
  });

  /** Deliver queued updates between all peers until nothing is left. */
  function flush(maxRounds = 10) {
    for (let round = 0; round < maxRounds; round++) {
      if (inbox.every((q) => q.length === 0)) return;
      docs.forEach((doc, i) => {
        for (const u of inbox[i].splice(0)) Y.applyUpdate(doc, u, 'remote');
      });
    }
    throw new Error('peers did not converge within maxRounds');
  }

  return { docs, a: docs[0], b: docs[1], flush };
}
