import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ResourceInUseException,
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

export function createDynamo(cfg: AwsConfig): {
  raw: DynamoDBClient;
  doc: DynamoDBDocumentClient;
} {
  const raw = new DynamoDBClient({
    region: cfg.region,
    endpoint: cfg.dynamoEndpoint,
    credentials: cfg.credentials,
  });
  const doc = DynamoDBDocumentClient.from(raw, {
    marshallOptions: {
      removeUndefinedValues: true,
      convertClassInstanceToMap: false,
    },
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
  let created = false;
  try {
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
    created = true;
  } catch (e) {
    if (!(e instanceof ResourceInUseException || (e as { name?: string }).name === 'ResourceInUseException')) throw e;
  }
  await waitUntilTableExists({ client: raw, maxWaitTime: 30 }, { TableName: tableName });
  if (!created) return;
  try {
    await raw.send(
      new UpdateTimeToLiveCommand({
        TableName: tableName,
        TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
      }),
    );
  } catch (e) {
    // TTL may already be enabled/being enabled
    if ((e as { name?: string }).name !== 'ValidationException') throw e;
  }
}

export async function ensureBucket(s3: S3Client, bucket: string): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    return;
  } catch (e) {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (err.$metadata?.httpStatusCode !== 404 && err.name !== 'NotFound') throw e;
  }
  try {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') throw e;
  }
}
