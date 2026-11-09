import { describe, expect, it, vi } from 'vitest';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { createTestStores } from '../testing/index.js';
import { fromItem, queryAll } from './table.js';

describe('table helpers', () => {
  it('fromItem strips the key attributes', () => {
    expect(fromItem<{ id: string }>({ PK: 'a', SK: 'b', GSI1PK: 'c', GSI1SK: 'd', id: 'x' })).toEqual({ id: 'x' });
  });

  it('queryAll follows LastEvaluatedKey across pages', async () => {
    const { table } = await createTestStores();
    for (let i = 0; i < 5; i++) {
      await table.doc.send(new PutCommand({ TableName: table.name, Item: { PK: 'P#1', SK: `S#${i}` } }));
    }
    const send = vi.spyOn(table.doc, 'send');
    const items = await queryAll<{ SK: string }>(table, {
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': 'P#1' },
      Limit: 2,
    });
    expect(items.map((i) => i.SK)).toEqual(['S#0', 'S#1', 'S#2', 'S#3', 'S#4']);
    expect(send).toHaveBeenCalledTimes(3);
  });
});
