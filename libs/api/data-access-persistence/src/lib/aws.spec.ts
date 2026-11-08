import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
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

  it('ensureTable tolerates concurrent callers', async () => {
    const { raw } = await createTestStores();
    const name = `swint-race-${randomUUID().slice(0, 8)}`;
    await expect(Promise.all([ensureTable(raw, name), ensureTable(raw, name)])).resolves.toBeDefined();
    await expect(raw.send(new DescribeTableCommand({ TableName: name }))).resolves.toBeDefined();
  });

  it('ensureBucket tolerates concurrent callers', async () => {
    const { s3 } = await createTestStores();
    const bucket = `swint-race-${randomUUID().slice(0, 8)}`;
    await expect(Promise.all([ensureBucket(s3, bucket), ensureBucket(s3, bucket)])).resolves.toBeDefined();
    await expect(s3.send(new HeadBucketCommand({ Bucket: bucket }))).resolves.toBeDefined();
  });

  it('ensureBucket rethrows non-404 HeadBucket errors without attempting CreateBucket', async () => {
    const s3 = new S3Client({
      region: 'us-east-1',
      endpoint: 'http://127.0.0.1:1',
      forcePathStyle: true,
      maxAttempts: 1,
      credentials: { accessKeyId: 'x', secretAccessKey: 'x' },
    });
    const sent: string[] = [];
    const origSend = s3.send.bind(s3) as (cmd: { constructor: { name: string } }) => Promise<unknown>;
    (s3 as unknown as { send: unknown }).send = (cmd: { constructor: { name: string } }) => {
      sent.push(cmd.constructor.name);
      return origSend(cmd);
    };
    const err = await ensureBucket(s3, 'nope').catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).not.toMatch(/BucketAlready/);
    expect(sent).toEqual(['HeadBucketCommand']);
  });
});
