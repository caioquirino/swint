import { afterEach, describe, expect, it, vi } from 'vitest';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { fakeOidc } from '../test/app-test-setup.js';
import { loadConfig } from './config.js';
import { createApp } from './create-app.js';

afterEach(() => vi.restoreAllMocks());

describe('createApp startup failure', () => {
  it('destroys the AWS clients when startup throws', async () => {
    const dynamoDestroy = vi.spyOn(DynamoDBClient.prototype, 'destroy');
    const s3Destroy = vi.spyOn(S3Client.prototype, 'destroy');
    const config = loadConfig({
      NODE_ENV: 'test',
      DYNAMODB_ENDPOINT: 'http://127.0.0.1:1',
      S3_ENDPOINT: 'http://127.0.0.1:1',
      ENSURE_INFRA: 'true',
      LOG_LEVEL: 'silent',
    });
    await expect(createApp(config, { oidc: fakeOidc })).rejects.toThrow();
    expect(dynamoDestroy).toHaveBeenCalledTimes(1);
    expect(s3Destroy).toHaveBeenCalledTimes(1);
  });
});
