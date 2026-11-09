import { z } from 'zod';
import type { SyncedElement } from './documents.js';

/** Element types allowed on the board. Images are disabled in v1 (spec §7.2). */
export const BOARD_ELEMENT_TYPES = ['rectangle', 'diamond', 'ellipse', 'arrow', 'line', 'freedraw', 'text', 'frame'] as const;

/** Whether an Excalidraw element type may live on the shared board (no images or embeds in v1). */
export function isSupportedElementType(type: unknown): boolean {
  return typeof type === 'string' && (BOARD_ELEMENT_TYPES as readonly string[]).includes(type);
}

const point = z.tuple([z.number(), z.number()]);

/**
 * Minimal structural check on a board element before it reaches Excalidraw. Candidates can write
 * to the board, so a malformed value must never crash interviewer clients. Unknown fields pass through.
 */
export const boardElementSchema = z.looseObject({
  id: z.string().min(1).max(128),
  type: z.enum(BOARD_ELEMENT_TYPES),
  version: z.number().int().min(1),
  versionNonce: z.number().int(),
  index: z.string().max(256).nullable(),
  isDeleted: z.boolean(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  angle: z.number().optional(),
  points: z.array(point).max(20_000).optional(),
  text: z.string().max(50_000).optional(),
  groupIds: z.array(z.string()).max(100).optional(),
  boundElements: z
    .array(z.object({ id: z.string(), type: z.enum(['arrow', 'text']) }))
    .max(1000)
    .nullable()
    .optional(),
});

export function isValidBoardElement(value: unknown): value is SyncedElement {
  return boardElementSchema.safeParse(value).success;
}
