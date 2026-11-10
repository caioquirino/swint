import { z } from 'zod';
import { PARTICIPANT_ROLES, type ParticipantRole } from '@swint/shared-domain';

export const AWARENESS_USER_FIELD = 'user';

export const awarenessUserSchema = z.object({
  userId: z.string().min(1),
  name: z.string().min(1).max(100),
  role: z.enum(PARTICIPANT_ROLES as [ParticipantRole, ...ParticipantRole[]]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  pointer: z
    .object({ x: z.number(), y: z.number(), tool: z.enum(['pointer', 'laser']), button: z.enum(['up', 'down']).optional() })
    .optional(),
  selectedElementIds: z.record(z.string(), z.literal(true)),
  /** Excalidraw socket id (the awareness client id) of the user this client follows. */
  following: z
    .string()
    .regex(/^\d{1,16}$/)
    .optional(),
  /** Visible scene bounds, published only while someone follows this client. */
  viewport: z.object({ x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() }).optional(),
});

export type AwarenessUser = z.infer<typeof awarenessUserSchema>;
