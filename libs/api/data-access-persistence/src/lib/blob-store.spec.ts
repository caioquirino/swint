import { describe, expect, it } from 'vitest';
import { createTestStores } from '../testing/index.js';
import { blobKeys } from './blob-store.js';

describe('BlobStore', () => {
  it('round-trips JSON and returns null for missing keys', async () => {
    const { blobs } = await createTestStores();
    await blobs.putJson('a/b.json', { elements: [{ id: 'e1' }] });
    await expect(blobs.getJson('a/b.json')).resolves.toEqual({ elements: [{ id: 'e1' }] });
    await expect(blobs.getJson('missing.json')).resolves.toBeNull();
  });

  it('round-trips bytes and returns null for missing keys', async () => {
    const { blobs } = await createTestStores();
    const bytes = new Uint8Array([1, 2, 3, 250]);
    await blobs.putBytes('x/latest.bin', bytes);
    await expect(blobs.getBytes('x/latest.bin')).resolves.toEqual(bytes);
    await expect(blobs.getBytes('x/none.bin')).resolves.toBeNull();
  });

  it('builds the spec §4.2 key layout', () => {
    expect(blobKeys.templateSeed('o1', 't1', 's1')).toBe('orgs/o1/templates/t1/seed-s1.excalidraw.json');
    expect(blobKeys.sessionBoardLatest('o1', 'x1')).toBe('orgs/o1/sessions/x1/board/latest.bin');
    expect(blobKeys.sessionBoardCheckpoint('o1', 'x1', 1700000000000)).toBe(
      'orgs/o1/sessions/x1/board/checkpoints/1700000000000.bin',
    );
    expect(blobKeys.sessionNotesLatest('o1', 'x1')).toBe('orgs/o1/sessions/x1/notes/latest.bin');
  });
});
