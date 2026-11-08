export interface InterviewerIdentity {
  kind: 'interviewer';
  sub: string;
  name: string;
  email: string | null;
  orgId: string;
  roles: string[];
}

export interface CandidateIdentity {
  kind: 'candidate';
  sessionId: string;
  orgId: string;
  inviteHash: string;
  name: string;
}

export type Identity = InterviewerIdentity | CandidateIdentity;

export interface RpcContext {
  identity: Identity | null;
  requestId: string;
}

export const INTERVIEWER_ROLE = 'interviewer';
