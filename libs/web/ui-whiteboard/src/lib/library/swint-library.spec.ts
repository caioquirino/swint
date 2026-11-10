import { describe, expect, it } from 'vitest';
import { isSupportedElementType } from '@swint/shared-collab-protocol';
import { ALLOWED_FONT_FAMILIES, CLEAN_ROUGHNESS } from '../board-style.js';
import { isSwintLibrary, SWINT_LIBRARY } from './swint-library.js';

describe('SWINT_LIBRARY', () => {
  it('has the agreed vendor-neutral items, each with a unique id and name', () => {
    expect(SWINT_LIBRARY.map((i) => i.name)).toEqual([
      'Client',
      'Mobile app',
      'User',
      'DNS',
      'CDN',
      'Load balancer',
      'API gateway',
      'Service',
      'Worker',
      'Database',
      'Cache',
      'Queue',
      'Pub/Sub topic',
      'Object storage',
      'Search index',
      'External service',
      'Region',
    ]);
    expect(new Set(SWINT_LIBRARY.map((i) => i.id)).size).toBe(SWINT_LIBRARY.length);
  });

  it('only uses board-legal elements: supported types, clean lines, Normal/Code fonts, grouped per item', () => {
    for (const item of SWINT_LIBRARY) {
      for (const e of item.elements) {
        expect(isSupportedElementType(e.type)).toBe(true);
        expect(e.roughness).toBe(CLEAN_ROUGHNESS);
        if (e.type === 'text') expect(ALLOWED_FONT_FAMILIES).toContain(e.fontFamily);
        expect(e.groupIds).toEqual([item.id]);
      }
    }
  });

  it('stays small (it ships in the board chunk)', () => {
    expect(JSON.stringify(SWINT_LIBRARY).length).toBeLessThan(150_000);
  });

  it('isSwintLibrary recognises exactly our items', () => {
    expect(isSwintLibrary(SWINT_LIBRARY)).toBe(true);
    expect(isSwintLibrary([...SWINT_LIBRARY, { id: 'extra' }])).toBe(false);
    expect(isSwintLibrary(SWINT_LIBRARY.slice(1))).toBe(false);
  });
});
