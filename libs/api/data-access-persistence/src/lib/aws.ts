import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ResourceNotFoundException,
  UpdateTimeToLiveCommand,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';

export interface AwsConfig {
  region: string;
  dynamoEndpoint?: string;
  s3Endpoint?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

export function createDynamo(cfg: AwsConfig): { raw: DynamoDBClient; doc: DynamoDBDocumentClient } {
  const raw = new DynamoDBClient({
    region: cfg.region,
    endpoint: cfg.dynamoEndpoint,
    credentials: cfg.credentials,
  });
  const doc = DynamoDBDocumentClient.from(raw, {
    marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: false },
  });
  return { raw, doc };
}

export function createS3(cfg: AwsConfig): S3Client {
  return new S3Client({
    region: cfg.region,
    endpoint: cfg.s3Endpoint,
    credentials: cfg.credentials,
    forcePathStyle: Boolean(cfg.s3Endpoint),
  });
}

export async function ensureTable(raw: DynamoDBClient, tableName: string): Promise<void> {
  try {
    await raw.send(new DescribeTableCommand({ TableName: tableName }));
    return;
  } catch (e) {
    if (!(e instanceof ResourceNotFoundException)) throw e;
  }
  await raw.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
        { AttributeName: 'GSI1PK', AttributeType: 'S' },
        { AttributeName: 'GSI1SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'GSI1',
          KeySchema: [
            { AttributeName: 'GSI1PK', KeyType: 'HASH' },
            { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    }),
  );
  await waitUntilTableExists({ client: raw, maxWaitTime: 30 }, { TableName: tableName });
  await raw.send(
    new UpdateTimeToLiveCommand({
      TableName: tableName,
      TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
    }),
  );
}

export async function ensureBucket(s3: S3Client, bucket: string): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    return;
  } catch {
    // fall through and create
  }
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));
}
