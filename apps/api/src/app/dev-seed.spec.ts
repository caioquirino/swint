import { afterEach, describe, expect, it } from 'vitest';
import { createTestStores, type TestStores } from '@swint/api-data-access-persistence/testing';
import { isValidBoardElement } from '@swint/shared-collab-protocol';
import { DEV_SEED_TITLE, devSeedElements, seedDevData } from './dev-seed.js';

let stores: TestStores | undefined;
afterEach(() => {
  stores?.raw.destroy();
  stores?.s3.destroy();
});

let n = 0;
const deps = (s: TestStores) => ({
  templates: s.templates,
  blobs: s.blobs,
  clock: { now: () => 1_700_000_000_000 },
  newId: () => `id-${++n}`,
  orgId: 'default',
});

describe('seedDevData', () => {
  it('creates the URL-shortener template once, with a starting board', async () => {
    stores = await createTestStores();
    await expect(seedDevData(deps(stores))).resolves.toBe('created');
    await expect(seedDevData(deps(stores))).resolves.toBe('exists');

    const all = await stores.templates.listByOrg('default', { includeArchived: true });
    const seeded = all.filter((t) => t.title === DEV_SEED_TITLE);
    expect(seeded).toHaveLength(1);
    expect(seeded[0]).toMatchObject({ durationMin: 45, archived: false, createdBy: 'system' });
    expect(seeded[0].instructionsMd).toContain('URL shortener');
    expect(seeded[0].rubricMd.length).toBeGreaterThan(0);
    const seed = await stores.blobs.getJson<{ elements: unknown[] }>(seeded[0].boardSeedKey as string);
    expect(seed?.elements.length).toBeGreaterThan(0);
  });

  it('counts an archived copy as existing', async () => {
    stores = await createTestStores();
    await seedDevData(deps(stores));
    const [t] = await stores.templates.listByOrg('default', { includeArchived: true });
    await stores.templates.update({ ...t, archived: true });
    await expect(seedDevData(deps(stores))).resolves.toBe('exists');
  });
});

describe('devSeedElements', () => {
  it('produces valid, uniquely identified board elements', () => {
    const elements = devSeedElements();
    expect(elements.every(isValidBoardElement)).toBe(true);
    expect(new Set(elements.map((e) => e['id'])).size).toBe(elements.length);
  });
});
