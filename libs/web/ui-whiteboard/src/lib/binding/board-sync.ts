import type * as Y from 'yjs';
import { getBoardElements, type SyncedElement } from '@swint/shared-collab-protocol';
import { isSameRevision, shouldReplace, sortByIndex } from './element-order.js';

export interface BoardSyncOptions {
  doc: Y.Doc;
  /**
   * Called with the full ordered element list whenever remote changes were accepted.
   * Invoked synchronously inside the Yjs observer; callers may call `pushLocal` from it
   * (Yjs queues the nested transaction). The passed elements are copies: do not rely on
   * object identity, and mutating them does not affect BoardSync or the Y.Doc.
   */
  onRemoteChange: (elements: SyncedElement[]) => void;
}

export class BoardSync {
  private readonly doc: Y.Doc;
  private readonly elements: Y.Map<SyncedElement>;
  private readonly onRemoteChange: (elements: SyncedElement[]) => void;
  /** Best-known revision per element id (from local pushes and accepted remote changes). */
  private readonly known = new Map<string, SyncedElement>();

  constructor(options: BoardSyncOptions) {
    this.doc = options.doc;
    this.onRemoteChange = options.onRemoteChange;
    this.elements = getBoardElements(this.doc);
    this.elements.forEach((value, key) => this.known.set(key, { ...value }));
    this.elements.observe(this.handleChange);
  }

  /** Push the current local scene. Only elements that are new or newer than what we know are written, in one transaction. */
  pushLocal(sceneElements: readonly SyncedElement[]): void {
    const changed: SyncedElement[] = [];
    for (const element of sceneElements) {
      if (shouldReplace(this.known.get(element.id), element)) {
        // Snapshot: callers (Excalidraw) mutate elements in place.
        const snap = { ...element };
        changed.push(snap);
        this.known.set(snap.id, snap);
      }
    }
    if (changed.length === 0) return;
    this.doc.transact(() => {
      for (const element of changed) this.elements.set(element.id, { ...element });
    }, this);
  }

  /** Current ordered elements (including isDeleted tombstones). */
  getElements(): SyncedElement[] {
    return sortByIndex(this.known.values()).map((e) => ({ ...e }));
  }

  destroy(): void {
    this.elements.unobserve(this.handleChange);
  }

  private readonly handleChange = (event: Y.YMapEvent<SyncedElement>, transaction: Y.Transaction): void => {
    if (transaction.origin === this) return;

    let accepted = false;
    const reassert: SyncedElement[] = [];

    for (const key of event.keysChanged) {
      const incoming = this.elements.get(key);
      if (!incoming) continue; // keys are never deleted; tombstones use isDeleted
      const local = this.known.get(key);
      if (isSameRevision(local, incoming)) continue;
      if (shouldReplace(local, incoming)) {
        this.known.set(key, { ...incoming });
        accepted = true;
      } else if (local) {
        // Yjs kept a revision our rule says should lose: write ours back so every peer converges.
        reassert.push(local);
      }
    }

    if (reassert.length > 0) {
      this.doc.transact(() => {
        for (const element of reassert) this.elements.set(element.id, { ...element });
      }, this);
    }
    if (accepted) this.onRemoteChange(this.getElements());
  };
}
