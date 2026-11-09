import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { SessionStatus } from '@swint/shared-domain';
import { StaleWriteError } from './errors.js';
import type { SessionRecord } from './records.js';
import { GSI1, queryAll, fromItem, type Table } from './table.js';

export interface SessionsRepo {
  create(rec: SessionRecord): Promise<void>;
  get(orgId: string, id: string): Promise<SessionRecord | null>;
  listByOrg(orgId: string, opts: { status?: SessionStatus }): Promise<SessionRecord[]>;
  /** Writes `next` with version = expectedVersion + 1 iff the stored version is expectedVersion. Returns the stored record. */
  update(next: SessionRecord, expectedVersion: number): Promise<SessionRecord>;
}

const pad = (n: number) => String(n).padStart(15, '0');

const item = (rec: SessionRecord) => ({
  PK: `SESSION#${rec.id}`,
  SK: 'META',
  GSI1PK: `ORG#${rec.orgId}`,
  GSI1SK: `SESSION#${pad(rec.createdAt)}#${rec.id}`,
  ...rec,
});

export function createSessionsRepo(table: Table): SessionsRepo {
  return {
    async create(rec) {
      await table.doc.send(
        new PutCommand({
          TableName: table.name,
          Item: item({ ...rec, version: 1 }),
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
    },
    async get(orgId, id) {
      const out = await table.doc.send(
        new GetCommand({ TableName: table.name, Key: { PK: `SESSION#${id}`, SK: 'META' }, ConsistentRead: true }),
      );
      if (!out.Item || out.Item['orgId'] !== orgId) return null;
      return fromItem<SessionRecord>(out.Item);
    },
    async listByOrg(orgId, { status }) {
      const rows = await queryAll<Record<string, unknown>>(table, {
        IndexName: GSI1,
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `ORG#${orgId}`, ':prefix': 'SESSION#' },
        ScanIndexForward: false,
      });
      return rows.map((r) => fromItem<SessionRecord>(r)).filter((s) => !status || s.status === status);
    },
    async update(next, expectedVersion) {
      const stored: SessionRecord = { ...next, version: expectedVersion + 1 };
      try {
        await table.doc.send(
          new PutCommand({
            TableName: table.name,
            Item: item(stored),
            ConditionExpression: 'attribute_exists(PK) AND #v = :expected AND orgId = :org',
            ExpressionAttributeNames: { '#v': 'version' },
            ExpressionAttributeValues: { ':expected': expectedVersion, ':org': next.orgId },
          }),
        );
      } catch (e) {
        if (e instanceof ConditionalCheckFailedException) throw new StaleWriteError();
        throw e;
      }
      return stored;
    },
  };
}
