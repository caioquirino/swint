import { describe, expect, it } from 'vitest';
import { createRouterClient } from '@orpc/server';
import type { Identity } from '@swint/api-util-rpc';
import { createTestStores } from '@swint/api-data-access-persistence/testing';
import { createTemplatesRouter } from './templates-router.js';

const interviewer = (orgId = 'default'): Identity => ({
  kind: 'interviewer',
  sub: 'sub-1',
  name: 'Ada',
  email: null,
  orgId,
  roles: ['interviewer'],
});

async function setup() {
  const stores = await createTestStores();
  let t = 1_000;
  let n = 0;
  const router = createTemplatesRouter({
    templates: stores.templates,
    blobs: stores.blobs,
    clock: { now: () => (t += 10) },
    newId: () => `id-${++n}`,
  });
  const as = (identity: Identity | null) => createRouterClient({ templates: router }, { context: { identity, requestId: 't' } }).templates;
  return { stores, as };
}

const input = {
  title: 'URL shortener',
  instructionsMd: '# Design it',
  rubricMd: '- scaling',
  durationMin: 45,
  boardSeed: { elements: [{ id: 'e1', type: 'rectangle', version: 1, versionNonce: 5, index: 'a0', isDeleted: false }] },
};

describe('templates router', () => {
  it('rejects anonymous (UNAUTHORIZED) and candidates (FORBIDDEN)', async () => {
    const { as } = await setup();
    await expect(as(null).list({})).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(as({ kind: 'candidate', sessionId: 's', orgId: 'default', inviteHash: 'h', name: 'Bo' }).list({})).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('creates, gets and returns the starting board', async () => {
    const { as } = await setup();
    const created = await as(interviewer()).create(input);
    expect(created).toMatchObject({
      id: 'id-1',
      title: 'URL shortener',
      hasBoardSeed: true,
      archived: false,
      createdBy: 'sub-1',
    });
    await expect(as(interviewer()).get({ id: created.id })).resolves.toEqual(created);
    await expect(as(interviewer()).getSeed({ id: created.id })).resolves.toEqual(input.boardSeed);
  });

  it('getSeed returns an empty board when the template has none', async () => {
    const { as } = await setup();
    const created = await as(interviewer()).create({ ...input, boardSeed: null });
    expect(created.hasBoardSeed).toBe(false);
    await expect(as(interviewer()).getSeed({ id: created.id })).resolves.toEqual({ elements: [] });
  });

  it('isolates orgs: another org gets NOT_FOUND', async () => {
    const { as } = await setup();
    const created = await as(interviewer()).create(input);
    await expect(as(interviewer('other-org')).get({ id: created.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(as(interviewer('other-org')).list({})).resolves.toEqual([]);
  });

  it('update with boardSeed null keeps the starting board; a new seed is written to a new key', async () => {
    const { stores, as } = await setup();
    const created = await as(interviewer()).create(input);
    const before = await stores.templates.get('default', created.id);
    const updated = await as(interviewer()).update({ id: created.id, ...input, title: 'Renamed', boardSeed: null });
    expect(updated).toMatchObject({ title: 'Renamed', hasBoardSeed: true });
    expect((await stores.templates.get('default', created.id))?.boardSeedKey).toBe(before?.boardSeedKey);
    await as(interviewer()).update({ id: created.id, ...input, boardSeed: { elements: [] } });
    expect((await stores.templates.get('default', created.id))?.boardSeedKey).not.toBe(before?.boardSeedKey);
    expect(updated.updatedAt).toBeGreaterThan(created.updatedAt);
  });

  it('archive hides from the default list but includeArchived shows it', async () => {
    const { as } = await setup();
    const a = await as(interviewer()).create({ ...input, title: 'A' });
    await as(interviewer()).create({ ...input, title: 'B' });
    await expect(as(interviewer()).archive({ id: a.id })).resolves.toMatchObject({ archived: true });
    expect((await as(interviewer()).list({})).map((t) => t.title)).toEqual(['B']);
    expect((await as(interviewer()).list({ includeArchived: false })).map((t) => t.title)).toEqual(['B']);
    expect((await as(interviewer()).list({ includeArchived: true })).map((t) => t.title)).toEqual(['A', 'B']);
  });

  it('update/archive of a missing template is NOT_FOUND', async () => {
    const { as } = await setup();
    await expect(as(interviewer()).update({ id: 'nope', ...input })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(as(interviewer()).archive({ id: 'nope' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
