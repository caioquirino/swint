import type { DocKind } from '@swint/shared-domain';

const DOC_NAME_PATTERN = /^session:([^:]+):(board|notes)$/;

export const docName = {
  board: (sessionId: string) => `session:${sessionId}:board`,
  notes: (sessionId: string) => `session:${sessionId}:notes`,
} as const;

export function parseDocName(name: string): { sessionId: string; kind: DocKind } | null {
  const match = DOC_NAME_PATTERN.exec(name);
  if (!match) return null;
  return { sessionId: match[1], kind: match[2] as DocKind };
}
