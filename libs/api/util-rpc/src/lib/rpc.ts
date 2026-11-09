import { implement, ORPCError, os } from '@orpc/server';
import { contract } from '@swint/shared-api-contract';
import { INTERVIEWER_ROLE, type InterviewerIdentity, type RpcContext } from './identity.js';

export const base = implement(contract).$context<RpcContext>();

export const requireInterviewer = os.$context<RpcContext>().middleware(async ({ context, next }) => {
  const identity = context.identity;
  if (!identity) throw new ORPCError('UNAUTHORIZED');
  if (identity.kind !== 'interviewer' || !identity.roles.includes(INTERVIEWER_ROLE)) {
    throw new ORPCError('FORBIDDEN');
  }
  const interviewer: InterviewerIdentity = identity;
  return next({ context: { interviewer } });
});

export const interviewerProcedures = base.use(requireInterviewer);
