import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { onError, ORPCError } from '@orpc/server';
import { OpenAPIHandler } from '@orpc/openapi/fastify';
import { OpenAPIGenerator } from '@orpc/openapi';
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4';
import { contract } from '@swint/shared-api-contract';
import type { IdentityResolver } from '@swint/api-feature-auth';
import type { AppConfig } from './config.js';
import type { AppRouter } from './router.js';
import { serializeRequest } from './log-redaction.js';

export interface ServerDeps {
  config: AppConfig;
  router: AppRouter;
  resolveIdentity: IdentityResolver;
  /** Registers non-RPC routes (auth, join). */
  registerRoutes: (app: FastifyInstance) => void;
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: deps.config.logLevel,
      redact: ['req.headers.cookie', 'res.headers["set-cookie"]', 'req.headers.authorization'],
      // Never log invite tokens or OIDC authorization codes carried in the URL.
      serializers: { req: serializeRequest },
    },
    genReqId: () => randomUUID(),
  });

  await app.register(cookie, { secret: deps.config.cookieSecret });

  app.get('/healthz', async () => ({ ok: true }));
  deps.registerRoutes(app);

  const openApiDoc = await new OpenAPIGenerator({ schemaConverters: [new ZodToJsonSchemaConverter()] }).generate(
    contract,
    { info: { title: 'Swint API', version: '0.1.0' }, servers: [{ url: '/api' }] },
  );

  const handler = new OpenAPIHandler(deps.router, {
    interceptors: [
      onError((error) => {
        // Expected 4xx ORPCErrors (auth, validation, not found, conflicts) are not worth logging.
        if (!(error instanceof ORPCError) || error.status >= 500) {
          app.log.error({ err: error }, 'rpc error');
        }
      }),
    ],
  });

  await app.register(async (api) => {
    // oRPC parses bodies itself; disable Fastify parsing inside this scope only.
    api.removeAllContentTypeParsers();
    api.addContentTypeParser('*', (_req, _payload, done) => done(null, undefined));

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
