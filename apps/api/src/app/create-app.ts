import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
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
import { createCollabServer, type CollabLogger, type CollabServer } from '@swint/api-collab-server';
import type { SessionEvents } from '@swint/api-feature-sessions';
import { randomToken, systemClock, ulidIds } from '@swint/api-util-rpc';
import type { AppConfig } from './config.js';
import { seedDevData } from './dev-seed.js';
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
  /** Real-time collaboration server, attached to `server` at `/collab`. */
  collab: CollabServer;
  /** Flushes collab documents to S3, then closes HTTP, then the AWS clients. */
  close(): Promise<void>;
}

/** A `SessionEvents` that never rejects: calls each defined implementation in order, logging failures. */
export function composeEvents(logger: Pick<FastifyBaseLogger, 'error'>, ...list: (SessionEvents | undefined)[]): SessionEvents {
  const impls = list.filter((e): e is SessionEvents => e !== undefined);
  return {
    async sessionChanged(rec) {
      for (const impl of impls) {
        try {
          await impl.sessionChanged(rec);
        } catch (err) {
          logger.error({ err, sessionId: rec.id }, 'session event handler failed');
        }
      }
    },
  };
}

/** Adapts a pino/Fastify logger to the collab server's logger interface. */
function collabLogger(log: FastifyBaseLogger): CollabLogger {
  return {
    debug: (o, m) => log.debug(o, m),
    info: (o, m) => log.info(o, m),
    warn: (o, m) => log.warn(o, m),
    error: (o, m) => log.error(o, m),
  };
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
  let devSeedResult: 'created' | 'exists' | undefined;
  if (config.seedDevData) {
    devSeedResult = await seedDevData({
      templates: repos.templates,
      blobs: repos.blobs,
      clock,
      newId: ulidIds,
      orgId: config.defaultOrgId,
    });
  }
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

  // The collab server needs the Fastify logger, which only exists after buildServer; the router gets a
  // forwarding SessionEvents whose target is set as soon as collab exists (before the server is ready).
  const eventsTarget: { current?: SessionEvents } = {};
  const forwardingEvents: SessionEvents = {
    sessionChanged: async (rec) => {
      await eventsTarget.current?.sessionChanged(rec);
    },
  };
  const resolveIdentityFromCookieHeader = createCookieIdentityResolver({ ...repos, clock, cookieSecret: config.cookieSecret });

  const router = buildRouter({
    ...repos,
    clock,
    newId: ulidIds,
    newToken: randomToken,
    publicBaseUrl: config.publicBaseUrl,
    events: forwardingEvents,
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
  const collab = createCollabServer({
    sessions: repos.sessions,
    blobs: repos.blobs,
    resolveIdentity: resolveIdentityFromCookieHeader,
    clock,
    logger: collabLogger(server.log.child({ component: 'collab' })),
  });
  eventsTarget.current = composeEvents(server.log, collab.events, overrides.events);
  // The upgrade listener must exist before listen().
  collab.attach(server.server);
  if (devSeedResult) server.log.info({ result: devSeedResult }, 'dev seed');
  await server.ready();

  return {
    server,
    repos,
    resolveIdentityFromCookieHeader,
    collab,
    close: async () => {
      // Flush collab documents while S3 is still reachable (bounded by collab's own shutdown deadline).
      // HTTP and the AWS clients are closed even if an earlier step fails.
      try {
        await collab.close();
      } finally {
        try {
          await server.close();
        } finally {
          raw.destroy();
          s3.destroy();
        }
      }
    },
  };
}
