import { blobKeys, type BlobStore, type TemplatesRepo } from '@swint/api-data-access-persistence';
import type { Clock, IdGenerator } from '@swint/api-util-rpc';

export const DEV_SEED_TITLE = 'Design a URL shortener';

const INSTRUCTIONS = `# Design a URL shortener

Design a service like bit.ly that turns long URLs into short links and redirects visitors.

## Requirements
- Create a short link for a long URL (optionally with a custom alias).
- Redirect a short link to its long URL with low latency.
- Links can expire.
- Track click counts per link.

## Scale
- 100M new links per month, 10:1 read/write ratio.

Use the board to sketch your architecture. Talk us through your trade-offs.`;

const RUBRIC = `- **Requirements**: clarifies functional and non-functional requirements, estimates scale.
- **API and data model**: clear endpoints; sensible key generation (hash vs counter vs pre-generated keys).
- **Read path**: caching, CDN, redirect status codes (301 vs 302).
- **Scaling**: partitioning, replication, hot keys.
- **Trade-offs**: consistency of counters, expiry clean-up, abuse prevention.`;

interface ElementSpec {
  id: string;
  type: 'rectangle' | 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  index: string;
  seed: number;
  extra?: Record<string, unknown>;
}

function element(s: ElementSpec): Record<string, unknown> {
  return {
    id: s.id,
    type: s.type,
    x: s.x,
    y: s.y,
    width: s.width,
    height: s.height,
    angle: 0,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: s.index,
    roundness: s.type === 'rectangle' ? { type: 3 } : null,
    seed: s.seed,
    version: 1,
    versionNonce: s.seed + 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    ...s.extra,
  };
}

function box(id: string, x: number, label: string, index: number): Record<string, unknown>[] {
  const text = {
    text: label,
    originalText: label,
    fontSize: 20,
    fontFamily: 5,
    textAlign: 'left',
    verticalAlign: 'top',
    containerId: null,
    autoResize: true,
    lineHeight: 1.25,
  };
  return [
    element({ id: `${id}-box`, type: 'rectangle', x, y: 100, width: 160, height: 80, index: `a${index * 2}`, seed: 1000 + index * 10 }),
    element({
      id: `${id}-label`,
      type: 'text',
      x: x + 20,
      y: 125,
      width: label.length * 11,
      height: 25,
      index: `a${index * 2 + 1}`,
      seed: 2000 + index * 10,
      extra: text,
    }),
  ];
}

/** A small starting board: Client → API → Database boxes with labels (complete Excalidraw 0.18 shapes). */
export function devSeedElements(): Record<string, unknown>[] {
  return [...box('client', 40, 'Client', 0), ...box('api', 280, 'API', 1), ...box('db', 520, 'Database', 2)];
}

export interface DevSeedDeps {
  templates: TemplatesRepo;
  blobs: BlobStore;
  clock: Clock;
  newId: IdGenerator;
  orgId: string;
}

/** Spec §10: in dev, ensure the "Design a URL shortener" template exists. Archived copies count. */
export async function seedDevData(deps: DevSeedDeps): Promise<'created' | 'exists'> {
  const existing = await deps.templates.listByOrg(deps.orgId, { includeArchived: true });
  if (existing.some((t) => t.title === DEV_SEED_TITLE)) return 'exists';
  const id = deps.newId();
  const now = deps.clock.now();
  const boardSeedKey = blobKeys.templateSeed(deps.orgId, id, deps.newId());
  await deps.blobs.putJson(boardSeedKey, { elements: devSeedElements() });
  await deps.templates.create({
    id,
    orgId: deps.orgId,
    title: DEV_SEED_TITLE,
    instructionsMd: INSTRUCTIONS,
    rubricMd: RUBRIC,
    durationMin: 45,
    boardSeedKey,
    archived: false,
    createdBy: 'system',
    createdAt: now,
    updatedAt: now,
  });
  return 'created';
}
