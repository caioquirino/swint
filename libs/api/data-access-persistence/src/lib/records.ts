import type { SessionStatus } from '@swint/shared-domain';

export interface UserRecord {
  sub: string;
  orgId: string;
  name: string;
  email: string | null;
  roles: string[];
  lastLoginAt: number;
}

export interface AuthSessionRecord {
  idHash: string;
  userSub: string;
  orgId: string;
  name: string;
  email: string | null;
  roles: string[];
  idToken: string;
  /** epoch SECONDS (DynamoDB TTL) */
  expiresAt: number;
}

export interface TemplateRecord {
  id: string;
  orgId: string;
  title: string;
  instructionsMd: string;
  rubricMd: string;
  durationMin: number;
  boardSeedKey: string | null;
  archived: boolean;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface TemplateSnapshot {
  title: string;
  instructionsMd: string;
  rubricMd: string;
  durationMin: number;
  boardSeedKey: string | null;
}

export interface SessionRecord {
  id: string;
  orgId: string;
  templateId: string;
  templateSnapshot: TemplateSnapshot;
  candidateName: string;
  status: SessionStatus;
  startedAt: number | null;
  durationSec: number;
  extensionSec: number;
  endedAt: number | null;
  endedBy: string | null;
  cancelReason: string | null;
  activeInviteHash: string;
  createdBy: string;
  createdAt: number;
  /** optimistic concurrency counter, starts at 1 */
  version: number;
}

export interface InviteRecord {
  hash: string;
  orgId: string;
  sessionId: string;
  createdAt: number;
  revokedAt: number | null;
}
