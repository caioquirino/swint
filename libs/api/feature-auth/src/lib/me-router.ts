import { interviewerProcedures } from '@swint/api-util-rpc';

export function createMeRouter() {
  return {
    get: interviewerProcedures.me.get.handler(({ context }) => ({
      sub: context.interviewer.sub,
      name: context.interviewer.name,
      email: context.interviewer.email,
      orgId: context.interviewer.orgId,
      roles: context.interviewer.roles,
    })),
  };
}
