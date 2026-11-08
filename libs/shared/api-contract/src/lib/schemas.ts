import { z } from 'zod';
import {
  SESSION_STATUSES,
  type ExtensionMinutes,
  type SessionStatus,
} from '@swint/shared-domain';

const epochMs = z.number().int().nonnegative();
export const sessionStatusSchema = z.enum(SESSION_STATUSES as [SessionStatus, ...SessionStatus[]]);

export const idSchema = z.string().min(1).max(64);
/** Must stay in sync with EXTENSION_MINUTES in shared-domain (5 | 10). */
export const extensionMinutesSchema = z.union([z.literal(5), z.literal(10)]) satisfies z.ZodType<ExtensionMinutes>;

export const meSchema = z.object({
  sub: z.string(),
  name: z.string(),
  email: z.email().nullable(),
  orgId: z.string(),
  roles: z.array(z.string()),
});

export const boardSeedSchema = z.object({
  elements: z.array(z.looseObject({ id: z.string().min(1) })),
});

export const templateInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  instructionsMd: z.string().max(50_000),
  rubricMd: z.string().max(50_000),
  durationMin: z.number().int().min(5).max(240),
  /** null = keep the current starting board (on update) / no starting board (on create). */
  boardSeed: boardSeedSchema.nullable(),
});

export const templateSchema = z.object({
  id: idSchema,
  title: z.string(),
  instructionsMd: z.string(),
  rubricMd: z.string(),
  durationMin: z.number().int(),
  hasBoardSeed: z.boolean(),
  archived: z.boolean(),
  createdBy: z.string(),
  createdAt: epochMs,
  updatedAt: epochMs,
});

export const templateSummarySchema = templateSchema.pick({
  id: true,
  title: true,
  durationMin: true,
  archived: true,
  updatedAt: true,
});

const timerSchema = z.object({
  startedAt: epochMs.nullable(),
  durationSec: z.number().int().nonnegative(),
  extensionSec: z.number().int().nonnegative(),
});

export const sessionSchema = z.object({
  id: idSchema,
  title: z.string(),
  candidateName: z.string(),
  status: sessionStatusSchema,
  ...timerSchema.shape,
  endedAt: epochMs.nullable(),
  endedBy: z.string().nullable(),
  cancelReason: z.string().nullable(),
  instructionsMd: z.string(),
  rubricMd: z.string(),
  createdBy: z.string(),
  createdAt: epochMs,
});

export const sessionSummarySchema = sessionSchema.pick({
  id: true,
  title: true,
  candidateName: true,
  status: true,
  startedAt: true,
  createdAt: true,
});

export const createSessionInputSchema = z.object({
  templateId: idSchema,
  candidateName: z.string().trim().min(1).max(100),
});

export const createSessionOutputSchema = z.object({
  session: sessionSchema,
  candidateUrl: z.url(),
  interviewerUrl: z.url(),
});

const roomBase = {
  sessionId: idSchema,
  title: z.string(),
  status: sessionStatusSchema,
  timer: timerSchema,
};

/** z.object strips unknown keys, so private fields never survive parsing a candidate view. */
export const candidateRoomViewSchema = z.object({
  ...roomBase,
  role: z.literal('candidate'),
  /** null while the session is in the waiting room (status = created). */
  instructionsMd: z.string().nullable(),
  me: z.object({ name: z.string() }),
});

export const interviewerRoomViewSchema = z.object({
  ...roomBase,
  role: z.literal('interviewer'),
  instructionsMd: z.string(),
  rubricMd: z.string(),
  candidateName: z.string(),
  me: z.object({ name: z.string(), sub: z.string() }),
});

export const roomViewSchema = z.discriminatedUnion('role', [candidateRoomViewSchema, interviewerRoomViewSchema]);

export type Me = z.infer<typeof meSchema>;
export type BoardSeed = z.infer<typeof boardSeedSchema>;
export type TemplateInput = z.infer<typeof templateInputSchema>;
export type Template = z.infer<typeof templateSchema>;
export type TemplateSummary = z.infer<typeof templateSummarySchema>;
export type Session = z.infer<typeof sessionSchema>;
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type CreateSessionInput = z.infer<typeof createSessionInputSchema>;
export type CreateSessionOutput = z.infer<typeof createSessionOutputSchema>;
export type RoomView = z.infer<typeof roomViewSchema>;
