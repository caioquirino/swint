import * as Y from 'yjs';
import type { BoardSeed } from '@swint/shared-api-contract';
import { getBoardElements, type SyncedElement } from '@swint/shared-collab-protocol';

function toSynced(raw: Record<string, unknown> & { id: string }): SyncedElement {
  return {
    ...raw,
    id: raw.id,
    version: typeof raw['version'] === 'number' ? raw['version'] : 1,
    versionNonce: typeof raw['versionNonce'] === 'number' ? raw['versionNonce'] : 0,
    index: typeof raw['index'] === 'string' ? raw['index'] : null,
    isDeleted: raw['isDeleted'] === true,
  };
}

export function buildInitialBoardUpdate(seed: BoardSeed): Uint8Array {
  const doc = new Y.Doc();
  const board = getBoardElements(doc);
  doc.transact(() => {
    for (const element of seed.elements) board.set(element.id, toSynced(element));
  });
  return Y.encodeStateAsUpdate(doc);
}
