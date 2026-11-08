import type { SyncedElement } from '@swint/shared-collab-protocol';

/** Same rule as Excalidraw's reconcile: the higher version wins; on a tie, the lower versionNonce wins. */
export function shouldReplace(existing: SyncedElement | undefined, incoming: SyncedElement): boolean {
  if (!existing) return true;
  if (incoming.version !== existing.version) return incoming.version > existing.version;
  return incoming.versionNonce < existing.versionNonce;
}

export function isSameRevision(a: SyncedElement | undefined, b: SyncedElement): boolean {
  return !!a && a.version === b.version && a.versionNonce === b.versionNonce;
}

export function sortByIndex(elements: Iterable<SyncedElement>): SyncedElement[] {
  return [...elements].sort((a, b) => {
    if (a.index !== b.index) {
      if (a.index === null) return 1;
      if (b.index === null) return -1;
      return a.index < b.index ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
