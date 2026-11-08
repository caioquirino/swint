import { ORPCError } from '@orpc/server';
import type { BoardSeed } from '@swint/shared-api-contract';
import { initialLifecycle } from '@swint/shared-domain';
import {
  blobKeys,
  type BlobStore,
  type InvitesRepo,
  type SessionRecord,
  type SessionsRepo,
  type TemplatesRepo,
} from '@swint/api-data-access-persistence';
import { interviewerProcedures, sha256Hex, type Clock, type IdGenerator } from '@swint/api-util-rpc';
import { buildInitialBoardUpdate } from './initial-board.js';
import { toSession, toSessionSummary } from './mappers.js';
import type { SessionEvents } from './session-events.js';

export interface SessionsDeps {
  sessions: SessionsRepo;
  invites: InvitesRepo;
  templates: TemplatesRepo;
  blobs: BlobStore;
  clock: Clock;
  newId: IdGenerator;
  /** Returns a fresh raw invite token (only its sha256 is stored). */
  newToken: () => string;
  /** Public origin of the web app, e.g. http://localhost:4200 */
  publicBaseUrl: string;
  events: SessionEvents;
}

export function createSessionsRouter(deps: SessionsDeps) {
  const p = interviewerProcedures.sessions;

  async function load(orgId: string, id: string): Promise<SessionRecord> {
    const rec = await deps.sessions.get(orgId, id);
    if (!rec) throw new ORPCError('NOT_FOUND');
    return rec;
  }

  async function issueInvite(orgId: string, sessionId: string): Promise<{ hash: string; candidateUrl: string }> {
    const token = deps.newToken();
    const hash = sha256Hex(token);
    await deps.invites.create({ hash, orgId, sessionId, createdAt: deps.clock.now(), revokedAt: null });
    return { hash, candidateUrl: `${deps.publicBaseUrl}/join/${token}` };
  }

  const notImplemented = () => {
    throw new ORPCError('NOT_IMPLEMENTED');
  };

  return {
    list: p.list.handler(async ({ input, context }) =>
      (await deps.sessions.listByOrg(context.interviewer.orgId, { status: input.status })).map(toSessionSummary),
    ),

    get: p.get.handler(async ({ input, context }) => toSession(await load(context.interviewer.orgId, input.id))),

    create: p.create.handler(async ({ input, context }) => {
      const { orgId, sub } = context.interviewer;
      const template = await deps.templates.get(orgId, input.templateId);
      if (!template) throw new ORPCError('NOT_FOUND');
      if (template.archived) throw new ORPCError('BAD_REQUEST', { message: 'Template is archived' });

      const id = deps.newId();
      const seed = template.boardSeedKey ? await deps.blobs.getJson<BoardSeed>(template.boardSeedKey) : null;
      await deps.blobs.putBytes(
        blobKeys.sessionBoardLatest(orgId, id),
        buildInitialBoardUpdate(seed ?? { elements: [] }),
      );

      const invite = await issueInvite(orgId, id);
      const rec: SessionRecord = {
        id,
        orgId,
        templateId: template.id,
        templateSnapshot: {
          title: template.title,
          instructionsMd: template.instructionsMd,
          rubricMd: template.rubricMd,
          durationMin: template.durationMin,
          boardSeedKey: template.boardSeedKey,
        },
        candidateName: input.candidateName,
        ...initialLifecycle(template.durationMin * 60),
        activeInviteHash: invite.hash,
        createdBy: sub,
        createdAt: deps.clock.now(),
        version: 1,
      };
      await deps.sessions.create(rec);
      return {
        session: toSession(rec),
        candidateUrl: invite.candidateUrl,
        interviewerUrl: `${deps.publicBaseUrl}/s/${id}`,
      };
    }),

    start: p.start.handler(notImplemented),
    extend: p.extend.handler(notImplemented),
    end: p.end.handler(notImplemented),
    cancel: p.cancel.handler(notImplemented),
    regenerateInvite: p.regenerateInvite.handler(notImplemented),
  };
}
