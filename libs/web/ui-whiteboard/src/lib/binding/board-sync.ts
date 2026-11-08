import type * as Y from 'yjs';
import { getBoardElements, isValidBoardElement, type SyncedElement } from '@swint/shared-collab-protocol';
import { isSameRevision, shouldReplace, sortByIndex } from './element-order.js';

export interface BoardSyncOptions {
  doc: Y.Doc;
  /**
   * Called with the full ordered element list whenever remote changes were accepted.
   * Invoked synchronously inside the Yjs observer; callers may call `pushLocal` from it
   * (Yjs queues the nested transaction). The passed elements are deep copies.
   */
  onRemoteChange: (elements: SyncedElement[]) => void;
}

/** Deep copy: Excalidraw mutates elements (and nested arrays like `points`) in place. */
const copy = (element: SyncedElement): SyncedElement => structuredClone(element);

export class BoardSync {
  private readonly doc: Y.Doc;
  private readonly elements: Y.Map<SyncedElement>;
  private readonly onRemoteChange: (elements: SyncedElement[]) => void;
  /** Best-known valid revision per element id (from local pushes and accepted remote changes). */
  private readonly known = new Map<string, SyncedElement>();
  private destroyed = false;

  constructor(options: BoardSyncOptions) {
    this.doc = options.doc;
    this.onRemoteChange = options.onRemoteChange;
    this.elements = getBoardElements(this.doc);
    this.elements.forEach((value, key) => {
      if (isValidBoardElement(value)) this.known.set(key, copy(value));
    });
    this.elements.observe(this.handleChange);
  }

  /** Push the current local scene. Only valid elements that are new or newer than what we know are written, in one transaction. */
  pushLocal(sceneElements: readonly SyncedElement[]): void {
    if (this.destroyed) return;
    const changed: SyncedElement[] = [];
    for (const element of sceneElements) {
      if (!isValidBoardElement(element)) continue;
      if (shouldReplace(this.known.get(element.id), element)) {
        const snap = copy(element);
        changed.push(snap);
        this.known.set(snap.id, snap);
      }
    }
    if (changed.length === 0) return;
    this.doc.transact(() => {
      for (const element of changed) this.elements.set(element.id, copy(element));
    }, this);
  }

  /** Current ordered elements (including isDeleted tombstones), as deep copies. */
  getElements(): SyncedElement[] {
    return sortByIndex(this.known.values()).map(copy);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.elements.unobserve(this.handleChange);
  }

  private readonly handleChange = (event: Y.YMapEvent<SyncedElement>, transaction: Y.Transaction): void => {
    if (this.destroyed || transaction.origin === this) return;

    let accepted = false;
    const reassert: SyncedElement[] = [];

    for (const key of event.keysChanged) {
      const incoming = this.elements.get(key);
      if (incoming === undefined) continue; // keys are never deleted; tombstones use isDeleted
      const local = this.known.get(key);
      if (!isValidBoardElement(incoming)) {
        // Never accept a malformed value; restore ours if we have one so every peer converges.
        if (local) reassert.push(local);
        continue;
      }
      if (isSameRevision(local, incoming)) continue;
      if (shouldReplace(local, incoming)) {
        this.known.set(key, copy(incoming));
        accepted = true;
      } else if (local) {
        // Yjs kept a revision our rule says should lose: write ours back so every peer converges.
        reassert.push(local);
      }
    }

    if (reassert.length > 0) {
      this.doc.transact(() => {
        for (const element of reassert) this.elements.set(element.id, copy(element));
      }, this);
    }
    if (accepted) this.onRemoteChange(this.getElements());
  };
}
