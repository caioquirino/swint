import { oc } from '@orpc/contract';
import { z } from 'zod';
import {
  boardSeedSchema,
  createSessionInputSchema,
  createSessionOutputSchema,
  extensionMinutesSchema,
  idSchema,
  meSchema,
  roomViewSchema,
  sessionSchema,
  sessionStatusSchema,
  sessionSummarySchema,
  templateInputSchema,
  templateSchema,
  templateSummarySchema,
} from './schemas.js';

const byId = z.object({ id: idSchema });

export const contract = {
  me: {
    get: oc.route({ method: 'GET', path: '/me' }).output(meSchema),
  },
  templates: {
    list: oc
      .route({ method: 'GET', path: '/templates' })
      .input(z.object({ includeArchived: z.union([z.boolean(), z.stringbool()]).optional() }))
      .output(z.array(templateSummarySchema)),
    get: oc.route({ method: 'GET', path: '/templates/{id}' }).input(byId).output(templateSchema),
    getSeed: oc.route({ method: 'GET', path: '/templates/{id}/seed' }).input(byId).output(boardSeedSchema),
    create: oc.route({ method: 'POST', path: '/templates' }).input(templateInputSchema).output(templateSchema),
    update: oc.route({ method: 'PUT', path: '/templates/{id}' }).input(byId.extend(templateInputSchema.shape)).output(templateSchema),
    archive: oc.route({ method: 'POST', path: '/templates/{id}/archive' }).input(byId).output(templateSchema),
  },
  sessions: {
    list: oc
      .route({ method: 'GET', path: '/sessions' })
      .input(z.object({ status: sessionStatusSchema.optional() }))
      .output(z.array(sessionSummarySchema)),
    get: oc.route({ method: 'GET', path: '/sessions/{id}' }).input(byId).output(sessionSchema),
    create: oc.route({ method: 'POST', path: '/sessions' }).input(createSessionInputSchema).output(createSessionOutputSchema),
    start: oc.route({ method: 'POST', path: '/sessions/{id}/start' }).input(byId).output(sessionSchema),
    extend: oc
      .route({ method: 'POST', path: '/sessions/{id}/extend' })
      .input(byId.extend({ minutes: extensionMinutesSchema }))
      .output(sessionSchema),
    end: oc.route({ method: 'POST', path: '/sessions/{id}/end' }).input(byId).output(sessionSchema),
    cancel: oc
      .route({ method: 'POST', path: '/sessions/{id}/cancel' })
      .input(
        byId.extend({
          reason: z
            .string()
            .trim()
            .max(500)
            .optional()
            .transform((r) => r || undefined),
        }),
      )
      .output(sessionSchema),
    regenerateInvite: oc
      .route({ method: 'POST', path: '/sessions/{id}/invite' })
      .input(byId)
      .output(z.object({ candidateUrl: z.url() })),
  },
  room: {
    get: oc
      .route({ method: 'GET', path: '/room/{sessionId}' })
      .input(z.object({ sessionId: idSchema }))
      .output(roomViewSchema),
  },
};

export type AppContract = typeof contract;
