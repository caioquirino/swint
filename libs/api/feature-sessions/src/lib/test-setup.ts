import { vi, type Mock } from 'vitest';
import { createRouterClient } from '@orpc/server';
import type { Identity } from '@swint/api-util-rpc';
import { createTestStores } from '@swint/api-data-access-persistence/testing';
import { createSessionsRouter } from './sessions-router.js';
import type { SessionEvents } from './session-events.js';

export async function setupSessions() {
  const stores = await createTestStores();
  let t = 10_000;
  let n = 0;
  let tok = 0;
  const events: { sessionChanged: Mock<SessionEvents['sessionChanged']> } = { sessionChanged: vi.fn() };
  const router = createSessionsRouter({
    sessions: stores.sessions,
    invites: stores.invites,
    templates: stores.templates,
    blobs: stores.blobs,
    clock: { now: () => (t += 1_000) },
    newId: () => `id-${++n}`,
    newToken: () => `token-${++tok}`,
    publicBaseUrl: 'http://localhost:4200',
    events,
  });
  const as = (identity: Identity | null) => createRouterClient({ sessions: router }, { context: { identity, requestId: 't' } }).sessions;
  await stores.templates.create({
    id: 'tpl-1',
    orgId: 'default',
    title: 'URL shortener',
    instructionsMd: '# Go',
    rubricMd: '- scaling',
    durationMin: 45,
    boardSeedKey: 'seeds/tpl-1.json',
    archived: false,
    createdBy: 'sub-1',
    createdAt: 1,
    updatedAt: 1,
  });
  await stores.blobs.putJson('seeds/tpl-1.json', {
    elements: [{ id: 'e1', type: 'rectangle', version: 2, versionNonce: 4, index: 'a0', isDeleted: false }],
  });
  return { stores, as, events };
}
