import type { FastifyInstance } from 'fastify';
import type { DestinationStream } from 'pino';
import {
  createAuthSessionsRepo,
  createBlobStore,
  createDynamo,
  createInvitesRepo,
  createS3,
  createSessionsRepo,
  createTemplatesRepo,
  createUsersRepo,
  ensureBucket,
  ensureTable,
  type AuthSessionsRepo,
  type BlobStore,
  type InvitesRepo,
  type SessionsRepo,
  type TemplatesRepo,
  type UsersRepo,
} from '@swint/api-data-access-persistence';
import {
  createCookieIdentityResolver,
  createIdentityResolver,
  createOidcClient,
  registerAuthRoutes,
  registerJoinRoute,
  type CookieHeaderIdentityResolver,
  type OidcClient,
} from '@swint/api-feature-auth';
import { noopSessionEvents, type SessionEvents } from '@swint/api-feature-sessions';
import { randomToken, systemClock, ulidIds } from '@swint/api-util-rpc';
import type { AppConfig } from './config.js';
import { buildRouter } from './router.js';
import { buildServer } from './server.js';

export interface AppRepos {
  users: UsersRepo;
  authSessions: AuthSessionsRepo;
  templates: TemplatesRepo;
  sessions: SessionsRepo;
  invites: InvitesRepo;
  blobs: BlobStore;
}

export interface App {
  server: FastifyInstance;
  repos: AppRepos;
  /** Resolves an identity from a raw Cookie header (e.g. a WebSocket upgrade request). */
  resolveIdentityFromCookieHeader: CookieHeaderIdentityResolver;
  close(): Promise<void>;
}

export async function createApp(
  config: AppConfig,
  overrides: { oidc?: OidcClient; events?: SessionEvents; logStream?: DestinationStream } = {},
): Promise<App> {
  const aws = {
    region: config.awsRegion,
    dynamoEndpoint: config.dynamoEndpoint,
    s3Endpoint: config.s3Endpoint,
    credentials: config.awsCredentials,
  };
  const { raw, doc } = createDynamo(aws);
  const s3 = createS3(aws);
  if (config.ensureInfra) {
    await ensureTable(raw, config.tableName);
    await ensureBucket(s3, config.bucketName);
  }
  const table = { doc, name: config.tableName };
  const repos: AppRepos = {
    users: createUsersRepo(table),
    authSessions: createAuthSessionsRepo(table),
    templates: createTemplatesRepo(table),
    sessions: createSessionsRepo(table),
    invites: createInvitesRepo(table),
    blobs: createBlobStore(s3, config.bucketName),
  };
  const clock = systemClock;
  const secureCookies = config.nodeEnv === 'production';
  const oidc =
    overrides.oidc ??
    createOidcClient({
      issuer: config.oidcIssuer,
      clientId: config.oidcClientId,
      clientSecret: config.oidcClientSecret,
      redirectUri: `${config.publicBaseUrl}/auth/callback`,
      postLogoutRedirectUri: `${config.publicBaseUrl}/`,
      allowInsecureHttp: config.oidcIssuer.startsWith('http://'),
    });

  const router = buildRouter({
    ...repos,
    clock,
    newId: ulidIds,
    newToken: randomToken,
    publicBaseUrl: config.publicBaseUrl,
    events: overrides.events ?? noopSessionEvents,
  });

  const server = await buildServer({
    config,
    router,
    resolveIdentity: createIdentityResolver({ ...repos, clock }),
    ...(overrides.logStream ? { logStream: overrides.logStream } : {}),
    registerRoutes: (app) => {
      registerAuthRoutes(app, {
        oidc,
        users: repos.users,
        authSessions: repos.authSessions,
        clock,
        publicBaseUrl: config.publicBaseUrl,
        secureCookies,
        defaultOrgId: config.defaultOrgId,
      });
      registerJoinRoute(app, { invites: repos.invites, sessions: repos.sessions, clock, secureCookies });
    },
  });
  await server.ready();

  return {
    server,
    repos,
    resolveIdentityFromCookieHeader: createCookieIdentityResolver({ ...repos, clock, cookieSecret: config.cookieSecret }),
    close: async () => {
      await server.close();
      raw.destroy();
      s3.destroy();
    },
  };
}
