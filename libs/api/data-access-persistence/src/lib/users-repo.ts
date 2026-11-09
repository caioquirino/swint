import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { UserRecord } from './records.js';
import { fromItem, type Table } from './table.js';

export interface UsersRepo {
  upsert(user: UserRecord): Promise<void>;
  get(sub: string): Promise<UserRecord | null>;
}

const key = (sub: string) => ({ PK: `USER#${sub}`, SK: 'PROFILE' });

export function createUsersRepo(table: Table): UsersRepo {
  return {
    async upsert(user) {
      await table.doc.send(new PutCommand({ TableName: table.name, Item: { ...key(user.sub), ...user } }));
    },
    async get(sub) {
      const out = await table.doc.send(new GetCommand({ TableName: table.name, Key: key(sub), ConsistentRead: true }));
      return out.Item ? fromItem<UserRecord>(out.Item) : null;
    },
  };
}
