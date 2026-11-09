import { randomUUID } from 'node:crypto';
import { STATUS_CODES } from 'node:http';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { DestinationStream } from 'pino';
import cookie from '@fastify/cookie';
import { onError, ORPCError } from '@orpc/server';
import { OpenAPIHandler } from '@orpc/openapi/fastify';
import { OpenAPIGenerator } from '@orpc/openapi';
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4';
import { contract } from '@swint/shared-api-contract';
import type { IdentityResolver } from '@swint/api-feature-auth';
import type { AppConfig } from './config.js';
import type { AppRouter } from './router.js';
import { redactUrl, serializeRequest } from './log-redaction.js';

export interface ServerDeps {
  config: AppConfig;
  router: AppRouter;
  resolveIdentity: IdentityResolver;
  /** Registers non-RPC routes (auth, join). */
  registerRoutes: (app: FastifyInstance) => void;
  /** Log destination (defaults to stdout); tests use it to capture log lines. */
  logStream?: DestinationStream;
}

/** Upper bound for any request body; enforced by Fastify before identity resolution runs. */
export const BODY_LIMIT_BYTES = 2 * 1024 * 1024;

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: deps.config.logLevel,
      redact: ['req.headers.cookie', 'res.headers["set-cookie"]', 'req.headers.authorization'],
      // Never log invite tokens or OIDC authorization codes carried in the URL.
      serializers: { req: serializeRequest },
      ...(deps.logStream ? { stream: deps.logStream } : {}),
    },
    genReqId: () => randomUUID(),
    bodyLimit: BODY_LIMIT_BYTES,
  });

  // Never echo error internals to clients: 5xx become a generic body, 4xx (validation, 413, 415, …)
  // keep their status with the standard reason phrase.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode !== undefined && error.statusCode >= 400 ? error.statusCode : 500;
    if (status >= 500) {
      request.log.error({ err: error }, 'request failed');
      return reply.code(500).send({ code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' });
    }
    // Code only: e.g. JSON parse messages can quote the request body.
    request.log.info({ code: error.code, statusCode: status }, 'request rejected');
    const reason = STATUS_CODES[status] ?? 'Bad Request';
    return reply.code(status).send({ code: reason.toUpperCase().replace(/\W+/g, '_'), message: reason });
  });

  // Replaces Fastify's default 404, whose body and log line echo the raw URL (invite tokens).
  app.setNotFoundHandler((request, reply) => {
    request.log.info({ method: request.method, url: redactUrl(request.url) }, 'route not found');
    return reply.code(404).send({ code: 'NOT_FOUND', message: 'Not found' });
  });

  await app.register(cookie, { secret: deps.config.cookieSecret });

  app.get('/healthz', async () => ({ ok: true }));
  deps.registerRoutes(app);

  const openApiDoc = await new OpenAPIGenerator({ schemaConverters: [new ZodToJsonSchemaConverter()] }).generate(contract, {
    info: { title: 'Swint API', version: '0.1.0' },
    servers: [{ url: '/api' }],
  });

  const handler = new OpenAPIHandler(deps.router, {
    interceptors: [
      onError((error, { context }) => {
        // Expected 4xx ORPCErrors (auth, validation, not found, conflicts) are not worth logging.
        if (!(error instanceof ORPCError) || error.status >= 500) {
          app.log.error({ err: error, requestId: context.requestId }, 'rpc error');
        }
      }),
    ],
  });

  await app.register(async (api) => {
    // Fastify parses (and size-limits) JSON bodies; the oRPC adapter uses `request.body` when
    // it is defined instead of reading the raw stream. Every other body type is rejected with 415
    // rather than streamed into oRPC unbounded.
    api.removeContentTypeParser('text/plain');

    api.get('/api/openapi.json', async () => openApiDoc);

    api.all('/api/*', async (request, reply) => {
      const { matched } = await handler.handle(request, reply, {
        prefix: '/api',
        context: { identity: await deps.resolveIdentity(request), requestId: String(request.id) },
      });
      if (!matched) reply.code(404).send({ code: 'NOT_FOUND', message: 'Not found' });
    });
  });

  return app;
}
