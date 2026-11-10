import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { AWARENESS_USER_FIELD, getBoardElements, type SyncedElement } from '@swint/shared-collab-protocol';
import {
  ExcalidrawBinding,
  UNSUPPORTED_ELEMENT_MESSAGE,
  POINTER_INTERVAL_MS,
  type ExcalidrawFns,
  type SceneApi,
  type Scheduler,
} from './excalidraw-binding.js';
import { createPeers } from '../../testing/test-peers.js';

const el = (id: string, version: number, extra: Partial<SyncedElement> = {}): SyncedElement => ({
  id,
  type: 'rectangle',
  version,
  versionNonce: version * 7,
  index: 'a0',
  isDeleted: false,
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  ...extra,
});

const fns: ExcalidrawFns = {
  // remote wins by id; keeps local-only elements
  reconcileElements: (local, remote) => {
    const byId = new Map(local.map((e) => [e.id, e]));
    for (const r of remote) byId.set(r.id, r);
    return [...byId.values()];
  },
  restoreElements: (els) => els,
  refreshTextDimensions: (els) => els,
  // Test appStates carry their bounds directly; fitting scrolls to the bounds' corner.
  visibleBounds: (appState) => (appState as { bounds: [number, number, number, number] }).bounds,
  fitBounds: ([x1, y1]) => ({ scrollX: -x1, scrollY: -y1, zoom: { value: 1 } }),
  captureNever: 'NEVER',
};

function fakeScheduler() {
  let frames: (() => void)[] = [];
  let timers: { at: number; cb: () => void }[] = [];
  let t = 0;
  const s: Scheduler = {
    requestFrame: (cb) => frames.push(cb),
    cancelFrame: (h) => {
      frames[h - 1] = () => undefined;
    },
    now: () => t,
    setTimeout: (cb, ms) => timers.push({ at: t + ms, cb }),
    clearTimeout: (h) => {
      if (timers[h - 1]) timers[h - 1].cb = () => undefined;
    },
  };
  return {
    s,
    frame: () => {
      const run = frames;
      frames = [];
      run.forEach((f) => f());
    },
    advance: (ms: number) => {
      t += ms;
      const due = timers.filter((x) => x.at <= t);
      timers = timers.filter((x) => x.at > t);
      due.forEach((x) => x.cb());
    },
  };
}

function fakeApi(): SceneApi & { updateScene: ReturnType<typeof vi.fn>; appState: Record<string, unknown> } {
  let scene: readonly SyncedElement[] = [];
  const api = {
    appState: {} as Record<string, unknown>,
    updateScene: vi.fn((s: { elements?: readonly SyncedElement[] }) => {
      if (s.elements) scene = s.elements;
    }),
    getSceneElementsIncludingDeleted: () => scene,
    getAppState: () => api.appState,
  };
  return api;
}

function setup() {
  const { a, b, flush } = createPeers({ clientIds: [1, 2] });
  const sched = fakeScheduler();
  const apiA = fakeApi();
  const apiB = fakeApi();
  const awA = new Awareness(a);
  const bindA = new ExcalidrawBinding({ doc: a, api: apiA, fns, awareness: awA, scheduler: sched.s });
  const bindB = new ExcalidrawBinding({ doc: b, api: apiB, fns, awareness: null, scheduler: sched.s });
  return { a, b, flush, sched, apiA, apiB, awA, bindA, bindB };
}

describe('ExcalidrawBinding', () => {
  it('throttles local pushes to one Yjs transaction per animation frame, using the latest scene', () => {
    const { a, b, flush, sched, bindA } = setup();
    const updates = vi.fn();
    a.on('update', updates);
    bindA.handleChange([el('r1', 1)], {});
    bindA.handleChange([el('r1', 2)], {});
    bindA.handleChange([el('r1', 3)], {});
    expect(updates).not.toHaveBeenCalled();
    sched.frame();
    expect(updates).toHaveBeenCalledTimes(1);
    flush();
    expect(getBoardElements(b).get('r1')?.version).toBe(3);
  });

  it('applies remote changes with captureUpdate NEVER, so they never enter local undo history', () => {
    const { flush, sched, apiB, bindA } = setup();
    bindA.handleChange([el('r1', 1, { x: 5 })], {});
    sched.frame();
    flush();
    const sceneCalls = apiB.updateScene.mock.calls.map((c) => c[0]).filter((s) => s.elements);
    expect(sceneCalls).toHaveLength(1);
    expect(sceneCalls[0].captureUpdate).toBe('NEVER');
    expect(sceneCalls[0].elements.map((e: SyncedElement) => [e.id, e['x']])).toEqual([['r1', 5]]);
    // every updateScene the binding issues is non-capturing (elements and collaborators alike)
    expect(apiB.updateScene.mock.calls.every((c) => c[0].captureUpdate === 'NEVER')).toBe(true);
  });

  it('does not echo its own local edits back into its scene', () => {
    const { flush, sched, apiA, bindA } = setup();
    apiA.updateScene.mockClear();
    bindA.handleChange([el('r1', 1)], {});
    sched.frame();
    flush();
    expect(apiA.updateScene.mock.calls.filter((c) => c[0].elements)).toHaveLength(0);
  });

  it('loads elements already in the document on construction', () => {
    const doc = new Y.Doc();
    getBoardElements(doc).set('r1', el('r1', 4));
    const api = fakeApi();
    new ExcalidrawBinding({ doc, api, fns, awareness: null, scheduler: fakeScheduler().s });
    expect(api.updateScene).toHaveBeenCalledWith(
      expect.objectContaining({ captureUpdate: 'NEVER', elements: [expect.objectContaining({ id: 'r1', version: 4 })] }),
    );
  });

  it('read-only bindings never write', () => {
    const { a, sched, bindA } = setup();
    bindA.setReadOnly(true);
    bindA.handleChange([el('r1', 1)], {});
    sched.frame();
    expect(getBoardElements(a).size).toBe(0);
  });

  it('never syncs image elements', () => {
    const { a, sched, bindA } = setup();
    bindA.handleChange([el('img', 1, { type: 'image' }), el('r1', 1)], {});
    sched.frame();
    expect([...getBoardElements(a).keys()]).toEqual(['r1']);
  });

  it('throttles pointer awareness to ~30/s (leading + trailing)', () => {
    const { awA, sched, bindA } = setup();
    const set = vi.spyOn(awA, 'setLocalStateField');
    bindA.handlePointer({ x: 1, y: 1, tool: 'pointer' });
    bindA.handlePointer({ x: 2, y: 2, tool: 'pointer' });
    bindA.handlePointer({ x: 3, y: 3, tool: 'pointer' });
    expect(set).toHaveBeenCalledTimes(1);
    sched.advance(POINTER_INTERVAL_MS);
    expect(set).toHaveBeenCalledTimes(2);
    expect(awA.getLocalState()?.[AWARENESS_USER_FIELD]).toMatchObject({ pointer: { x: 3, y: 3, tool: 'pointer' } });
  });

  it('publishes the button and sends a button change immediately, cancelling the pending trailing send', () => {
    const { awA, sched, bindA } = setup();
    const set = vi.spyOn(awA, 'setLocalStateField');
    const pointer = () => (awA.getLocalState()?.[AWARENESS_USER_FIELD] as { pointer?: unknown }).pointer;
    bindA.handlePointer({ x: 1, y: 1, tool: 'laser' }, 'up');
    expect(pointer()).toEqual({ x: 1, y: 1, tool: 'laser', button: 'up' });
    bindA.handlePointer({ x: 2, y: 2, tool: 'laser' }, 'up'); // throttled, trailing pending
    expect(set).toHaveBeenCalledTimes(1);
    bindA.handlePointer({ x: 3, y: 3, tool: 'laser' }, 'down'); // immediate
    expect(set).toHaveBeenCalledTimes(2);
    expect(pointer()).toEqual({ x: 3, y: 3, tool: 'laser', button: 'down' });
    sched.advance(POINTER_INTERVAL_MS); // stale trailing send is cancelled
    expect(set).toHaveBeenCalledTimes(2);
    bindA.handlePointer({ x: 4, y: 4, tool: 'laser' }, 'down'); // window elapsed: leading send
    expect(set).toHaveBeenCalledTimes(3);
    bindA.handlePointer({ x: 4.5, y: 4.5, tool: 'laser' }, 'down'); // same button inside the window: throttled
    expect(set).toHaveBeenCalledTimes(3);
    sched.advance(POINTER_INTERVAL_MS);
    expect(set).toHaveBeenCalledTimes(4);
    bindA.handlePointer({ x: 5, y: 5, tool: 'laser' }, 'up');
    expect(set).toHaveBeenCalledTimes(5);
    expect(pointer()).toEqual({ x: 5, y: 5, tool: 'laser', button: 'up' });
  });

  it('maps a peer laser button to the collaborator level', () => {
    const { awA, apiA } = setup();
    const peer = new Awareness(new Y.Doc());
    peer.setLocalStateField(AWARENESS_USER_FIELD, {
      userId: 'candidate:s1',
      name: 'Bo',
      role: 'candidate',
      color: '#2f9e44',
      selectedElementIds: {},
      pointer: { x: 4, y: 5, tool: 'laser', button: 'down' },
    });
    awA.setLocalStateField(AWARENESS_USER_FIELD, {
      userId: 'me',
      name: 'Me',
      role: 'interviewer',
      color: '#1971c2',
      selectedElementIds: {},
    });
    const states = new Map(awA.getStates());
    states.set(99, peer.getLocalState() as never);
    vi.spyOn(awA, 'getStates').mockReturnValue(states);
    awA.emit('change', [{ added: [99], updated: [], removed: [] }, 'test']);
    const last = apiA.updateScene.mock.calls.filter((c) => c[0].collaborators).at(-1)?.[0].collaborators as Map<string, unknown>;
    expect(last.get('99')).toMatchObject({ button: 'down', pointer: { x: 4, y: 5, tool: 'laser' } });
    expect((last.get('99') as { pointer: object }).pointer).not.toHaveProperty('button');
  });

  it('publishes selection changes once per change, merged into the existing user field', () => {
    const { awA, bindA } = setup();
    awA.setLocalStateField(AWARENESS_USER_FIELD, {
      userId: 'u',
      name: 'Ada',
      role: 'interviewer',
      color: '#1971c2',
      selectedElementIds: {},
    });
    const set = vi.spyOn(awA, 'setLocalStateField');
    bindA.handleChange([], { selectedElementIds: { r1: true, r2: false } });
    bindA.handleChange([], { selectedElementIds: { r1: true } });
    expect(set).toHaveBeenCalledTimes(1);
    expect(awA.getLocalState()?.[AWARENESS_USER_FIELD]).toMatchObject({ name: 'Ada', selectedElementIds: { r1: true } });
  });

  it('shows remote peers as Excalidraw collaborators, excluding itself and invalid states', () => {
    const { awA, apiA } = setup();
    const peer = new Awareness(new Y.Doc());
    peer.setLocalStateField(AWARENESS_USER_FIELD, {
      userId: 'candidate:s1',
      name: 'Bo',
      role: 'candidate',
      color: '#2f9e44',
      selectedElementIds: { r1: true },
      pointer: { x: 4, y: 5, tool: 'laser' },
    });
    const broken = new Awareness(new Y.Doc());
    broken.setLocalStateField(AWARENESS_USER_FIELD, { name: 'x' });
    awA.setLocalStateField(AWARENESS_USER_FIELD, {
      userId: 'me',
      name: 'Me',
      role: 'interviewer',
      color: '#000000',
      selectedElementIds: {},
    });
    applyAwarenessUpdate(awA, encodeAwarenessUpdate(peer, [peer.clientID]), 'remote');
    applyAwarenessUpdate(awA, encodeAwarenessUpdate(broken, [broken.clientID]), 'remote');
    const last = apiA.updateScene.mock.calls
      .map((c) => c[0])
      .filter((s) => s.collaborators)
      .at(-1);
    const collaborators = [...(last.collaborators as Map<string, unknown>).values()];
    expect(collaborators).toEqual([
      {
        id: 'candidate:s1',
        username: 'Bo',
        color: { background: '#2f9e44', stroke: '#2f9e44' },
        pointer: { x: 4, y: 5, tool: 'laser' },
        selectedElementIds: { r1: true },
      },
    ]);
  });

  it('after destroy, ignores remote changes and pending frames', () => {
    const { flush, sched, apiA, bindA, bindB } = setup();
    bindA.handleChange([el('r1', 1)], {});
    bindA.destroy();
    sched.frame();
    apiA.updateScene.mockClear();
    bindB.handleChange([el('r2', 1)], {});
    sched.frame();
    flush();
    expect(apiA.updateScene).not.toHaveBeenCalled();
  });
});

describe('follow', () => {
  const user = (extra: Record<string, unknown> = {}) => ({
    userId: 'candidate:s1',
    name: 'Bo',
    role: 'candidate',
    color: '#2f9e44',
    selectedElementIds: {},
    ...extra,
  });
  /** A remote peer whose awareness updates reach A. */
  function remotePeer(awA: Awareness) {
    const peer = new Awareness(new Y.Doc());
    return {
      id: String(peer.clientID),
      set(extra: Record<string, unknown>) {
        peer.setLocalStateField(AWARENESS_USER_FIELD, user(extra));
        applyAwarenessUpdate(awA, encodeAwarenessUpdate(peer, [peer.clientID]), 'remote');
      },
    };
  }
  /** A test appState showing these scene bounds (see the fake `visibleBounds`). */
  const showing = (...bounds: [number, number, number, number]) => ({ selectedElementIds: {}, bounds });
  const mine = (awA: Awareness) => awA.getLocalState()?.[AWARENESS_USER_FIELD] as Record<string, unknown> | undefined;

  it('publishes whom it follows, and clears it on unfollow', () => {
    const { awA, bindA } = setup();
    bindA.handleFollow({ userToFollow: { socketId: '42', username: 'Bo' }, action: 'FOLLOW' });
    expect(mine(awA)?.['following']).toBe('42');
    bindA.handleFollow({ userToFollow: { socketId: '42', username: 'Bo' }, action: 'UNFOLLOW' });
    expect(mine(awA)?.['following']).toBeUndefined();
  });

  it('publishes its viewport only while followed, throttled and only when it changes', () => {
    const { awA, apiA, bindA, sched } = setup();
    const peer = remotePeer(awA);
    apiA.appState = showing(0, 0, 100, 100);
    bindA.handleChange([], apiA.appState);
    expect(mine(awA)?.['viewport']).toBeUndefined();
    // A follower appears: the current viewport goes out right away.
    peer.set({ following: String(awA.clientID) });
    expect(mine(awA)?.['viewport']).toEqual({ x1: 0, y1: 0, x2: 100, y2: 100 });
    const set = vi.spyOn(awA, 'setLocalStateField');
    sched.advance(POINTER_INTERVAL_MS);
    bindA.handleChange([], showing(10, 0, 110, 100)); // leading
    bindA.handleChange([], showing(20, 0, 120, 100)); // throttled
    bindA.handleChange([], showing(30, 0, 130, 100)); // throttled, latest wins
    expect(set).toHaveBeenCalledTimes(1);
    sched.advance(POINTER_INTERVAL_MS);
    expect(set).toHaveBeenCalledTimes(2);
    expect(mine(awA)?.['viewport']).toEqual({ x1: 30, y1: 0, x2: 130, y2: 100 });
    sched.advance(POINTER_INTERVAL_MS);
    bindA.handleChange([], showing(30, 0, 130, 100)); // unchanged: nothing sent
    expect(set).toHaveBeenCalledTimes(2);
    // Read-only boards can still be followed.
    bindA.setReadOnly(true);
    bindA.handleChange([], showing(40, 0, 140, 100));
    expect(mine(awA)?.['viewport']).toEqual({ x1: 40, y1: 0, x2: 140, y2: 100 });
    // The follower leaves: the viewport is withdrawn and no longer published.
    peer.set({ following: '777' });
    expect(mine(awA)?.['viewport']).toBeUndefined();
    sched.advance(POINTER_INTERVAL_MS);
    bindA.handleChange([], showing(50, 0, 150, 100));
    expect(mine(awA)?.['viewport']).toBeUndefined();
  });

  it('moves its own view to the followed peer viewport, once per change', () => {
    const { awA, apiA, bindA } = setup();
    const followed = remotePeer(awA);
    const other = remotePeer(awA);
    const scrolls = () => apiA.updateScene.mock.calls.map((c) => c[0]).filter((u) => u.appState);
    followed.set({ viewport: { x1: 5, y1: 6, x2: 105, y2: 106 } });
    expect(scrolls()).toHaveLength(0); // not following yet
    // Start following: the known viewport applies right away.
    apiA.appState = { userToFollow: { socketId: followed.id, username: 'Bo' } };
    bindA.handleFollow({ userToFollow: { socketId: followed.id, username: 'Bo' }, action: 'FOLLOW' });
    expect(scrolls()).toEqual([{ appState: { scrollX: -5, scrollY: -6, zoom: { value: 1 } }, captureUpdate: 'NEVER' }]);
    followed.set({ viewport: { x1: 5, y1: 6, x2: 105, y2: 106 }, selectedElementIds: { r: true } }); // same viewport
    other.set({ viewport: { x1: 900, y1: 900, x2: 1000, y2: 1000 } }); // someone else's
    expect(scrolls()).toHaveLength(1);
    followed.set({ viewport: { x1: 50, y1: 60, x2: 150, y2: 160 } });
    expect(scrolls().at(-1)).toEqual({ appState: { scrollX: -50, scrollY: -60, zoom: { value: 1 } }, captureUpdate: 'NEVER' });
    // Unfollowed (Excalidraw clears userToFollow): further moves are ignored.
    apiA.appState = { userToFollow: null };
    followed.set({ viewport: { x1: 70, y1: 80, x2: 170, y2: 180 } });
    expect(scrolls()).toHaveLength(2);
  });
});

describe('unsupported elements', () => {
  it('removes images and embeds from the local scene with a toast, and never syncs them', () => {
    const { b, flush, sched, apiA, bindA } = setup();
    const setToast = vi.fn();
    (apiA as SceneApi).setToast = setToast;
    const image = el('img', 1, { type: 'image' });
    const embed = el('emb', 1, { type: 'embeddable' });
    bindA.handleChange([el('r', 1), image, embed], {});
    sched.frame();
    flush();
    const last = apiA.updateScene.mock.calls.at(-1)?.[0] as { elements: SyncedElement[]; captureUpdate: string };
    expect(last.elements.map((e) => e.id)).toEqual(['r']);
    expect(last.captureUpdate).toBe('NEVER');
    expect(setToast).toHaveBeenCalledWith({ message: UNSUPPORTED_ELEMENT_MESSAGE });
    expect([...getBoardElements(b).keys()]).toEqual(['r']);
  });

  it('ignores deleted unsupported elements', () => {
    const { flush, sched, apiA, bindA } = setup();
    bindA.handleChange([el('r', 1), el('img', 2, { type: 'image', isDeleted: true })], {});
    sched.frame();
    flush();
    // The constructor's awareness pass calls updateScene({ collaborators }); only scene writes matter here.
    expect(apiA.updateScene.mock.calls.filter(([s]) => 'elements' in (s as object))).toHaveLength(0);
  });
});

describe('board style', () => {
  it('syncs local elements with clean lines and the Normal font, and fixes the local scene', () => {
    const { b, flush, sched, apiA, bindA } = setup();
    bindA.handleChange([el('r', 1, { roughness: 2 } as never), el('t', 1, { type: 'text', fontFamily: 5 } as never)], {});
    sched.frame();
    flush();
    const synced = getBoardElements(b);
    expect((synced.get('r') as unknown as { roughness: number }).roughness).toBe(0);
    expect((synced.get('t') as unknown as { fontFamily: number }).fontFamily).toBe(6);
    const written = apiA.updateScene.mock.calls.filter(([s]) => 'elements' in (s as object));
    expect(written).toHaveLength(1);
  });
});
