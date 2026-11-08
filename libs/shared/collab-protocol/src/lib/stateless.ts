import { z } from 'zod';
import { SESSION_STATUSES, type SessionStatus } from '@swint/shared-domain';

const epochMs = z.number().int().nonnegative();

export const sessionStateMessageSchema = z.object({
  type: z.literal('session.state'),
  status: z.enum(SESSION_STATUSES as [SessionStatus, ...SessionStatus[]]),
  startedAt: epochMs.nullable(),
  durationSec: z.number().int().nonnegative(),
  extensionSec: z.number().int().nonnegative(),
  serverNow: epochMs,
});

export type SessionStateMessage = z.infer<typeof sessionStateMessageSchema>;

export const serverMessageSchema = z.discriminatedUnion('type', [sessionStateMessageSchema]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

export function encodeServerMessage(message: ServerMessage): string {
  return JSON.stringify(serverMessageSchema.parse(message));
}

export function parseServerMessage(payload: string): ServerMessage | null {
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return null;
  }
  const result = serverMessageSchema.safeParse(raw);
  return result.success ? result.data : null;
}
