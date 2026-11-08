import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { StaleWriteError } from './errors.js';
import type { TemplateRecord } from './records.js';
import { GSI1, queryAll, stripKeys, type Table } from './table.js';

export interface TemplatesRepo {
  create(rec: TemplateRecord): Promise<void>;
  get(orgId: string, id: string): Promise<TemplateRecord | null>;
  listByOrg(orgId: string, opts: { includeArchived: boolean }): Promise<TemplateRecord[]>;
  update(rec: TemplateRecord): Promise<void>;
}

const item = (rec: TemplateRecord) => ({
  PK: `TEMPLATE#${rec.id}`,
  SK: 'META',
  GSI1PK: `ORG#${rec.orgId}`,
  GSI1SK: `TEMPLATE#${rec.title.toLowerCase()}#${rec.id}`,
  ...rec,
});

export function createTemplatesRepo(table: Table): TemplatesRepo {
  return {
    async create(rec) {
      await table.doc.send(
        new PutCommand({ TableName: table.name, Item: item(rec), ConditionExpression: 'attribute_not_exists(PK)' }),
      );
    },
    async get(orgId, id) {
      const out = await table.doc.send(
        new GetCommand({ TableName: table.name, Key: { PK: `TEMPLATE#${id}`, SK: 'META' } }),
      );
      if (!out.Item || out.Item['orgId'] !== orgId) return null;
      return stripKeys(out.Item) as TemplateRecord;
    },
    async listByOrg(orgId, { includeArchived }) {
      const rows = await queryAll<Record<string, unknown>>(table, {
        IndexName: GSI1,
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `ORG#${orgId}`, ':prefix': 'TEMPLATE#' },
      });
      return rows.map((r) => stripKeys(r) as unknown as TemplateRecord).filter((t) => includeArchived || !t.archived);
    },
    async update(rec) {
      try {
        await table.doc.send(
          new PutCommand({
            TableName: table.name,
            Item: item(rec),
            ConditionExpression: 'attribute_exists(PK) AND orgId = :org',
            ExpressionAttributeValues: { ':org': rec.orgId },
          }),
        );
      } catch (e) {
        if (e instanceof ConditionalCheckFailedException) throw new StaleWriteError('Template not found');
        throw e;
      }
    },
  };
}
