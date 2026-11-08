import { ORPCError } from '@orpc/server';
import type { BoardSeed, Template, TemplateSummary } from '@swint/shared-api-contract';
import {
  blobKeys,
  StaleWriteError,
  type BlobStore,
  type TemplateRecord,
  type TemplatesRepo,
} from '@swint/api-data-access-persistence';
import { interviewerProcedures, type Clock, type IdGenerator } from '@swint/api-util-rpc';

export interface TemplatesDeps {
  templates: TemplatesRepo;
  blobs: BlobStore;
  clock: Clock;
  newId: IdGenerator;
}

export function toTemplate(rec: TemplateRecord): Template {
  return {
    id: rec.id,
    title: rec.title,
    instructionsMd: rec.instructionsMd,
    rubricMd: rec.rubricMd,
    durationMin: rec.durationMin,
    hasBoardSeed: rec.boardSeedKey !== null,
    archived: rec.archived,
    createdBy: rec.createdBy,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}

const toSummary = (rec: TemplateRecord): TemplateSummary => ({
  id: rec.id,
  title: rec.title,
  durationMin: rec.durationMin,
  archived: rec.archived,
  updatedAt: rec.updatedAt,
});

export function createTemplatesRouter(deps: TemplatesDeps) {
  const p = interviewerProcedures.templates;

  async function load(orgId: string, id: string): Promise<TemplateRecord> {
    const rec = await deps.templates.get(orgId, id);
    if (!rec) throw new ORPCError('NOT_FOUND');
    return rec;
  }

  async function writeSeed(orgId: string, templateId: string, seed: BoardSeed): Promise<string> {
    const key = blobKeys.templateSeed(orgId, templateId, deps.newId());
    await deps.blobs.putJson(key, seed);
    return key;
  }

  async function save(rec: TemplateRecord): Promise<TemplateRecord> {
    try {
      await deps.templates.update(rec);
      return rec;
    } catch (e) {
      if (e instanceof StaleWriteError) throw new ORPCError('NOT_FOUND');
      throw e;
    }
  }

  return {
    list: p.list.handler(async ({ input, context }) => {
      const recs = await deps.templates.listByOrg(context.interviewer.orgId, {
        includeArchived: input.includeArchived ?? false,
      });
      return recs.map(toSummary);
    }),

    get: p.get.handler(async ({ input, context }) => toTemplate(await load(context.interviewer.orgId, input.id))),

    getSeed: p.getSeed.handler(async ({ input, context }) => {
      const rec = await load(context.interviewer.orgId, input.id);
      if (!rec.boardSeedKey) return { elements: [] };
      return (await deps.blobs.getJson<BoardSeed>(rec.boardSeedKey)) ?? { elements: [] };
    }),

    create: p.create.handler(async ({ input, context }) => {
      const { orgId, sub } = context.interviewer;
      const id = deps.newId();
      const now = deps.clock.now();
      const rec: TemplateRecord = {
        id,
        orgId,
        title: input.title,
        instructionsMd: input.instructionsMd,
        rubricMd: input.rubricMd,
        durationMin: input.durationMin,
        boardSeedKey: input.boardSeed ? await writeSeed(orgId, id, input.boardSeed) : null,
        archived: false,
        createdBy: sub,
        createdAt: now,
        updatedAt: now,
      };
      await deps.templates.create(rec);
      return toTemplate(rec);
    }),

    update: p.update.handler(async ({ input, context }) => {
      const { orgId } = context.interviewer;
      const current = await load(orgId, input.id);
      const next: TemplateRecord = {
        ...current,
        title: input.title,
        instructionsMd: input.instructionsMd,
        rubricMd: input.rubricMd,
        durationMin: input.durationMin,
        boardSeedKey: input.boardSeed ? await writeSeed(orgId, current.id, input.boardSeed) : current.boardSeedKey,
        updatedAt: deps.clock.now(),
      };
      return toTemplate(await save(next));
    }),

    archive: p.archive.handler(async ({ input, context }) => {
      const current = await load(context.interviewer.orgId, input.id);
      return toTemplate(await save({ ...current, archived: true, updatedAt: deps.clock.now() }));
    }),
  };
}
