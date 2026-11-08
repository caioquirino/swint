import { describe, expect, it } from 'vitest';
import { DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { createTestStores } from '../testing/index.js';
import { ensureBucket, ensureTable } from './aws.js';

describe('ensureTable / ensureBucket', () => {
  it('creates the table with PK/SK and GSI1, and is idempotent', async () => {
    const stores = await createTestStores();
    await ensureTable(stores.raw, stores.table.name); // second call: no throw
    const { Table } = await stores.raw.send(new DescribeTableCommand({ TableName: stores.table.name }));
    expect(Table?.KeySchema).toEqual([
      { AttributeName: 'PK', KeyType: 'HASH' },
      { AttributeName: 'SK', KeyType: 'RANGE' },
    ]);
    expect(Table?.GlobalSecondaryIndexes?.[0]).toMatchObject({
      IndexName: 'GSI1',
      KeySchema: [
        { AttributeName: 'GSI1PK', KeyType: 'HASH' },
        { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
      ],
    });
  });

  it('creates the bucket and is idempotent', async () => {
    const stores = await createTestStores();
    await ensureBucket(stores.s3, stores.bucket);
    await expect(stores.s3.send(new HeadBucketCommand({ Bucket: stores.bucket }))).resolves.toBeDefined();
  });
});
