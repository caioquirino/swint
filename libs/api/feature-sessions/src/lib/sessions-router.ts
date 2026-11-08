import { ORPCError } from '@orpc/server';
import type { BoardSeed } from '@swint/shared-api-contract';
import { applyCommand, initialLifecycle, InvalidTransitionError, isFinished, type SessionCommand } from '@swint/shared-domain';
import {
  blobKeys,
  type BlobStore,
  type InvitesRepo,
  type SessionRecord,
  type SessionsRepo,
  StaleWriteError,
  type TemplatesRepo,
} from '@swint/api-data-access-persistence';
import { interviewerProcedures, sha256Hex, type Clock, type IdGenerator, type InterviewerIdentity } from '@swint/api-util-rpc';
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

  async function runCommand(interviewer: InterviewerIdentity, id: string, command: SessionCommand) {
    const rec = await load(interviewer.orgId, id);
    let next: SessionRecord;
    try {
      next = { ...rec, ...applyCommand(rec, command, { now: deps.clock.now(), actorId: interviewer.sub }) };
    } catch (e) {
      if (e instanceof InvalidTransitionError) throw new ORPCError('CONFLICT', { message: e.message });
      throw e;
    }
    let stored: SessionRecord;
    try {
      stored = await deps.sessions.update(next, rec.version);
    } catch (e) {
      if (e instanceof StaleWriteError) throw new ORPCError('CONFLICT', { message: 'Session changed, retry' });
      throw e;
    }
    await deps.events.sessionChanged(stored);
    return toSession(stored);
  }

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

    start: p.start.handler(({ input, context }) => runCommand(context.interviewer, input.id, { type: 'start' })),
    extend: p.extend.handler(({ input, context }) =>
      runCommand(context.interviewer, input.id, { type: 'extend', minutes: input.minutes }),
    ),
    end: p.end.handler(({ input, context }) => runCommand(context.interviewer, input.id, { type: 'end' })),
    cancel: p.cancel.handler(({ input, context }) =>
      runCommand(context.interviewer, input.id, { type: 'cancel', reason: input.reason }),
    ),
    regenerateInvite: p.regenerateInvite.handler(async ({ input, context }) => {
      const rec = await load(context.interviewer.orgId, input.id);
      if (isFinished(rec.status)) throw new ORPCError('CONFLICT', { message: 'Session is finished' });
      const invite = await issueInvite(rec.orgId, rec.id);
      let stored: SessionRecord;
      try {
        stored = await deps.sessions.update({ ...rec, activeInviteHash: invite.hash }, rec.version);
      } catch (e) {
        try {
          await deps.invites.revoke(invite.hash, deps.clock.now());
        } catch {
          // Best effort: the new invite never became the session's activeInviteHash, so it is
          // already unusable (join and identity resolution require activeInviteHash === hash).
        }
        if (e instanceof StaleWriteError) throw new ORPCError('CONFLICT', { message: 'Session changed, retry' });
        throw e;
      }
      try {
        await deps.invites.revoke(rec.activeInviteHash, deps.clock.now());
      } catch {
        // Best effort (no logger in the router): the session now points at the new invite, and
        // join/identity resolution require activeInviteHash === hash, so the old link is already dead.
      }
      // Cuts off candidates still connected with the old invite (events never throw).
      await deps.events.sessionChanged(stored);
      return { candidateUrl: invite.candidateUrl };
    }),
  };
}
