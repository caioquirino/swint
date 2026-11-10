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
import { enforceBoardStyle } from '../board-style.js';

/** ~30 pointer updates per second (spec §7.3). */
export const POINTER_INTERVAL_MS = 33;

export interface SceneCollaborator {
  id: string;
  username: string;
  color: { background: string; stroke: string };
  pointer?: { x: number; y: number; tool: 'pointer' | 'laser' };
  /** Laser trails draw only while a collaborator's button is 'down'. */
  button?: 'up' | 'down';
  selectedElementIds?: Record<string, true>;
}

/** The subset of ExcalidrawImperativeAPI the binding uses (structural, so tests can fake it). */
export interface SceneApi {
  updateScene(scene: {
    elements?: readonly SyncedElement[];
    collaborators?: Map<string, SceneCollaborator>;
    appState?: ViewTransform;
    captureUpdate?: string;
  }): void;
  getSceneElementsIncludingDeleted(): readonly SyncedElement[];
  getAppState(): unknown;
  /** Replaces the Excalidraw library; optional so fakes can omit it. */
  updateLibrary?(opts: { libraryItems: unknown; merge: boolean }): unknown;
  /** Excalidraw's toast; optional so fakes can omit it. */
  setToast?(toast: { message: string } | null): void;
}

export const UNSUPPORTED_ELEMENT_MESSAGE = 'Images and embeds are not supported on the shared board.';

/** Scene bounds [x1, y1, x2, y2]. */
export type SceneBounds = readonly [number, number, number, number];

/** The scroll and zoom that place a viewport. */
export interface ViewTransform {
  scrollX: number;
  scrollY: number;
  zoom: { value: number };
}

/** Excalidraw's `onUserFollow` payload (the socket id is the awareness client id, our collaborator key). */
export interface FollowEvent {
  userToFollow: { socketId: string; username: string };
  action: 'FOLLOW' | 'UNFOLLOW';
}

/** Excalidraw functions, injected so the binding is testable without the Excalidraw bundle. */
export interface ExcalidrawFns {
  reconcileElements(local: readonly SyncedElement[], remote: readonly SyncedElement[], appState: unknown): readonly SyncedElement[];
  restoreElements(elements: readonly SyncedElement[]): readonly SyncedElement[];
  /** Re-measures text elements (font changes alter metrics). */
  refreshTextDimensions(elements: readonly SyncedElement[]): readonly SyncedElement[];
  /** The scene area an appState shows. */
  visibleBounds(appState: unknown): SceneBounds;
  /** Scroll and zoom that fit `bounds` into this appState's canvas. */
  fitBounds(bounds: SceneBounds, appState: unknown): ViewTransform;
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
type Viewport = NonNullable<AwarenessUser['viewport']>;
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
  private lastSentButton: 'up' | 'down' | undefined;
  /** Someone follows this client: publish the viewport. */
  private followed = false;
  private pendingViewport: Viewport | null = null;
  private lastViewportKey = '';
  private lastViewportAt = Number.NEGATIVE_INFINITY;
  private viewportTimer: number | null = null;
  /** The followed peer's viewport last applied here. */
  private appliedViewportKey = '';
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

  /** Excalidraw `onChange`. At most one BoardSync push per animation frame, with the latest scene. The appState also gives the viewport. */
  handleChange(elements: readonly SyncedElement[], appState: { selectedElementIds?: Record<string, boolean> }): void {
    if (this.destroyed) return;
    this.publishSelection(appState.selectedElementIds ?? {});
    this.publishViewport(appState);
    if (this.readOnly) return;
    this.pendingScene = elements;
    if (this.frame === null) this.frame = this.s.requestFrame(this.flush);
  }

  /** Excalidraw `onPointerUpdate`. Leading + trailing throttle. */
  handlePointer(pointer: Pointer, button?: 'up' | 'down'): void {
    if (this.destroyed || !this.o.awareness) return;
    this.pendingPointer = { x: pointer.x, y: pointer.y, tool: pointer.tool, ...(button ? { button } : {}) };
    if (button !== this.lastSentButton) {
      // A button change must not wait (a laser trail starts/ends on it) and makes any pending trailing send stale.
      if (this.pointerTimer !== null) this.s.clearTimeout(this.pointerTimer);
      this.pointerTimer = null;
      this.sendPointer();
      return;
    }
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

  /** Excalidraw `onUserFollow`: announce whom this client follows, so that peer starts publishing its viewport. */
  handleFollow({ userToFollow, action }: FollowEvent): void {
    if (this.destroyed) return;
    if (action === 'UNFOLLOW') {
      this.patchUser({ following: undefined });
      return;
    }
    this.patchUser({ following: userToFollow.socketId });
    this.appliedViewportKey = '';
    this.followViewport();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.frame !== null) this.s.cancelFrame(this.frame);
    if (this.pointerTimer !== null) this.s.clearTimeout(this.pointerTimer);
    if (this.viewportTimer !== null) this.s.clearTimeout(this.viewportTimer);
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
    scene = enforceBoardStyle(scene, this.o.api, this.o.fns);
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
    this.lastSentButton = this.pendingPointer.button;
    this.patchUser({ pointer: this.pendingPointer });
    this.pendingPointer = null;
  }

  /** Leading + trailing throttle, like the pointer; only while followed and only on change. */
  private publishViewport(appState: unknown, immediate = false): void {
    if (!this.followed || !this.o.awareness) return;
    const [x1, y1, x2, y2] = this.o.fns.visibleBounds(appState);
    const key = `${x1},${y1},${x2},${y2}`;
    if (key === this.lastViewportKey) return;
    this.lastViewportKey = key;
    this.pendingViewport = { x1, y1, x2, y2 };
    const elapsed = this.s.now() - this.lastViewportAt;
    if (immediate || elapsed >= POINTER_INTERVAL_MS) {
      if (this.viewportTimer !== null) this.s.clearTimeout(this.viewportTimer);
      this.viewportTimer = null;
      this.sendViewport();
    } else if (this.viewportTimer === null) {
      this.viewportTimer = this.s.setTimeout(() => {
        this.viewportTimer = null;
        this.sendViewport();
      }, POINTER_INTERVAL_MS - elapsed);
    }
  }

  private sendViewport(): void {
    if (!this.pendingViewport || !this.followed) return;
    this.lastViewportAt = this.s.now();
    this.patchUser({ viewport: this.pendingViewport });
    this.pendingViewport = null;
  }

  private setFollowed(followed: boolean): void {
    if (followed === this.followed) return;
    this.followed = followed;
    this.lastViewportKey = '';
    if (followed) {
      // A new follower needs the current view now, not on the next scroll.
      this.publishViewport(this.o.api.getAppState(), true);
      return;
    }
    if (this.viewportTimer !== null) this.s.clearTimeout(this.viewportTimer);
    this.viewportTimer = null;
    this.pendingViewport = null;
    this.patchUser({ viewport: undefined });
  }

  /** Moves this view onto the followed peer's viewport when it changed. */
  private followViewport(): void {
    const awareness = this.o.awareness;
    if (!awareness) return;
    const appState = this.o.api.getAppState();
    const target = (appState as { userToFollow?: { socketId?: string } | null } | null)?.userToFollow?.socketId;
    if (!target) return;
    const state = awareness.getStates().get(Number(target));
    const viewport = state ? readAwarenessUser(state)?.viewport : undefined;
    if (!viewport) return;
    const key = `${viewport.x1},${viewport.y1},${viewport.x2},${viewport.y2}`;
    if (key === this.appliedViewportKey) return;
    this.appliedViewportKey = key;
    const appStatePatch = this.o.fns.fitBounds([viewport.x1, viewport.y1, viewport.x2, viewport.y2], appState);
    this.o.api.updateScene({ appState: appStatePatch, captureUpdate: this.o.fns.captureNever });
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
    const me = String(awareness.clientID);
    let followed = false;
    awareness.getStates().forEach((state, clientId) => {
      if (clientId === awareness.clientID) return;
      const user = readAwarenessUser(state);
      if (!user) return;
      if (user.following === me) followed = true;
      collaborators.set(String(clientId), {
        id: user.userId,
        username: user.name,
        color: { background: user.color, stroke: user.color },
        ...(user.pointer ? { pointer: { x: user.pointer.x, y: user.pointer.y, tool: user.pointer.tool } } : {}),
        ...(user.pointer?.button ? { button: user.pointer.button } : {}),
        selectedElementIds: user.selectedElementIds,
      });
    });
    this.o.api.updateScene({ collaborators, captureUpdate: this.o.fns.captureNever });
    this.setFollowed(followed);
    this.followViewport();
  };
}
