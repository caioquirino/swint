import { describe, expect, it, vi } from 'vitest';
import type { SyncedElement } from '@swint/shared-collab-protocol';
import { getBoardElements } from '@swint/shared-collab-protocol';
import { BoardSync } from './board-sync.js';
import { createPeers } from './test-peers.js';

const el = (
  id: string,
  version: number,
  versionNonce: number,
  extra: Partial<SyncedElement> = {},
): SyncedElement => ({ id, version, versionNonce, index: 'a0', isDeleted: false, x: 0, ...extra });

function setup() {
  const { a, b, flush } = createPeers();
  const onA = vi.fn();
  const onB = vi.fn();
  const syncA = new BoardSync({ doc: a, onRemoteChange: onA });
  const syncB = new BoardSync({ doc: b, onRemoteChange: onB });
  return { a, b, flush, syncA, syncB, onA, onB };
}

const snapshot = (s: BoardSync) => s.getElements().map((e) => [e.id, e.version, e.versionNonce, e['x'], e.isDeleted]);

describe('BoardSync', () => {
  it('propagates a new element to the other peer', () => {
    const { flush, syncA, syncB, onB } = setup();
    syncA.pushLocal([el('r1', 1, 10, { x: 5 })]);
    flush();
    expect(snapshot(syncB)).toEqual([['r1', 1, 10, 5, false]]);
    expect(onB).toHaveBeenCalledTimes(1);
    expect(onB.mock.calls[0][0]).toEqual(syncB.getElements());
  });

  it('does not notify for its own local writes', () => {
    const { flush, syncA, onA } = setup();
    syncA.pushLocal([el('r1', 1, 10)]);
    flush();
    expect(onA).not.toHaveBeenCalled();
  });

  it('only writes elements that changed', () => {
    const { a, syncA } = setup();
    const updates = vi.fn();
    a.on('update', updates);
    syncA.pushLocal([el('r1', 1, 10), el('r2', 1, 11)]);
    syncA.pushLocal([el('r1', 1, 10), el('r2', 1, 11)]); // unchanged scene
    expect(updates).toHaveBeenCalledTimes(1);
    syncA.pushLocal([el('r1', 2, 12), el('r2', 1, 11)]);
    expect(updates).toHaveBeenCalledTimes(2);
    expect(getBoardElements(a).get('r1')?.version).toBe(2);
  });

  it('ignores stale local pushes (older version than known)', () => {
    const { flush, syncA, syncB } = setup();
    syncA.pushLocal([el('r1', 5, 10, { x: 50 })]);
    flush();
    syncB.pushLocal([el('r1', 3, 1, { x: 30 })]);
    flush();
    expect(snapshot(syncA)).toEqual([['r1', 5, 10, 50, false]]);
    expect(snapshot(syncB)).toEqual([['r1', 5, 10, 50, false]]);
  });

  it('concurrent edits to different elements both survive', () => {
    const { flush, syncA, syncB } = setup();
    syncA.pushLocal([el('r1', 1, 10)]);
    syncB.pushLocal([el('r2', 1, 20)]);
    flush();
    expect(snapshot(syncA)).toEqual(snapshot(syncB));
    expect(syncA.getElements().map((e) => e.id).sort()).toEqual(['r1', 'r2']);
  });

  it('concurrent edits to the same element converge to the higher version on both peers', () => {
    const { flush, syncA, syncB } = setup();
    syncA.pushLocal([el('r1', 1, 10)]);
    flush();
    // concurrent: A moves it once (v2), B moves it twice (v3)
    syncA.pushLocal([el('r1', 2, 30, { x: 100 })]);
    syncB.pushLocal([el('r1', 3, 40, { x: 200 })]);
    flush();
    expect(snapshot(syncA)).toEqual([['r1', 3, 40, 200, false]]);
    expect(snapshot(syncB)).toEqual([['r1', 3, 40, 200, false]]);
  });

  it('equal-version conflicts converge to the lower versionNonce, whichever Yjs picked', () => {
    // Run both orientations so the result does not depend on Yjs client-id ordering.
    for (const [nonceA, nonceB] of [
      [5, 9],
      [9, 5],
    ]) {
      const { flush, syncA, syncB } = setup();
      syncA.pushLocal([el('r1', 1, 1)]);
      flush();
      syncA.pushLocal([el('r1', 2, nonceA, { x: nonceA })]);
      syncB.pushLocal([el('r1', 2, nonceB, { x: nonceB })]);
      flush();
      expect(snapshot(syncA)).toEqual([['r1', 2, 5, 5, false]]);
      expect(snapshot(syncB)).toEqual([['r1', 2, 5, 5, false]]);
    }
  });

  it('delete vs concurrent older edit: the delete (higher version) wins', () => {
    const { flush, syncA, syncB } = setup();
    syncA.pushLocal([el('r1', 1, 10)]);
    flush();
    syncA.pushLocal([el('r1', 3, 11, { isDeleted: true })]);
    syncB.pushLocal([el('r1', 2, 12, { x: 99 })]);
    flush();
    expect(syncA.getElements()[0].isDeleted).toBe(true);
    expect(syncB.getElements()[0].isDeleted).toBe(true);
  });

  it('returns elements ordered by fractional index', () => {
    const { flush, syncA, syncB } = setup();
    syncA.pushLocal([el('top', 1, 1, { index: 'a2' }), el('bottom', 1, 2, { index: 'a0' })]);
    syncB.pushLocal([el('middle', 1, 3, { index: 'a1' })]);
    flush();
    expect(syncA.getElements().map((e) => e.id)).toEqual(['bottom', 'middle', 'top']);
    expect(syncB.getElements().map((e) => e.id)).toEqual(['bottom', 'middle', 'top']);
  });

  it('loads elements already present in the doc (late joiner)', () => {
    const { b, flush, syncA } = setup();
    syncA.pushLocal([el('r1', 1, 10)]);
    flush();
    const late = new BoardSync({ doc: b, onRemoteChange: vi.fn() });
    expect(late.getElements().map((e) => e.id)).toEqual(['r1']);
  });

  it('stops observing after destroy', () => {
    const { flush, syncA, syncB, onB } = setup();
    syncB.destroy();
    syncA.pushLocal([el('r1', 1, 10)]);
    flush();
    expect(onB).not.toHaveBeenCalled();
  });
});
