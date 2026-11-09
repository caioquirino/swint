import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { AuthSessionRecord } from './records.js';
import { fromItem, type Table } from './table.js';

export interface AuthSessionsRepo {
  create(rec: AuthSessionRecord): Promise<void>;
  /** Returns null when missing or expired (DynamoDB TTL deletion is lazy, so expiry is also checked here). */
  get(idHash: string, nowMs: number): Promise<AuthSessionRecord | null>;
  delete(idHash: string): Promise<void>;
}

const key = (idHash: string) => ({ PK: `AUTHSESSION#${idHash}`, SK: 'META' });

export function createAuthSessionsRepo(table: Table): AuthSessionsRepo {
  return {
    async create(rec) {
      await table.doc.send(new PutCommand({ TableName: table.name, Item: { ...key(rec.idHash), ...rec } }));
    },
    async get(idHash, nowMs) {
      const out = await table.doc.send(new GetCommand({ TableName: table.name, Key: key(idHash), ConsistentRead: true }));
      if (!out.Item) return null;
      const rec = fromItem<AuthSessionRecord>(out.Item);
      return rec.expiresAt * 1000 > nowMs ? rec : null;
    },
    async delete(idHash) {
      await table.doc.send(new DeleteCommand({ TableName: table.name, Key: key(idHash) }));
    },
  };
}
