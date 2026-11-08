import { base } from '@swint/api-util-rpc';
import { createMeRouter } from '@swint/api-feature-auth';
import { createTemplatesRouter, type TemplatesDeps } from '@swint/api-feature-templates';
import { createRoomRouter, createSessionsRouter, type SessionsDeps } from '@swint/api-feature-sessions';

export type RouterDeps = TemplatesDeps & SessionsDeps;

export function buildRouter(deps: RouterDeps) {
  return base.router({
    me: createMeRouter(),
    templates: createTemplatesRouter(deps),
    sessions: createSessionsRouter(deps),
    room: createRoomRouter(deps),
  });
}

export type AppRouter = ReturnType<typeof buildRouter>;
