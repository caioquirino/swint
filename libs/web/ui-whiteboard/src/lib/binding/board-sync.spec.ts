import { describe, expect, it, vi } from 'vitest';
import type { SyncedElement } from '@swint/shared-collab-protocol';
import { getBoardElements } from '@swint/shared-collab-protocol';
import { BoardSync } from './board-sync.js';
import { createPeers } from '../../testing/test-peers.js';

const el = (
  id: string,
  version: number,
  versionNonce: number,
  extra: Partial<SyncedElement> = {},
): SyncedElement => ({
  id, type: 'rectangle', version, versionNonce, index: 'a0', isDeleted: false, x: 0, y: 0, width: 10, height: 10, ...extra,
});

function setup(clientIds: number[] = [1, 2]) {
  const { a, b, flush } = createPeers({ clientIds });
  const onA = vi.fn();
  const onB = vi.fn();
  const syncA = new BoardSync({ doc: a, onRemoteChange: onA });
  const syncB = new BoardSync({ doc: b, onRemoteChange: onB });
  return { a, b, flush, syncA, syncB, onA, onB };
}

/** Both clientID orders, so Yjs picks our rule's loser in one of them and the write-back must fire. */
const ORDERS = [[1, 2], [2, 1]];

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

  it.each(ORDERS.map((o) => [o]))('concurrent edits to the same element converge to the higher version on both peers (clientIDs %j)', (clientIds) => {
    const { flush, syncA, syncB } = setup(clientIds);
    syncA.pushLocal([el('r1', 1, 10)]);
    flush();
    // concurrent: A moves it once (v2), B moves it twice (v3)
    syncA.pushLocal([el('r1', 2, 30, { x: 100 })]);
    syncB.pushLocal([el('r1', 3, 40, { x: 200 })]);
    flush();
    expect(snapshot(syncA)).toEqual([['r1', 3, 40, 200, false]]);
    expect(snapshot(syncB)).toEqual([['r1', 3, 40, 200, false]]);
  });

  it.each(ORDERS.map((o) => [o]))('equal-version conflicts converge to the lower versionNonce, whichever Yjs picked (clientIDs %j)', (clientIds) => {
    // Run both orientations so the result does not depend on Yjs client-id ordering.
    for (const [nonceA, nonceB] of [
      [5, 9],
      [9, 5],
    ]) {
      const { flush, syncA, syncB } = setup(clientIds);
      syncA.pushLocal([el('r1', 1, 1)]);
      flush();
      syncA.pushLocal([el('r1', 2, nonceA, { x: nonceA })]);
      syncB.pushLocal([el('r1', 2, nonceB, { x: nonceB })]);
      flush();
      expect(snapshot(syncA)).toEqual([['r1', 2, 5, 5, false]]);
      expect(snapshot(syncB)).toEqual([['r1', 2, 5, 5, false]]);
    }
  });

  it.each(ORDERS.map((o) => [o]))('delete vs concurrent older edit: the delete (higher version) wins (clientIDs %j)', (clientIds) => {
    const { flush, syncA, syncB } = setup(clientIds);
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

  it.each([
    [[1, 2, 3]],
    [[3, 2, 1]],
    [[2, 3, 1]],
  ])('three peers writing the same element converge to the highest version (clientIDs %j)', (clientIds) => {
    const { docs, flush } = createPeers({ clientIds });
    const syncs = docs.map((doc) => new BoardSync({ doc, onRemoteChange: vi.fn() }));
    syncs[0].pushLocal([el('r1', 1, 1)]);
    flush();
    syncs[0].pushLocal([el('r1', 2, 9, { x: 9 })]);
    syncs[1].pushLocal([el('r1', 2, 5, { x: 5 })]);
    syncs[2].pushLocal([el('r1', 3, 7, { x: 7 })]);
    flush();
    for (const s of syncs) expect(snapshot(s)).toEqual([['r1', 3, 7, 7, false]]);
    expect(syncs[1].getElements()).toEqual(syncs[0].getElements());
    expect(syncs[2].getElements()).toEqual(syncs[0].getElements());
  });

  it('writes back when Yjs keeps the rule loser (extra update in exactly one clientID order)', () => {
    const localUpdates = ORDERS.map((clientIds) => {
      const { a, b, flush, syncA, syncB } = setup(clientIds);
      syncA.pushLocal([el('r1', 1, 1)]);
      flush();
      const counter = { count: 0 };
      const onUpdate = (_u: Uint8Array, origin: unknown) => {
        if (origin !== 'remote') counter.count++;
      };
      a.on('update', onUpdate);
      b.on('update', onUpdate);
      syncA.pushLocal([el('r1', 2, 5, { x: 5 })]);
      syncB.pushLocal([el('r1', 2, 9, { x: 9 })]);
      flush();
      expect(snapshot(syncA)).toEqual(snapshot(syncB));
      return counter.count;
    });
    // 2 pushes; plus one write-back in the order where Yjs picked the loser.
    expect(localUpdates.slice().sort()).toEqual([2, 3]);
  });

  it('detects in-place mutation of a previously pushed element', () => {
    const { flush, syncA, syncB } = setup();
    const e = el('e', 1, 10);
    syncA.pushLocal([e]);
    flush();
    e.version = 2;
    e.versionNonce = 99;
    e['x'] = 42;
    syncA.pushLocal([e]);
    flush();
    expect(syncB.getElements().map((x) => [x.version, x.versionNonce, x['x']])).toEqual([[2, 99, 42]]);
  });

  it('does not expose internal state: mutating delivered elements changes neither BoardSync nor the receiver Y.Map', () => {
    const { b, flush, syncA, syncB, onB } = setup();
    syncA.pushLocal([el('r1', 1, 10, { x: 5 })]);
    flush();
    const delivered = onB.mock.calls[0][0] as SyncedElement[];
    delivered[0]['x'] = 999;
    syncB.getElements()[0]['x'] = 777;
    expect(getBoardElements(b).get('r1')?.['x']).toBe(5);
    expect(syncB.getElements()[0]['x']).toBe(5);
  });

  it('deep-copies pushed elements: in-place nested mutation (points, boundElements) does not leak', () => {
    const { a, b, flush, syncA, syncB } = setup();
    const arrow = el('r1', 1, 10, {
      type: 'arrow',
      points: [[0, 0], [10, 10]],
      boundElements: [{ id: 't1', type: 'text' }],
    });
    syncA.pushLocal([arrow]);
    // Excalidraw mutates elements in place
    (arrow['points'] as number[][])[1][0] = 99;
    (arrow['boundElements'] as unknown[]).push({ id: 't2', type: 'text' });
    flush();
    expect(getBoardElements(a).get('r1')?.['points']).toEqual([[0, 0], [10, 10]]);
    expect(syncA.getElements()[0]['boundElements']).toEqual([{ id: 't1', type: 'text' }]);
    expect(getBoardElements(b).get('r1')?.['points']).toEqual([[0, 0], [10, 10]]);
    expect(syncB.getElements()[0]['points']).toEqual([[0, 0], [10, 10]]);
  });

  it('ignores invalid local elements', () => {
    const { a, syncA } = setup();
    syncA.pushLocal([el('img', 1, 1, { type: 'image' }), el('r1', 1, 1)]);
    expect([...getBoardElements(a).keys()]).toEqual(['r1']);
  });

  it('ignores an invalid remote value for a new key', () => {
    const { b, flush, syncA, onA } = setup();
    getBoardElements(b).set('bad', { id: 'bad' } as unknown as SyncedElement);
    flush();
    expect(onA).not.toHaveBeenCalled();
    expect(syncA.getElements()).toEqual([]);
  });

  it('heals an invalid remote overwrite of a known element', () => {
    const { a, b, flush, syncA, syncB, onA } = setup();
    syncA.pushLocal([el('r1', 1, 10, { x: 5 })]);
    flush();
    getBoardElements(b).set('r1', el('r1', 99, 1, { type: 'image' }));
    flush();
    expect(onA).not.toHaveBeenCalled();
    expect(getBoardElements(a).get('r1')?.version).toBe(1);
    expect(getBoardElements(b).get('r1')?.version).toBe(1);
    expect(snapshot(syncB)).toEqual([['r1', 1, 10, 5, false]]);
  });

  it('after destroy, pushLocal writes nothing and remote changes are not delivered', () => {
    const { a, flush, syncA, syncB, onA } = setup();
    syncA.destroy();
    syncA.pushLocal([el('r1', 1, 1)]);
    expect(getBoardElements(a).size).toBe(0);
    syncB.pushLocal([el('r2', 1, 1)]);
    flush();
    expect(onA).not.toHaveBeenCalled();
    syncA.destroy(); // idempotent
  });
});
