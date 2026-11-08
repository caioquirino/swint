import { z } from 'zod';

const DEV_COOKIE_SECRET = 'dev-only-cookie-secret-change-me-0123456789';

const raw = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  PUBLIC_BASE_URL: z.url().optional(),
  OIDC_ISSUER: z.url().optional(),
  OIDC_CLIENT_ID: z.string().default('swint-api'),
  OIDC_CLIENT_SECRET: z.string().min(1).optional(),
  COOKIE_SECRET: z.string().optional(),
  AWS_REGION: z.string().default('us-east-1'),
  DYNAMODB_ENDPOINT: z.url().optional(),
  S3_ENDPOINT: z.url().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  TABLE_NAME: z.string().default('swint'),
  BUCKET_NAME: z.string().default('swint'),
  DEFAULT_ORG_ID: z.string().default('default'),
  ENSURE_INFRA: z.stringbool().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export const configSchema = raw.transform((env, ctx) => {
  const prod = env.NODE_ENV === 'production';
  const cookieSecret = env.COOKIE_SECRET ?? (prod ? undefined : DEV_COOKIE_SECRET);
  if (!cookieSecret || cookieSecret.length < 32 || (prod && cookieSecret === DEV_COOKIE_SECRET)) {
    ctx.addIssue({ code: 'custom', path: ['COOKIE_SECRET'], message: 'COOKIE_SECRET must be at least 32 characters (and set explicitly in production)' });
    return z.NEVER;
  }
  const oidcClientSecret = env.OIDC_CLIENT_SECRET ?? (prod ? undefined : 'swint-dev-secret');
  if (!oidcClientSecret) {
    ctx.addIssue({ code: 'custom', path: ['OIDC_CLIENT_SECRET'], message: 'OIDC_CLIENT_SECRET is required in production' });
    return z.NEVER;
  }
  const dynamoEndpoint = env.DYNAMODB_ENDPOINT ?? (prod ? undefined : 'http://localhost:8000');
  const s3Endpoint = env.S3_ENDPOINT ?? (prod ? undefined : 'http://localhost:9090');
  const awsCredentials =
    env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
      ? { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY }
      : dynamoEndpoint || s3Endpoint
        ? { accessKeyId: 'test', secretAccessKey: 'test' }
        : undefined;
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    host: env.HOST,
    publicBaseUrl: (env.PUBLIC_BASE_URL ?? 'http://localhost:4200').replace(/\/$/, ''),
    oidcIssuer: env.OIDC_ISSUER ?? 'http://localhost:8080/realms/swint',
    oidcClientId: env.OIDC_CLIENT_ID,
    oidcClientSecret,
    cookieSecret,
    awsRegion: env.AWS_REGION,
    dynamoEndpoint,
    s3Endpoint,
    awsCredentials,
    tableName: env.TABLE_NAME,
    bucketName: env.BUCKET_NAME,
    defaultOrgId: env.DEFAULT_ORG_ID,
    ensureInfra: env.ENSURE_INFRA ?? !prod,
    logLevel: env.LOG_LEVEL,
  };
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
