// Test-only helpers for apps/api integration specs. Excluded from tsconfig.app.json (never built).
import { inject } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import '@swint/api-data-access-persistence/testing'; // ProvidedContext typings for inject()
import { sha256Hex } from '@swint/api-util-rpc';
import type { OidcClient } from '@swint/api-feature-auth';
import { COOKIE } from '@swint/api-feature-auth';
import { createApp, type App } from '../app/create-app.js';
import { loadConfig, type AppConfig } from '../app/config.js';

export const fakeOidc: OidcClient = {
  createAuthorization: async () => ({ url: new URL('http://idp.test/auth'), state: 's', verifier: 'v' }),
  exchange: async () => {
    throw new Error('not used');
  },
  endSessionUrl: async () => new URL('http://idp.test/logout'),
};

export const templateBody = {
  title: 'URL shortener',
  instructionsMd: '# Go',
  rubricMd: '- scaling',
  durationMin: 45,
  boardSeed: null,
};

export interface TestApp {
  server: App['server'];
  repos: App['repos'];
  config: AppConfig;
  /** Listening port when `listen: true`, otherwise 0. */
  port: number;
  interviewerCookie(sub?: string, orgId?: string, roles?: string[]): Promise<Record<string, string>>;
  resolveIdentityFromCookieHeader: App['resolveIdentityFromCookieHeader'];
  collab: App['collab'];
  close(): Promise<void>;
}

export async function setup(opts: { logLines?: string[]; listen?: boolean } = {}): Promise<TestApp> {
  const suffix = randomUUID().slice(0, 8);
  const config = loadConfig({
    NODE_ENV: 'test',
    DYNAMODB_ENDPOINT: inject('dynamoEndpoint'),
    S3_ENDPOINT: inject('s3Endpoint'),
    TABLE_NAME: `swint-it-${suffix}`,
    BUCKET_NAME: `swint-it-${suffix}`,
    LOG_LEVEL: opts.logLines ? 'trace' : 'silent',
  });
  const logLines = opts.logLines;
  const app = await createApp(config, {
    oidc: fakeOidc,
    ...(logLines ? { logStream: { write: (line: string) => void logLines.push(line) } } : {}),
  });
  const server = app.server;
  const repos = app.repos; // exposed for tests (see create-app)

  let port = 0;
  if (opts.listen) {
    await server.listen({ port: 0, host: '127.0.0.1' });
    port = (server.server.address() as AddressInfo).port;
  }

  async function interviewerCookie(sub = 'sub-1', orgId = 'default', roles = ['interviewer']) {
    const sid = `sid-${sub}-${orgId}`;
    await repos.authSessions.create({
      idHash: sha256Hex(sid),
      userSub: sub,
      orgId,
      name: `User ${sub}`,
      email: null,
      roles,
      idToken: 'jwt',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    return { [COOKIE.session]: server.signCookie(sid) };
  }

  return {
    server,
    repos,
    config,
    port,
    interviewerCookie,
    resolveIdentityFromCookieHeader: app.resolveIdentityFromCookieHeader,
    collab: app.collab,
    close: app.close,
  };
}
