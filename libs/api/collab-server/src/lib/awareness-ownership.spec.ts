import { describe, expect, it } from 'vitest';
import { dropForeignClients } from './awareness-ownership.js';

const view = (own: number[], others: number[]) => ({ own: new Set(own), ownedByOther: (id: number) => others.includes(id) });

describe('dropForeignClients', () => {
  it('keeps own and unclaimed states, drops states owned by another connection', () => {
    const states = new Map<number, Record<string, unknown>>([
      [1, { a: 1 }],
      [2, { a: 2 }],
      [3, { a: 3 }],
    ]);
    dropForeignClients(view([1], [2]), states, new Set());
    expect([...states.keys()]).toEqual([1, 3]);
  });

  it('allows removing only own clients', () => {
    const removed = new Set([1, 2, 3]);
    dropForeignClients(view([1], [2]), new Map(), removed);
    expect([...removed]).toEqual([1]);
  });
});
