import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { InviteRecord } from './records.js';
import { stripKeys, type Table } from './table.js';

export interface InvitesRepo {
  create(rec: InviteRecord): Promise<void>;
  get(hash: string): Promise<InviteRecord | null>;
  revoke(hash: string, atMs: number): Promise<void>;
}

const key = (hash: string) => ({ PK: `INVITE#${hash}`, SK: 'META' });

export function createInvitesRepo(table: Table): InvitesRepo {
  return {
    async create(rec) {
      await table.doc.send(
        new PutCommand({
          TableName: table.name,
          Item: { ...key(rec.hash), ...rec },
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
    },
    async get(hash) {
      const out = await table.doc.send(new GetCommand({ TableName: table.name, Key: key(hash) }));
      return out.Item ? (stripKeys(out.Item) as unknown as InviteRecord) : null;
    },
    async revoke(hash, atMs) {
      try {
        await table.doc.send(
          new UpdateCommand({
            TableName: table.name,
            Key: key(hash),
            UpdateExpression: 'SET revokedAt = :at',
            ConditionExpression: 'attribute_exists(PK) AND revokedAt = :null',
            ExpressionAttributeValues: { ':at': atMs, ':null': null },
          }),
        );
      } catch (e) {
        if (e instanceof ConditionalCheckFailedException) return; // missing or already revoked
        throw e;
      }
    },
  };
}
