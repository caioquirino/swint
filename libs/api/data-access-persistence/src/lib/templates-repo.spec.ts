import { describe, expect, it } from 'vitest';
import { createTestStores } from '../testing/index.js';
import { StaleWriteError } from './errors.js';
import type { TemplateRecord } from './records.js';

const tpl = (over: Partial<TemplateRecord> = {}): TemplateRecord => ({
  id: 't1',
  orgId: 'default',
  title: 'URL shortener',
  instructionsMd: '# Go',
  rubricMd: '- x',
  durationMin: 45,
  boardSeedKey: null,
  archived: false,
  createdBy: 'sub-1',
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe('TemplatesRepo', () => {
  it('creates and gets within the same org only', async () => {
    const { templates } = await createTestStores();
    await templates.create(tpl());
    await expect(templates.get('default', 't1')).resolves.toEqual(tpl());
    await expect(templates.get('other-org', 't1')).resolves.toBeNull();
    await expect(templates.get('default', 'missing')).resolves.toBeNull();
  });

  it('lists by org sorted by title, excluding archived unless asked', async () => {
    const { templates } = await createTestStores();
    await templates.create(tpl({ id: 't1', title: 'b system' }));
    await templates.create(tpl({ id: 't2', title: 'A chat app' }));
    await templates.create(tpl({ id: 't3', title: 'c old', archived: true }));
    await templates.create(tpl({ id: 't4', title: 'other', orgId: 'other-org' }));
    expect((await templates.listByOrg('default', { includeArchived: false })).map((t) => t.id)).toEqual(['t2', 't1']);
    expect((await templates.listByOrg('default', { includeArchived: true })).map((t) => t.id)).toEqual(['t2', 't1', 't3']);
  });

  it('update replaces and keeps title ordering in sync', async () => {
    const { templates } = await createTestStores();
    await templates.create(tpl({ id: 't1', title: 'zzz' }));
    await templates.create(tpl({ id: 't2', title: 'mmm' }));
    await templates.update(tpl({ id: 't1', title: 'aaa', updatedAt: 5 }));
    expect((await templates.listByOrg('default', { includeArchived: false })).map((t) => t.id)).toEqual(['t1', 't2']);
    await expect(templates.get('default', 't1')).resolves.toMatchObject({ title: 'aaa', updatedAt: 5 });
  });

  it('update of a missing or foreign template throws StaleWriteError', async () => {
    const { templates } = await createTestStores();
    await templates.create(tpl());
    await expect(templates.update(tpl({ id: 'nope' }))).rejects.toBeInstanceOf(StaleWriteError);
    await expect(templates.update(tpl({ orgId: 'other-org' }))).rejects.toBeInstanceOf(StaleWriteError);
  });
});
