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
  const prod = {
    NODE_ENV: 'production',
    COOKIE_SECRET: 'p'.repeat(40),
    OIDC_CLIENT_SECRET: 'prod-secret',
    OIDC_ISSUER: 'https://id.example.com/realms/swint',
    PUBLIC_BASE_URL: 'https://swint.example.com',
  } as const;
  it('rejects production without an explicit cookie secret', () => {
    expect(() => loadConfig({ ...prod, COOKIE_SECRET: undefined })).toThrow(/COOKIE_SECRET/);
  });
  it('rejects production with the dev cookie secret set explicitly', () => {
    expect(() => loadConfig({ ...prod, COOKIE_SECRET: 'dev-only-cookie-secret-change-me-0123456789' })).toThrow(
      /COOKIE_SECRET/,
    );
  });
  it('rejects production without OIDC_CLIENT_SECRET', () => {
    expect(() => loadConfig({ ...prod, OIDC_CLIENT_SECRET: undefined })).toThrow(/OIDC_CLIENT_SECRET/);
  });
  it('rejects production without PUBLIC_BASE_URL', () => {
    expect(() => loadConfig({ ...prod, PUBLIC_BASE_URL: undefined })).toThrow(/PUBLIC_BASE_URL/);
  });
  it('rejects production without OIDC_ISSUER', () => {
    expect(() => loadConfig({ ...prod, OIDC_ISSUER: undefined })).toThrow(/OIDC_ISSUER/);
  });
  it('rejects a short cookie secret', () => {
    expect(() => loadConfig({ COOKIE_SECRET: 'short' })).toThrow(/COOKIE_SECRET/);
  });
  it('production does not default endpoints or ensureInfra', () => {
    const cfg = loadConfig(prod);
    expect(cfg.dynamoEndpoint).toBeUndefined();
    expect(cfg.s3Endpoint).toBeUndefined();
    expect(cfg.ensureInfra).toBe(false);
    expect(cfg.publicBaseUrl).toBe('https://swint.example.com');
    expect(cfg.oidcIssuer).toBe('https://id.example.com/realms/swint');
  });
  it('seeds dev data by default only in development', () => {
    expect(loadConfig({ NODE_ENV: 'development' }).seedDevData).toBe(true);
    expect(loadConfig({ NODE_ENV: 'test' }).seedDevData).toBe(false);
    expect(loadConfig({ NODE_ENV: 'development', SEED_DEV_DATA: 'false' }).seedDevData).toBe(false);
    expect(loadConfig({ NODE_ENV: 'test', SEED_DEV_DATA: 'true' }).seedDevData).toBe(true);
  });
});
