import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('applies dev defaults', () => {
    const cfg = loadConfig({});
    expect(cfg).toMatchObject({
      nodeEnv: 'development',
      port: 3000,
      publicBaseUrl: 'http://localhost:4200',
      tableName: 'swint',
      bucketName: 'swint',
      defaultOrgId: 'default',
      ensureInfra: true,
      dynamoEndpoint: 'http://localhost:8000',
    });
  });
  it('rejects production with the dev cookie secret', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', OIDC_CLIENT_SECRET: 'x' })).toThrow(/COOKIE_SECRET/);
  });
  it('rejects a short cookie secret', () => {
    expect(() => loadConfig({ COOKIE_SECRET: 'short' })).toThrow(/COOKIE_SECRET/);
  });
  it('production does not default endpoints or ensureInfra', () => {
    const cfg = loadConfig({
      NODE_ENV: 'production',
      COOKIE_SECRET: 'p'.repeat(40),
      OIDC_CLIENT_SECRET: 'prod-secret',
      OIDC_ISSUER: 'https://id.example.com/realms/swint',
      PUBLIC_BASE_URL: 'https://swint.example.com',
    });
    expect(cfg.dynamoEndpoint).toBeUndefined();
    expect(cfg.s3Endpoint).toBeUndefined();
    expect(cfg.ensureInfra).toBe(false);
  });
});
