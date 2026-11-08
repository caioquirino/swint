import { randomUUID } from 'node:crypto';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { inject } from 'vitest';
import { createDynamo, createS3, ensureBucket, ensureTable, type AwsConfig } from '../lib/aws.js';
import { createBlobStore, type BlobStore } from '../lib/blob-store.js';
import { createUsersRepo, type UsersRepo } from '../lib/users-repo.js';
import { createAuthSessionsRepo, type AuthSessionsRepo } from '../lib/auth-sessions-repo.js';
import { createTemplatesRepo, type TemplatesRepo } from '../lib/templates-repo.js';
import { createSessionsRepo, type SessionsRepo } from '../lib/sessions-repo.js';
import { createInvitesRepo, type InvitesRepo } from '../lib/invites-repo.js';
import type { Table } from '../lib/table.js';
import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { S3Client } from '@aws-sdk/client-s3';

declare module 'vitest' {
  export interface ProvidedContext {
    dynamoEndpoint: string;
    s3Endpoint: string;
  }
}

export async function startTestInfra(): Promise<{ dynamoEndpoint: string; s3Endpoint: string; stop(): Promise<void> }> {
  const [dynamo, s3]: StartedTestContainer[] = await Promise.all([
    new GenericContainer('amazon/dynamodb-local:3.3.2')
      .withCommand(['-jar', 'DynamoDBLocal.jar', '-inMemory', '-sharedDb'])
      .withExposedPorts(8000)
      .withWaitStrategy(Wait.forListeningPorts())
      .start(),
    new GenericContainer('adobe/s3mock:5.2.3').withExposedPorts(9090).withWaitStrategy(Wait.forListeningPorts()).start(),
  ]);
  return {
    dynamoEndpoint: `http://${dynamo.getHost()}:${dynamo.getMappedPort(8000)}`,
    s3Endpoint: `http://${s3.getHost()}:${s3.getMappedPort(9090)}`,
    stop: async () => {
      await Promise.all([dynamo.stop(), s3.stop()]);
    },
  };
}

export function testAwsConfig(endpoints: { dynamoEndpoint: string; s3Endpoint: string }): AwsConfig {
  return {
    region: 'us-east-1',
    dynamoEndpoint: endpoints.dynamoEndpoint,
    s3Endpoint: endpoints.s3Endpoint,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  };
}

export interface TestStores {
  cfg: AwsConfig;
  raw: DynamoDBClient;
  table: Table;
  s3: S3Client;
  bucket: string;
  blobs: BlobStore;
  users: UsersRepo;
  authSessions: AuthSessionsRepo;
  templates: TemplatesRepo;
  sessions: SessionsRepo;
  invites: InvitesRepo;
}

/** Fresh, isolated table + bucket per call (unique names). Requires the globalSetup below. */
export async function createTestStores(): Promise<TestStores> {
  const cfg = testAwsConfig({ dynamoEndpoint: inject('dynamoEndpoint'), s3Endpoint: inject('s3Endpoint') });
  const suffix = randomUUID().slice(0, 8);
  const { raw, doc } = createDynamo(cfg);
  const s3 = createS3(cfg);
  const tableName = `swint-test-${suffix}`;
  const bucket = `swint-test-${suffix}`;
  await ensureTable(raw, tableName);
  await ensureBucket(s3, bucket);
  const table: Table = { doc, name: tableName };
  return {
    cfg,
    raw,
    table,
    s3,
    bucket,
    blobs: createBlobStore(s3, bucket),
    users: createUsersRepo(table),
    authSessions: createAuthSessionsRepo(table),
    templates: createTemplatesRepo(table),
    sessions: createSessionsRepo(table),
    invites: createInvitesRepo(table),
  };
}
