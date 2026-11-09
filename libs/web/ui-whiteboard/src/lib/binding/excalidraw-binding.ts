import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import {
  AWARENESS_USER_FIELD,
  isSupportedElementType,
  readAwarenessUser,
  type AwarenessUser,
  type SyncedElement,
} from '@swint/shared-collab-protocol';
import { BoardSync } from './board-sync.js';

/** ~30 pointer updates per second (spec §7.3). */
export const POINTER_INTERVAL_MS = 33;

export interface SceneCollaborator {
  id: string;
  username: string;
  color: { background: string; stroke: string };
  pointer?: { x: number; y: number; tool: 'pointer' | 'laser' };
  selectedElementIds?: Record<string, true>;
}

/** The subset of ExcalidrawImperativeAPI the binding uses (structural, so tests can fake it). */
export interface SceneApi {
  updateScene(scene: { elements?: readonly SyncedElement[]; collaborators?: Map<string, SceneCollaborator>; captureUpdate?: string }): void;
  getSceneElementsIncludingDeleted(): readonly SyncedElement[];
  getAppState(): unknown;
  /** Excalidraw's toast; optional so fakes can omit it. */
  setToast?(toast: { message: string } | null): void;
}

export const UNSUPPORTED_ELEMENT_MESSAGE = 'Images and embeds are not supported on the shared board.';

/** Excalidraw functions, injected so the binding is testable without the Excalidraw bundle. */
export interface ExcalidrawFns {
  reconcileElements(local: readonly SyncedElement[], remote: readonly SyncedElement[], appState: unknown): readonly SyncedElement[];
  restoreElements(elements: readonly SyncedElement[]): readonly SyncedElement[];
  /** CaptureUpdateAction.NEVER: remote updates must never enter the local undo stack. */
  captureNever: string;
}

export interface Scheduler {
  requestFrame(cb: () => void): number;
  cancelFrame(handle: number): void;
  now(): number;
  setTimeout(cb: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

const browserScheduler: Scheduler = {
  requestFrame: (cb) => requestAnimationFrame(cb),
  cancelFrame: (h) => cancelAnimationFrame(h),
  now: () => performance.now(),
  setTimeout: (cb, ms) => window.setTimeout(cb, ms),
  clearTimeout: (h) => window.clearTimeout(h),
};

type Pointer = NonNullable<AwarenessUser['pointer']>;
type AwarenessChanges = { added: number[]; updated: number[]; removed: number[] };

export interface ExcalidrawBindingOptions {
  doc: Y.Doc;
  api: SceneApi;
  fns: ExcalidrawFns;
  awareness: Awareness | null;
  scheduler?: Scheduler;
}

/** Connects one Excalidraw instance to the board document and presence (spec §7.2, §7.3). */
export class ExcalidrawBinding {
  private readonly s: Scheduler;
  private readonly sync: BoardSync;
  private pendingScene: readonly SyncedElement[] | null = null;
  private frame: number | null = null;
  private lastSelectionKey = '';
  private pendingPointer: Pointer | null = null;
  private lastPointerAt = Number.NEGATIVE_INFINITY;
  private pointerTimer: number | null = null;
  private readOnly = false;
  private destroyed = false;

  constructor(private readonly o: ExcalidrawBindingOptions) {
    this.s = o.scheduler ?? browserScheduler;
    this.sync = new BoardSync({ doc: o.doc, onRemoteChange: (elements) => this.applyRemote(elements) });
    const initial = this.sync.getElements();
    if (initial.length > 0) this.applyRemote(initial);
    o.awareness?.on('change', this.handleAwareness);
    this.handleAwareness();
  }

  setReadOnly(readOnly: boolean): void {
    this.readOnly = readOnly;
    if (readOnly) this.pendingScene = null;
  }

  /** Excalidraw `onChange`. At most one BoardSync push per animation frame, with the latest scene. */
  handleChange(elements: readonly SyncedElement[], appState: { selectedElementIds?: Record<string, boolean> }): void {
    if (this.destroyed) return;
    this.publishSelection(appState.selectedElementIds ?? {});
    if (this.readOnly) return;
    this.pendingScene = elements;
    if (this.frame === null) this.frame = this.s.requestFrame(this.flush);
  }

  /** Excalidraw `onPointerUpdate`. Leading + trailing throttle. */
  handlePointer(pointer: Pointer): void {
    if (this.destroyed || !this.o.awareness) return;
    this.pendingPointer = { x: pointer.x, y: pointer.y, tool: pointer.tool };
    const elapsed = this.s.now() - this.lastPointerAt;
    if (elapsed >= POINTER_INTERVAL_MS) {
      this.sendPointer();
    } else if (this.pointerTimer === null) {
      this.pointerTimer = this.s.setTimeout(() => {
        this.pointerTimer = null;
        this.sendPointer();
      }, POINTER_INTERVAL_MS - elapsed);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.frame !== null) this.s.cancelFrame(this.frame);
    if (this.pointerTimer !== null) this.s.clearTimeout(this.pointerTimer);
    this.o.awareness?.off('change', this.handleAwareness);
    this.sync.destroy();
  }

  private readonly flush = (): void => {
    this.frame = null;
    let scene = this.pendingScene;
    this.pendingScene = null;
    if (!scene || this.destroyed || this.readOnly) return;
    const unsupported = new Set(scene.filter((e) => !e.isDeleted && !isSupportedElementType(e.type)).map((e) => e.id));
    if (unsupported.size > 0) {
      // Images and embeds would show locally but never sync (BoardSync rejects them): take them off the scene.
      scene = scene.filter((e) => !unsupported.has(e.id));
      this.o.api.updateScene({ elements: scene, captureUpdate: this.o.fns.captureNever });
      this.o.api.setToast?.({ message: UNSUPPORTED_ELEMENT_MESSAGE });
    }
    this.sync.pushLocal(scene);
  };

  private applyRemote(elements: SyncedElement[]): void {
    if (this.destroyed) return;
    const { api, fns } = this.o;
    const remote = fns.restoreElements(elements);
    const merged = fns.reconcileElements(api.getSceneElementsIncludingDeleted(), remote, api.getAppState());
    api.updateScene({ elements: merged, captureUpdate: fns.captureNever });
  }

  private sendPointer(): void {
    if (!this.pendingPointer) return;
    this.lastPointerAt = this.s.now();
    this.patchUser({ pointer: this.pendingPointer });
    this.pendingPointer = null;
  }

  private publishSelection(selected: Record<string, boolean>): void {
    const ids = Object.keys(selected)
      .filter((id) => selected[id])
      .sort();
    const key = ids.join('\u0000');
    if (key === this.lastSelectionKey) return;
    this.lastSelectionKey = key;
    this.patchUser({ selectedElementIds: Object.fromEntries(ids.map((id) => [id, true as const])) });
  }

  private patchUser(patch: Partial<AwarenessUser>): void {
    const awareness = this.o.awareness;
    if (!awareness) return;
    const current = awareness.getLocalState()?.[AWARENESS_USER_FIELD];
    const base = typeof current === 'object' && current !== null ? current : {};
    awareness.setLocalStateField(AWARENESS_USER_FIELD, { ...base, ...patch });
  }

  private readonly handleAwareness = (changes?: AwarenessChanges): void => {
    const awareness = this.o.awareness;
    if (!awareness || this.destroyed) return;
    if (changes && [...changes.added, ...changes.updated, ...changes.removed].every((id) => id === awareness.clientID)) return;
    const collaborators = new Map<string, SceneCollaborator>();
    awareness.getStates().forEach((state, clientId) => {
      if (clientId === awareness.clientID) return;
      const user = readAwarenessUser(state);
      if (!user) return;
      collaborators.set(String(clientId), {
        id: user.userId,
        username: user.name,
        color: { background: user.color, stroke: user.color },
        ...(user.pointer ? { pointer: user.pointer } : {}),
        selectedElementIds: user.selectedElementIds,
      });
    });
    this.o.api.updateScene({ collaborators, captureUpdate: this.o.fns.captureNever });
  };
}
