# Plan 2 — Backend API (local infrastructure, persistence, auth, templates, sessions)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A runnable `apps/api` that serves the Plan 1 oRPC contract over REST. It covers interviewer login through Keycloak, candidate invite links, templates and sessions with lifecycle commands. Data is stored in DynamoDB + S3, all running locally under Docker Compose and covered by integration tests against real containers.

**Architecture:**
- A single Fastify process.
  - oRPC's `OpenAPIHandler` serves the contract under `/api/*`.
  - Plain Fastify routes handle `/auth/*` (OIDC Authorization Code + PKCE against Keycloak) and `/join/:token` (candidate invite → signed cookie).
- Features are built as factories in `api/feature-*` libraries. They receive their dependencies (repositories, clock, id generator), which keeps them testable with `createRouterClient`.
- Persistence lives in `api/data-access-persistence`:
  - one DynamoDB table with GSI1
  - one S3 bucket
- `apps/api` is the composition root that wires everything together.

**Tech Stack:** Fastify 5, `@fastify/cookie`, `@orpc/server` / `@orpc/openapi` / `@orpc/zod` 1.16, `openid-client` 6, AWS SDK v3 (`client-dynamodb`, `lib-dynamodb`, `client-s3`), `ulid`, pino, Vitest + Testcontainers, Docker Compose (Keycloak 26.8.2, `amazon/dynamodb-local:3.3.2`, `adobe/s3mock:5.2.3`).

**Spec:** `docs/superpowers/specs/2026-11-08-swint-foundation-design.md`. Sections §4 (data model), §5 (auth and links), §6 (lifecycle), §8 (errors and testing) and §10 (local development) bind this plan.

**Depends on (already on `main`):** Plan 1 libraries `@swint/shared-domain`, `@swint/shared-collab-protocol`, `@swint/shared-api-contract`. Read their `src/index.ts` exports before starting a task that uses them.

## Global Constraints

**Carried over from Plan 1**
- Run tasks through Nx: `pnpm nx <target> <project>`. Never guess CLI flags; check `--help` first. Add Nx plugins with `pnpm nx add <plugin>`.
- All relative TypeScript imports use explicit `.js` extensions (`module: nodenext`). Package imports have no extension.
- Nx project names have no `@swint/` prefix. Import paths are `@swint/<project-name>`.
- Never commit anything under `.superpowers/`. Commit after every task. Commit message trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `scope:shared` libraries keep `"types": []`. Node built-ins are allowed only in `scope:api` libraries and `apps/api`.
- Every library declares the packages it imports in its own `package.json` `dependencies` (`@nx/dependency-checks`). Workspace deps use `"workspace:*"`. After adding a workspace dependency, run `pnpm install` and then `pnpm nx sync`.

**Library layout and tags (spec §3.1)**

| Project | Path | Tags |
|---|---|---|
| `api` | `apps/api` | `scope:api` |
| `api-util-rpc` | `libs/api/util-rpc` | `scope:api,type:util` |
| `api-data-access-persistence` | `libs/api/data-access-persistence` | `scope:api,type:data-access` |
| `api-feature-auth` | `libs/api/feature-auth` | `scope:api,type:feature` |
| `api-feature-templates` | `libs/api/feature-templates` | `scope:api,type:feature` |
| `api-feature-sessions` | `libs/api/feature-sessions` | `scope:api,type:feature` |

**Fixed values**
- Ports: API `3000`, Keycloak `8080`, DynamoDB Local `8000`, S3Mock `9090`, web (Plan 4) `4200`.
- DynamoDB table `swint`. Key attributes `PK`, `SK`. Global index `GSI1` with keys `GSI1PK`, `GSI1SK` (projection ALL). TTL attribute `expiresAt`. Billing PAY_PER_REQUEST.
- S3 bucket `swint`. The S3 client uses `forcePathStyle: true` whenever an endpoint override is set.
- Default org id: `default`.
- Keycloak:
  - realm `swint`
  - confidential client `swint-api` with dev secret `swint-dev-secret`
  - realm roles `interviewer`, `admin`
  - users `interviewer1`, `interviewer2` (role `interviewer`) and `admin` (roles `interviewer`, `admin`), all with password `password`
  - realm roles are exposed in the ID token as claim `roles`
- Cookies, all `httpOnly`, `SameSite=Lax`, `path=/`, `secure` only when `NODE_ENV=production`, signed with `COOKIE_SECRET` via `@fastify/cookie`:
  - `swint_sid`: interviewer auth session id, 12 h
  - `swint_cand`: candidate session cookie, JSON `{ sessionId, inviteHash, exp }`, 12 h
  - `swint_oidc`: login state, JSON `{ state, verifier, returnTo }`, 10 min
- Invite tokens and auth-session ids are 32 random bytes encoded as base64url. Only their SHA-256 hex digest is stored.
- Times are epoch **milliseconds** everywhere, **except** DynamoDB's `expiresAt` TTL attribute, which must be epoch **seconds**.
- REST prefix `/api`. OpenAPI document at `GET /api/openapi.json`. Liveness at `GET /healthz` returns `{ "ok": true }`.

**Errors (spec §8)**
- No or invalid identity → `UNAUTHORIZED`.
- Wrong role, or a candidate touching another session → `FORBIDDEN`.
- A candidate's room after the session finished → `FORBIDDEN` with `data: { reason: 'session_ended' }`.
- Missing entity, **including an entity in another org** → `NOT_FOUND`.
- Invalid lifecycle transition or a stale conditional write → `CONFLICT`.

**Must-haves from Plan 1 reviews**
- Every `sessions.*` and `templates.*` procedure, plus `me.get`, is **interviewer-only**. `sessionSchema` carries `rubricMd` and `cancelReason`. An integration test proves a candidate cookie gets 403 on `GET /api/sessions/{id}`.
- Every read checks `orgId`.
- `templateInputSchema.boardSeed: null` on update means "keep the current starting board". There is no way to clear it in v1.
- `cancel` input is already normalised by the contract (a whitespace-only reason becomes `undefined`). Store `null` when it is `undefined`.

**Rulings carried into this plan**
- **S3Mock instead of MinIO.** MinIO no longer publishes images on Docker Hub. S3Mock is S3-compatible; only the image changes.
- **The API creates its table and bucket at startup** when `ENSURE_INFRA=true` (default outside production). This replaces the separate init containers from spec §10.
- **The candidate identity resolver accepts a valid, non-revoked invite whatever the session status.** The candidate-reachable procedure (`room.get`) then rejects finished sessions with reason `session_ended`, so the UI can show "the interview has ended" instead of "invalid link". `/join/:token` still refuses finished sessions (spec §5).
- **Feature routers are factories** taking an explicit deps object. `api-util-rpc` owns `RpcContext`, `Identity`, the `base` implementer and the role middleware.
- **`SessionEvents.sessionChanged(session)` is a hook,** a no-op in this plan. Plan 3 wires it to Hocuspocus broadcasts.

---

## File structure (created by this plan)

```
docker-compose.yml                                  keycloak, dynamodb-local, s3mock
docker/keycloak/swint-realm.json                    realm import
apps/api/
  src/main.ts                                       process entry: config → app → listen → graceful shutdown
  src/app/config.ts                                 zod-validated env
  src/app/config.spec.ts
  src/app/create-app.ts                             composition root (clients, repos, routers, oidc, server)
  src/app/server.ts                                 buildServer(): Fastify + cookie + auth routes + oRPC + openapi + healthz
  src/app/router.ts                                 assembles the full oRPC router
  src/app/api.integration.spec.ts                   HTTP-level integration tests (fastify.inject)
  src/test/global-setup.ts                          re-export of persistence test containers
libs/api/util-rpc/src/
  index.ts
  lib/identity.ts                                   Identity, RpcContext
  lib/rpc.ts                                        base implementer, requireInterviewer, interviewerProcedures
  lib/rpc.spec.ts
  lib/runtime.ts                                    Clock, IdGenerator, systemClock, ulidIds
  lib/tokens.ts                                     randomToken, sha256Hex
  lib/tokens.spec.ts
libs/api/data-access-persistence/src/
  index.ts
  lib/aws.ts                                        AwsConfig, createDynamo, createS3, ensureTable, ensureBucket
  lib/table.ts                                      Table handle + queryAll helper
  lib/blob-store.ts                                 BlobStore (S3 JSON/bytes) + blobKeys
  lib/records.ts                                    record types
  lib/errors.ts                                     StaleWriteError
  lib/users-repo.ts
  lib/auth-sessions-repo.ts
  lib/templates-repo.ts
  lib/sessions-repo.ts
  lib/invites-repo.ts
  lib/*.spec.ts                                     one per repo + blob-store + aws
  testing/index.ts                                  startTestInfra, createTestStores (subpath export ./testing)
  testing/global-setup.ts                           vitest globalSetup (containers)
libs/api/feature-templates/src/
  index.ts
  lib/templates-router.ts
  lib/templates-router.spec.ts
libs/api/feature-sessions/src/
  index.ts
  lib/session-events.ts                             SessionEvents + noopSessionEvents
  lib/mappers.ts                                    record → contract DTOs (session, summary, room views)
  lib/initial-board.ts                              BoardSeed → Yjs update bytes
  lib/initial-board.spec.ts
  lib/sessions-router.ts                            list/get/create/start/extend/end/cancel/regenerateInvite
  lib/sessions-router.spec.ts
  lib/room-router.ts                                room.get
  lib/room-router.spec.ts
libs/api/feature-auth/src/
  index.ts
  lib/cookies.ts                                    names, options, JSON payload helpers
  lib/identity-resolver.ts                          createIdentityResolver(deps)(request)
  lib/identity-resolver.spec.ts
  lib/join-route.ts                                 GET /join/:token
  lib/join-route.spec.ts
  lib/oidc.ts                                       OidcClient interface + openid-client implementation
  lib/auth-routes.ts                                /auth/login, /auth/callback, /auth/logout
  lib/auth-routes.spec.ts                           with a fake OidcClient
  lib/me-router.ts                                  me.get
README.md                                           (modify/create) local dev instructions
```

---

### Task 1: Scaffold the API app and libraries, and install dependencies

**Files:**
- Create (generators): `apps/api`, `libs/api/util-rpc`, `libs/api/data-access-persistence`, `libs/api/feature-auth`, `libs/api/feature-templates`, `libs/api/feature-sessions`
- Modify: `package.json`, `pnpm-lock.yaml`, `nx.json`

**Interfaces:**
- Produces: the six projects in the Global Constraints table, each with `lint`, `test`, `typecheck`. `api` also has `build` and `serve`.

- [ ] **Step 1: Branch**

```bash
git checkout -b feat/backend-api main
```

- [ ] **Step 2: Add the Node plugin and check generator flags**

```bash
pnpm nx add @nx/node
pnpm nx g @nx/node:application --help
pnpm nx g @nx/js:library --help
```

Use the same flag meanings as below. If a flag was renamed, use the new name and note it in your report.

- [ ] **Step 3: Generate the libraries**

```bash
pnpm nx g @nx/js:library --directory=libs/api/util-rpc --name=api-util-rpc --importPath=@swint/api-util-rpc --bundler=tsc --unitTestRunner=vitest --linter=eslint --tags=scope:api,type:util --no-interactive
pnpm nx g @nx/js:library --directory=libs/api/data-access-persistence --name=api-data-access-persistence --importPath=@swint/api-data-access-persistence --bundler=tsc --unitTestRunner=vitest --linter=eslint --tags=scope:api,type:data-access --no-interactive
pnpm nx g @nx/js:library --directory=libs/api/feature-auth --name=api-feature-auth --importPath=@swint/api-feature-auth --bundler=tsc --unitTestRunner=vitest --linter=eslint --tags=scope:api,type:feature --no-interactive
pnpm nx g @nx/js:library --directory=libs/api/feature-templates --name=api-feature-templates --importPath=@swint/api-feature-templates --bundler=tsc --unitTestRunner=vitest --linter=eslint --tags=scope:api,type:feature --no-interactive
pnpm nx g @nx/js:library --directory=libs/api/feature-sessions --name=api-feature-sessions --importPath=@swint/api-feature-sessions --bundler=tsc --unitTestRunner=vitest --linter=eslint --tags=scope:api,type:feature --no-interactive
```

Delete the generated placeholder sources and specs, and empty each `src/index.ts`. Add `passWithNoTests: true` to each library's vitest `test` block, as Plan 1 did.

- [ ] **Step 4: Generate the app**

```bash
pnpm nx g @nx/node:application --directory=apps/api --name=api --framework=none --bundler=esbuild --unitTestRunner=vitest --linter=eslint --e2eTestRunner=none --tags=scope:api --no-interactive
```

Then make the build emit **ESM**, because `@orpc/*` ships ESM only:
- In the `build` target options of `apps/api` (`apps/api/package.json` `nx.targets.build.options`, or `project.json`), set `"format": ["esm"]`.
- Make sure `"type": "module"` is set in `apps/api/package.json`.
- Replace the generated `apps/api/src/main.ts` body with `console.log('api placeholder');`.

- [ ] **Step 5: Install runtime dependencies**

From the workspace root:

```bash
pnpm add -w fastify@^5.12 @fastify/cookie@^11.1 @orpc/server@^1.16 @orpc/openapi@^1.16 @orpc/zod@^1.16 openid-client@^6.8 ulid@^3.0 pino@^10.4 @aws-sdk/client-dynamodb@^3 @aws-sdk/lib-dynamodb@^3 @aws-sdk/client-s3@^3
pnpm add -w -D testcontainers@^12.2
```

Each later task adds the packages its library imports to that library's `package.json` `dependencies`.

- [ ] **Step 6: Verify the build output runs as ESM**

```bash
pnpm nx build api && node dist/apps/api/main.js
```

Expected: prints `api placeholder`. If the output path differs, use the one the build prints. If Node complains about the module format, fix the esbuild `format` / `outExtension` until the bundle runs, and record what you changed.

- [ ] **Step 7: Verify and commit**

```bash
pnpm nx run-many -t lint test typecheck -p api,api-util-rpc,api-data-access-persistence,api-feature-auth,api-feature-templates,api-feature-sessions
git add -A
git commit -m "chore: scaffold api app and api libraries

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: everything passes. `git status` shows nothing under `.superpowers/` staged.

---

### Task 2: Local infrastructure with Docker Compose and the Keycloak realm

**Files:**
- Create: `docker-compose.yml`, `docker/keycloak/swint-realm.json`

**Interfaces:**
- Produces:
  - Keycloak issuer `http://localhost:8080/realms/swint`
  - DynamoDB Local at `http://localhost:8000`
  - S3Mock at `http://localhost:9090`

- [ ] **Step 1: Write `docker-compose.yml`**

```yaml
name: swint

services:
  keycloak:
    image: quay.io/keycloak/keycloak:26.8.2
    command: ['start-dev', '--import-realm']
    environment:
      KC_BOOTSTRAP_ADMIN_USERNAME: admin
      KC_BOOTSTRAP_ADMIN_PASSWORD: admin
      KC_HOSTNAME: http://localhost:8080
      KC_HEALTH_ENABLED: 'true'
    ports:
      - '8080:8080'
    volumes:
      - ./docker/keycloak:/opt/keycloak/data/import:ro

  dynamodb:
    image: amazon/dynamodb-local:3.3.2
    command: ['-jar', 'DynamoDBLocal.jar', '-sharedDb', '-dbPath', '/home/dynamodblocal/data']
    user: root
    ports:
      - '8000:8000'
    volumes:
      - dynamodb-data:/home/dynamodblocal/data

  s3:
    image: adobe/s3mock:5.2.3
    environment:
      COM_ADOBE_TESTING_S3MOCK_STORE_RETAIN_FILES_ON_EXIT: 'true'
      COM_ADOBE_TESTING_S3MOCK_STORE_ROOT: /data
    ports:
      - '9090:9090'
    volumes:
      - s3-data:/data

volumes:
  dynamodb-data:
  s3-data:
```

If S3Mock 5.x renamed its environment variables, check the image README (`docker run --rm adobe/s3mock:5.2.3 --help`, or the project's docs on GitHub), keep the same meaning (keep files under `/data`), and note it in the report. The API creates the bucket itself (Task 13), so no initial-bucket variable is needed.

- [ ] **Step 2: Write the Keycloak realm import**

`docker/keycloak/swint-realm.json`:

```json
{
  "realm": "swint",
  "enabled": true,
  "registrationAllowed": false,
  "loginWithEmailAllowed": true,
  "roles": {
    "realm": [
      { "name": "interviewer", "description": "Can run interviews and manage templates" },
      { "name": "admin", "description": "Reserved for administration" }
    ]
  },
  "clients": [
    {
      "clientId": "swint-api",
      "name": "Swint API",
      "enabled": true,
      "protocol": "openid-connect",
      "publicClient": false,
      "secret": "swint-dev-secret",
      "standardFlowEnabled": true,
      "directAccessGrantsEnabled": false,
      "redirectUris": ["http://localhost:4200/auth/callback", "http://localhost:3000/auth/callback"],
      "webOrigins": ["http://localhost:4200", "http://localhost:3000"],
      "attributes": {
        "pkce.code.challenge.method": "S256",
        "post.logout.redirect.uris": "http://localhost:4200/*##http://localhost:3000/*"
      },
      "protocolMappers": [
        {
          "name": "realm roles",
          "protocol": "openid-connect",
          "protocolMapper": "oidc-usermodel-realm-role-mapper",
          "consentRequired": false,
          "config": {
            "multivalued": "true",
            "claim.name": "roles",
            "jsonType.label": "String",
            "id.token.claim": "true",
            "access.token.claim": "true",
            "userinfo.token.claim": "true"
          }
        }
      ]
    }
  ],
  "users": [
    {
      "username": "interviewer1",
      "enabled": true,
      "email": "interviewer1@example.com",
      "emailVerified": true,
      "firstName": "Ada",
      "lastName": "Interviewer",
      "credentials": [{ "type": "password", "value": "password", "temporary": false }],
      "realmRoles": ["interviewer"]
    },
    {
      "username": "interviewer2",
      "enabled": true,
      "email": "interviewer2@example.com",
      "emailVerified": true,
      "firstName": "Grace",
      "lastName": "Interviewer",
      "credentials": [{ "type": "password", "value": "password", "temporary": false }],
      "realmRoles": ["interviewer"]
    },
    {
      "username": "admin",
      "enabled": true,
      "email": "admin@example.com",
      "emailVerified": true,
      "firstName": "Alan",
      "lastName": "Admin",
      "credentials": [{ "type": "password", "value": "password", "temporary": false }],
      "realmRoles": ["interviewer", "admin"]
    }
  ]
}
```

- [ ] **Step 3: Start the services and verify them**

```bash
docker compose up -d
until curl -sf http://localhost:8080/realms/swint/.well-known/openid-configuration >/dev/null; do sleep 2; done
curl -s http://localhost:8080/realms/swint/.well-known/openid-configuration | grep -o '"issuer":"[^"]*"'
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8000/
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:9090/
```

Expected:
- the issuer is `"issuer":"http://localhost:8080/realms/swint"`
- DynamoDB Local answers with any HTTP status (e.g. 400), which proves it is listening
- S3Mock answers with 200

Then run `docker compose down` (keep the volumes).

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml docker/keycloak/swint-realm.json
git commit -m "chore: docker compose for keycloak, dynamodb-local and s3mock

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `api-util-rpc`, identity, oRPC base, role middleware, runtime and tokens

**Files:**
- Create: `libs/api/util-rpc/src/lib/identity.ts`, `rpc.ts`, `runtime.ts`, `tokens.ts`
- Test: `libs/api/util-rpc/src/lib/rpc.spec.ts`, `tokens.spec.ts`
- Modify: `libs/api/util-rpc/src/index.ts`, `libs/api/util-rpc/package.json`

**Interfaces:**
- Consumes: `contract` from `@swint/shared-api-contract`
- Produces:

```ts
export interface InterviewerIdentity { kind: 'interviewer'; sub: string; name: string; email: string | null; orgId: string; roles: string[] }
export interface CandidateIdentity { kind: 'candidate'; sessionId: string; orgId: string; inviteHash: string; name: string }
export type Identity = InterviewerIdentity | CandidateIdentity;
export interface RpcContext { identity: Identity | null; requestId: string }
export const base;                    // implement(contract).$context<RpcContext>()
export const requireInterviewer;      // middleware adding { interviewer: InterviewerIdentity } to context
export const interviewerProcedures;   // base.use(requireInterviewer)
export interface Clock { now(): number }
export const systemClock: Clock;
export type IdGenerator = () => string;
export const ulidIds: IdGenerator;
export function randomToken(): string;          // 32 random bytes, base64url
export function sha256Hex(value: string): string;
```

- [ ] **Step 1: Declare dependencies**

In `libs/api/util-rpc/package.json` `dependencies`:
- `"@swint/shared-api-contract": "workspace:*"`
- `"@orpc/server": "^1.16.2"`
- `"ulid": "^3.0.2"`

Then run `pnpm install && pnpm nx sync`.

- [ ] **Step 2: Write the failing tests**

`libs/api/util-rpc/src/lib/tokens.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { randomToken, sha256Hex } from './tokens.js';

describe('tokens', () => {
  it('randomToken is 32 bytes of base64url and unique', () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });
  it('sha256Hex is the lowercase hex digest', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
```

`libs/api/util-rpc/src/lib/rpc.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createRouterClient, ORPCError } from '@orpc/server';
import type { Identity } from './identity.js';
import { interviewerProcedures } from './rpc.js';

const me = interviewerProcedures.me.get.handler(({ context }) => ({
  sub: context.interviewer.sub,
  name: context.interviewer.name,
  email: context.interviewer.email,
  orgId: context.interviewer.orgId,
  roles: context.interviewer.roles,
}));

const client = (identity: Identity | null) =>
  createRouterClient({ me: { get: me } }, { context: { identity, requestId: 'test' } });

const interviewer: Identity = {
  kind: 'interviewer',
  sub: 'sub-1',
  name: 'Ada',
  email: 'ada@example.com',
  orgId: 'default',
  roles: ['interviewer'],
};

describe('requireInterviewer', () => {
  it('passes interviewer identity into context', async () => {
    await expect(client(interviewer).me.get()).resolves.toMatchObject({ sub: 'sub-1', orgId: 'default' });
  });
  it('rejects missing identity with UNAUTHORIZED', async () => {
    await expect(client(null).me.get()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
  it('rejects candidates with FORBIDDEN', async () => {
    const candidate: Identity = { kind: 'candidate', sessionId: 's1', orgId: 'default', inviteHash: 'h', name: 'Bo' };
    await expect(client(candidate).me.get()).rejects.toBeInstanceOf(ORPCError);
    await expect(client(candidate).me.get()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('rejects an interviewer identity without the interviewer role', async () => {
    await expect(client({ ...interviewer, roles: [] }).me.get()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `pnpm nx test api-util-rpc`
Expected: FAIL, because the modules cannot be resolved.

- [ ] **Step 4: Implement**

`libs/api/util-rpc/src/lib/identity.ts`:

```ts
export interface InterviewerIdentity {
  kind: 'interviewer';
  sub: string;
  name: string;
  email: string | null;
  orgId: string;
  roles: string[];
}

export interface CandidateIdentity {
  kind: 'candidate';
  sessionId: string;
  orgId: string;
  inviteHash: string;
  name: string;
}

export type Identity = InterviewerIdentity | CandidateIdentity;

export interface RpcContext {
  identity: Identity | null;
  requestId: string;
}

export const INTERVIEWER_ROLE = 'interviewer';
```

`libs/api/util-rpc/src/lib/rpc.ts`:

```ts
import { implement, ORPCError, os } from '@orpc/server';
import { contract } from '@swint/shared-api-contract';
import { INTERVIEWER_ROLE, type InterviewerIdentity, type RpcContext } from './identity.js';

export const base = implement(contract).$context<RpcContext>();

export const requireInterviewer = os
  .$context<RpcContext>()
  .middleware(async ({ context, next }) => {
    const identity = context.identity;
    if (!identity) throw new ORPCError('UNAUTHORIZED');
    if (identity.kind !== 'interviewer' || !identity.roles.includes(INTERVIEWER_ROLE)) {
      throw new ORPCError('FORBIDDEN');
    }
    const interviewer: InterviewerIdentity = identity;
    return next({ context: { interviewer } });
  });

export const interviewerProcedures = base.use(requireInterviewer);
```

`libs/api/util-rpc/src/lib/runtime.ts`:

```ts
import { ulid } from 'ulid';

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export type IdGenerator = () => string;

export const ulidIds: IdGenerator = () => ulid();
```

`libs/api/util-rpc/src/lib/tokens.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';

export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
```

`libs/api/util-rpc/src/index.ts`:

```ts
export * from './lib/identity.js';
export * from './lib/rpc.js';
export * from './lib/runtime.js';
export * from './lib/tokens.js';
```

If `tsconfig.lib.json` for this library has `"types": []`, set it to `["node"]`. This is an api-scope library and needs `node:crypto`.

If `base.use(...)` or `interviewerProcedures.me.get` doesn't typecheck against `@orpc/server` 1.16.2, check the `Implementer` types in `node_modules/@orpc/server/dist/index.d.mts`. Use the documented way to apply a middleware to a contract implementer and keep the same exported names. Do not change the tests' expectations.

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `pnpm nx run-many -t test lint typecheck -p api-util-rpc`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libs/api/util-rpc pnpm-lock.yaml
git commit -m "feat(api-util-rpc): identity, oRPC base with interviewer middleware, runtime and tokens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `api-data-access-persistence`, AWS clients, ensureTable/ensureBucket, BlobStore and test containers

**Files:**
- Create: `libs/api/data-access-persistence/src/lib/aws.ts`, `table.ts`, `blob-store.ts`, `errors.ts`, `records.ts`
- Create: `libs/api/data-access-persistence/src/testing/index.ts`, `src/testing/global-setup.ts`
- Test: `libs/api/data-access-persistence/src/lib/aws.spec.ts`, `blob-store.spec.ts`
- Modify: `libs/api/data-access-persistence/package.json` (deps + `./testing` export), its `vite.config.ts` / `vitest.config.*` (globalSetup, timeouts), `src/index.ts`

**Interfaces:**
- Produces:

```ts
export interface AwsConfig { region: string; dynamoEndpoint?: string; s3Endpoint?: string; credentials?: { accessKeyId: string; secretAccessKey: string } }
export function createDynamo(cfg: AwsConfig): { raw: DynamoDBClient; doc: DynamoDBDocumentClient }
export function createS3(cfg: AwsConfig): S3Client
export async function ensureTable(raw: DynamoDBClient, tableName: string): Promise<void>
export async function ensureBucket(s3: S3Client, bucket: string): Promise<void>
export interface Table { doc: DynamoDBDocumentClient; name: string }
export async function queryAll<T>(table: Table, input: Omit<QueryCommandInput, 'TableName'>): Promise<T[]>
export class StaleWriteError extends Error {}
export interface BlobStore { putJson(key, value): Promise<void>; getJson<T>(key): Promise<T | null>; putBytes(key, bytes: Uint8Array, contentType?: string): Promise<void>; getBytes(key): Promise<Uint8Array | null> }
export function createBlobStore(s3: S3Client, bucket: string): BlobStore
export const blobKeys: { templateSeed(orgId, templateId, seedId): string; sessionBoardLatest(orgId, sessionId): string; sessionBoardCheckpoint(orgId, sessionId, ts: number): string; sessionNotesLatest(orgId, sessionId): string }
// subpath '@swint/api-data-access-persistence/testing':
export async function startTestInfra(): Promise<{ dynamoEndpoint: string; s3Endpoint: string; stop(): Promise<void> }>
export async function createTestStores(): Promise<TestStores>   // unique table + bucket per call, using inject()
```

`TestStores` is extended in Tasks 5–6 with the repositories. In this task it is `{ cfg: AwsConfig; table: Table; raw: DynamoDBClient; s3: S3Client; bucket: string; blobs: BlobStore }`.

- [ ] **Step 1: Declare dependencies and the testing subpath**

In `libs/api/data-access-persistence/package.json`:
- `dependencies`: `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-s3` (`^3.1164.0`), `testcontainers` (`^12.2.1`; used by the testing subpath) and `vitest` (the workspace's version; used by the testing subpath's `inject`).
- Add an exports entry next to `"."`, mirroring its conditions:

```json
"./testing": {
  "swint": "./src/testing/index.ts",
  "types": "./dist/testing/index.d.ts",
  "import": "./dist/testing/index.js",
  "default": "./dist/testing/index.js"
}
```

Make sure `tsconfig.lib.json` `include` covers `src/**/*.ts` (it already does), and set `"types": ["node"]`. Then run `pnpm install && pnpm nx sync`.

- [ ] **Step 2: Write the test infrastructure**

`libs/api/data-access-persistence/src/testing/index.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { inject } from 'vitest';
import { createDynamo, createS3, ensureBucket, ensureTable, type AwsConfig } from '../lib/aws.js';
import { createBlobStore, type BlobStore } from '../lib/blob-store.js';
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
  return { cfg, raw, table: { doc, name: tableName }, s3, bucket, blobs: createBlobStore(s3, bucket) };
}
```

`libs/api/data-access-persistence/src/testing/global-setup.ts`:

```ts
import type { TestProject } from 'vitest/node';
import { startTestInfra } from './index.js';

export default async function setup(project: TestProject) {
  const infra = await startTestInfra();
  project.provide('dynamoEndpoint', infra.dynamoEndpoint);
  project.provide('s3Endpoint', infra.s3Endpoint);
  return async () => {
    await infra.stop();
  };
}
```

In this library's vitest config `test` block, add:

```ts
globalSetup: ['./src/testing/global-setup.ts'],
hookTimeout: 120_000,
testTimeout: 30_000,
```

Note: `src/testing/index.ts` imports `inject` from `vitest`. That is fine because only test code imports the `./testing` subpath. Do not re-export `./testing` from `src/index.ts`.

- [ ] **Step 3: Write the failing tests**

`libs/api/data-access-persistence/src/lib/aws.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { createTestStores } from '../testing/index.js';
import { ensureBucket, ensureTable } from './aws.js';

describe('ensureTable / ensureBucket', () => {
  it('creates the table with PK/SK and GSI1, and is idempotent', async () => {
    const stores = await createTestStores();
    await ensureTable(stores.raw, stores.table.name); // second call: no throw
    const { Table } = await stores.raw.send(new DescribeTableCommand({ TableName: stores.table.name }));
    expect(Table?.KeySchema).toEqual([
      { AttributeName: 'PK', KeyType: 'HASH' },
      { AttributeName: 'SK', KeyType: 'RANGE' },
    ]);
    expect(Table?.GlobalSecondaryIndexes?.[0]).toMatchObject({
      IndexName: 'GSI1',
      KeySchema: [
        { AttributeName: 'GSI1PK', KeyType: 'HASH' },
        { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
      ],
    });
  });

  it('creates the bucket and is idempotent', async () => {
    const stores = await createTestStores();
    await ensureBucket(stores.s3, stores.bucket);
    await expect(stores.s3.send(new HeadBucketCommand({ Bucket: stores.bucket }))).resolves.toBeDefined();
  });
});
```

`libs/api/data-access-persistence/src/lib/blob-store.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createTestStores } from '../testing/index.js';
import { blobKeys } from './blob-store.js';

describe('BlobStore', () => {
  it('round-trips JSON and returns null for missing keys', async () => {
    const { blobs } = await createTestStores();
    await blobs.putJson('a/b.json', { elements: [{ id: 'e1' }] });
    await expect(blobs.getJson('a/b.json')).resolves.toEqual({ elements: [{ id: 'e1' }] });
    await expect(blobs.getJson('missing.json')).resolves.toBeNull();
  });

  it('round-trips bytes and returns null for missing keys', async () => {
    const { blobs } = await createTestStores();
    const bytes = new Uint8Array([1, 2, 3, 250]);
    await blobs.putBytes('x/latest.bin', bytes);
    await expect(blobs.getBytes('x/latest.bin')).resolves.toEqual(bytes);
    await expect(blobs.getBytes('x/none.bin')).resolves.toBeNull();
  });

  it('builds the spec §4.2 key layout', () => {
    expect(blobKeys.templateSeed('o1', 't1', 's1')).toBe('orgs/o1/templates/t1/seed-s1.excalidraw.json');
    expect(blobKeys.sessionBoardLatest('o1', 'x1')).toBe('orgs/o1/sessions/x1/board/latest.bin');
    expect(blobKeys.sessionBoardCheckpoint('o1', 'x1', 1700000000000)).toBe(
      'orgs/o1/sessions/x1/board/checkpoints/1700000000000.bin',
    );
    expect(blobKeys.sessionNotesLatest('o1', 'x1')).toBe('orgs/o1/sessions/x1/notes/latest.bin');
  });
});
```

- [ ] **Step 4: Run the tests to confirm they fail**

Run: `pnpm nx test api-data-access-persistence`
Expected: FAIL, because `./aws.js` / `./blob-store.js` cannot be resolved. The containers start and stop in globalSetup.

- [ ] **Step 5: Implement**

`libs/api/data-access-persistence/src/lib/aws.ts`:

```ts
import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ResourceNotFoundException,
  UpdateTimeToLiveCommand,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';

export interface AwsConfig {
  region: string;
  dynamoEndpoint?: string;
  s3Endpoint?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

export function createDynamo(cfg: AwsConfig): { raw: DynamoDBClient; doc: DynamoDBDocumentClient } {
  const raw = new DynamoDBClient({
    region: cfg.region,
    endpoint: cfg.dynamoEndpoint,
    credentials: cfg.credentials,
  });
  const doc = DynamoDBDocumentClient.from(raw, {
    marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: false },
  });
  return { raw, doc };
}

export function createS3(cfg: AwsConfig): S3Client {
  return new S3Client({
    region: cfg.region,
    endpoint: cfg.s3Endpoint,
    credentials: cfg.credentials,
    forcePathStyle: Boolean(cfg.s3Endpoint),
  });
}

export async function ensureTable(raw: DynamoDBClient, tableName: string): Promise<void> {
  try {
    await raw.send(new DescribeTableCommand({ TableName: tableName }));
    return;
  } catch (e) {
    if (!(e instanceof ResourceNotFoundException)) throw e;
  }
  await raw.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
        { AttributeName: 'GSI1PK', AttributeType: 'S' },
        { AttributeName: 'GSI1SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'GSI1',
          KeySchema: [
            { AttributeName: 'GSI1PK', KeyType: 'HASH' },
            { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    }),
  );
  await waitUntilTableExists({ client: raw, maxWaitTime: 30 }, { TableName: tableName });
  await raw.send(
    new UpdateTimeToLiveCommand({
      TableName: tableName,
      TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
    }),
  );
}

export async function ensureBucket(s3: S3Client, bucket: string): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    return;
  } catch {
    // fall through and create
  }
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));
}
```

`libs/api/data-access-persistence/src/lib/table.ts`:

```ts
import { QueryCommand, type DynamoDBDocumentClient, type QueryCommandInput } from '@aws-sdk/lib-dynamodb';

export interface Table {
  doc: DynamoDBDocumentClient;
  name: string;
}

export const GSI1 = 'GSI1';

export async function queryAll<T>(table: Table, input: Omit<QueryCommandInput, 'TableName'>): Promise<T[]> {
  const items: T[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const out = await table.doc.send(new QueryCommand({ ...input, TableName: table.name, ExclusiveStartKey }));
    items.push(...((out.Items ?? []) as T[]));
    ExclusiveStartKey = out.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

/** Remove DynamoDB key attributes before returning a record to callers. */
export function stripKeys<T extends object>(item: T): Omit<T, 'PK' | 'SK' | 'GSI1PK' | 'GSI1SK'> {
  const { PK: _pk, SK: _sk, GSI1PK: _g1, GSI1SK: _g2, ...rest } = item as T & Record<string, unknown>;
  return rest as Omit<T, 'PK' | 'SK' | 'GSI1PK' | 'GSI1SK'>;
}
```

`libs/api/data-access-persistence/src/lib/errors.ts`:

```ts
/** A conditional write failed because the record changed (or did not exist) since it was read. */
export class StaleWriteError extends Error {
  constructor(message = 'Record changed since it was read') {
    super(message);
    this.name = 'StaleWriteError';
  }
}
```

`libs/api/data-access-persistence/src/lib/blob-store.ts`:

```ts
import { GetObjectCommand, NoSuchKey, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';

export interface BlobStore {
  putJson(key: string, value: unknown): Promise<void>;
  getJson<T>(key: string): Promise<T | null>;
  putBytes(key: string, bytes: Uint8Array, contentType?: string): Promise<void>;
  getBytes(key: string): Promise<Uint8Array | null>;
}

export const blobKeys = {
  templateSeed: (orgId: string, templateId: string, seedId: string) =>
    `orgs/${orgId}/templates/${templateId}/seed-${seedId}.excalidraw.json`,
  sessionBoardLatest: (orgId: string, sessionId: string) => `orgs/${orgId}/sessions/${sessionId}/board/latest.bin`,
  sessionBoardCheckpoint: (orgId: string, sessionId: string, ts: number) =>
    `orgs/${orgId}/sessions/${sessionId}/board/checkpoints/${ts}.bin`,
  sessionNotesLatest: (orgId: string, sessionId: string) => `orgs/${orgId}/sessions/${sessionId}/notes/latest.bin`,
} as const;

export function createBlobStore(s3: S3Client, bucket: string): BlobStore {
  async function getRaw(key: string): Promise<Uint8Array | null> {
    try {
      const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return out.Body ? await out.Body.transformToByteArray() : null;
    } catch (e) {
      if (e instanceof NoSuchKey || (e as { name?: string }).name === 'NoSuchKey') return null;
      throw e;
    }
  }

  return {
    async putJson(key, value) {
      await s3.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: JSON.stringify(value), ContentType: 'application/json' }),
      );
    },
    async getJson<T>(key: string) {
      const bytes = await getRaw(key);
      return bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as T) : null;
    },
    async putBytes(key, bytes, contentType = 'application/octet-stream') {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: contentType }));
    },
    getBytes: getRaw,
  };
}
```

`libs/api/data-access-persistence/src/lib/records.ts`:

```ts
import type { SessionStatus } from '@swint/shared-domain';

export interface UserRecord {
  sub: string;
  orgId: string;
  name: string;
  email: string | null;
  roles: string[];
  lastLoginAt: number;
}

export interface AuthSessionRecord {
  idHash: string;
  userSub: string;
  orgId: string;
  name: string;
  email: string | null;
  roles: string[];
  idToken: string;
  /** epoch SECONDS (DynamoDB TTL) */
  expiresAt: number;
}

export interface TemplateRecord {
  id: string;
  orgId: string;
  title: string;
  instructionsMd: string;
  rubricMd: string;
  durationMin: number;
  boardSeedKey: string | null;
  archived: boolean;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface TemplateSnapshot {
  title: string;
  instructionsMd: string;
  rubricMd: string;
  durationMin: number;
  boardSeedKey: string | null;
}

export interface SessionRecord {
  id: string;
  orgId: string;
  templateId: string;
  templateSnapshot: TemplateSnapshot;
  candidateName: string;
  status: SessionStatus;
  startedAt: number | null;
  durationSec: number;
  extensionSec: number;
  endedAt: number | null;
  endedBy: string | null;
  cancelReason: string | null;
  activeInviteHash: string;
  createdBy: string;
  createdAt: number;
  /** optimistic concurrency counter, starts at 1 */
  version: number;
}

export interface InviteRecord {
  hash: string;
  orgId: string;
  sessionId: string;
  createdAt: number;
  revokedAt: number | null;
}
```

Add `"@swint/shared-domain": "workspace:*"` to this library's `dependencies` (used by `records.ts`) and run `pnpm install && pnpm nx sync`.

`libs/api/data-access-persistence/src/index.ts`:

```ts
export * from './lib/aws.js';
export * from './lib/table.js';
export * from './lib/errors.js';
export * from './lib/blob-store.js';
export * from './lib/records.js';
```

- [ ] **Step 6: Run the tests to confirm they pass**

Run: `pnpm nx run-many -t test lint typecheck -p api-data-access-persistence`
Expected: PASS. Containers start once per test run.

If `ensureTable`'s `UpdateTimeToLive` throws on DynamoDB Local, wrap only that call in `try/catch` that logs nothing and continues. Note it in the report: TTL is honoured on real DynamoDB, and repositories filter expired items themselves (Task 5).

- [ ] **Step 7: Commit**

```bash
git add libs/api/data-access-persistence pnpm-lock.yaml
git commit -m "feat(api-data-access-persistence): aws clients, table/bucket bootstrap, blob store, test containers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Persistence repos for users, auth sessions and templates

**Files:**
- Create: `libs/api/data-access-persistence/src/lib/users-repo.ts`, `auth-sessions-repo.ts`, `templates-repo.ts`
- Test: `libs/api/data-access-persistence/src/lib/users-repo.spec.ts`, `auth-sessions-repo.spec.ts`, `templates-repo.spec.ts`
- Modify: `libs/api/data-access-persistence/src/index.ts`, `src/testing/index.ts` (extend `TestStores`)

**Interfaces:**
- Consumes: `Table`, `queryAll`, `stripKeys`, `GSI1`, records (Task 4)
- Produces:

```ts
export interface UsersRepo { upsert(user: UserRecord): Promise<void>; get(sub: string): Promise<UserRecord | null> }
export interface AuthSessionsRepo { create(rec: AuthSessionRecord): Promise<void>; get(idHash: string, nowMs: number): Promise<AuthSessionRecord | null>; delete(idHash: string): Promise<void> }
export interface TemplatesRepo {
  create(rec: TemplateRecord): Promise<void>;
  get(orgId: string, id: string): Promise<TemplateRecord | null>;      // null if missing OR other org
  listByOrg(orgId: string, opts: { includeArchived: boolean }): Promise<TemplateRecord[]>; // sorted by title (case-insensitive)
  update(rec: TemplateRecord): Promise<void>;                            // StaleWriteError if missing / other org
}
export function createUsersRepo(table: Table): UsersRepo
export function createAuthSessionsRepo(table: Table): AuthSessionsRepo
export function createTemplatesRepo(table: Table): TemplatesRepo
// TestStores gains: users, authSessions, templates
```

- [ ] **Step 1: Write the failing tests**

`libs/api/data-access-persistence/src/lib/users-repo.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createTestStores } from '../testing/index.js';

describe('UsersRepo', () => {
  it('upserts and reads back by sub', async () => {
    const { users } = await createTestStores();
    const user = { sub: 'sub-1', orgId: 'default', name: 'Ada', email: 'a@x.io', roles: ['interviewer'], lastLoginAt: 1 };
    await users.upsert(user);
    await users.upsert({ ...user, name: 'Ada L.', lastLoginAt: 2 });
    await expect(users.get('sub-1')).resolves.toEqual({ ...user, name: 'Ada L.', lastLoginAt: 2 });
    await expect(users.get('nobody')).resolves.toBeNull();
  });
});
```

`libs/api/data-access-persistence/src/lib/auth-sessions-repo.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createTestStores } from '../testing/index.js';

const rec = (expiresAtSec: number) => ({
  idHash: 'h1',
  userSub: 'sub-1',
  orgId: 'default',
  name: 'Ada',
  email: null,
  roles: ['interviewer'],
  idToken: 'id.token.jwt',
  expiresAt: expiresAtSec,
});

describe('AuthSessionsRepo', () => {
  it('returns a live session and hides expired ones', async () => {
    const { authSessions } = await createTestStores();
    await authSessions.create(rec(2_000));
    await expect(authSessions.get('h1', 1_999_000)).resolves.toEqual(rec(2_000));
    await expect(authSessions.get('h1', 2_000_000)).resolves.toBeNull();
  });
  it('deletes', async () => {
    const { authSessions } = await createTestStores();
    await authSessions.create(rec(9_999_999_999));
    await authSessions.delete('h1');
    await expect(authSessions.get('h1', 0)).resolves.toBeNull();
  });
});
```

`libs/api/data-access-persistence/src/lib/templates-repo.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createTestStores } from '../testing/index.js';
import { StaleWriteError } from './errors.js';
import type { TemplateRecord } from './records.js';

const tpl = (over: Partial<TemplateRecord> = {}): TemplateRecord => ({
  id: 't1',
  orgId: 'default',
  title: 'URL shortener',
  instructionsMd: '# Go',
  rubricMd: '- x',
  durationMin: 45,
  boardSeedKey: null,
  archived: false,
  createdBy: 'sub-1',
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe('TemplatesRepo', () => {
  it('creates and gets within the same org only', async () => {
    const { templates } = await createTestStores();
    await templates.create(tpl());
    await expect(templates.get('default', 't1')).resolves.toEqual(tpl());
    await expect(templates.get('other-org', 't1')).resolves.toBeNull();
    await expect(templates.get('default', 'missing')).resolves.toBeNull();
  });

  it('lists by org sorted by title, excluding archived unless asked', async () => {
    const { templates } = await createTestStores();
    await templates.create(tpl({ id: 't1', title: 'b system' }));
    await templates.create(tpl({ id: 't2', title: 'A chat app' }));
    await templates.create(tpl({ id: 't3', title: 'c old', archived: true }));
    await templates.create(tpl({ id: 't4', title: 'other', orgId: 'other-org' }));
    expect((await templates.listByOrg('default', { includeArchived: false })).map((t) => t.id)).toEqual(['t2', 't1']);
    expect((await templates.listByOrg('default', { includeArchived: true })).map((t) => t.id)).toEqual([
      't2',
      't1',
      't3',
    ]);
  });

  it('update replaces and keeps title ordering in sync', async () => {
    const { templates } = await createTestStores();
    await templates.create(tpl({ id: 't1', title: 'zzz' }));
    await templates.create(tpl({ id: 't2', title: 'mmm' }));
    await templates.update(tpl({ id: 't1', title: 'aaa', updatedAt: 5 }));
    expect((await templates.listByOrg('default', { includeArchived: false })).map((t) => t.id)).toEqual(['t1', 't2']);
    await expect(templates.get('default', 't1')).resolves.toMatchObject({ title: 'aaa', updatedAt: 5 });
  });

  it('update of a missing or foreign template throws StaleWriteError', async () => {
    const { templates } = await createTestStores();
    await templates.create(tpl());
    await expect(templates.update(tpl({ id: 'nope' }))).rejects.toBeInstanceOf(StaleWriteError);
    await expect(templates.update(tpl({ orgId: 'other-org' }))).rejects.toBeInstanceOf(StaleWriteError);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm nx test api-data-access-persistence`
Expected: FAIL. `users` / `authSessions` / `templates` are missing from `TestStores`, and the repo modules cannot be resolved.

- [ ] **Step 3: Implement**

`libs/api/data-access-persistence/src/lib/users-repo.ts`:

```ts
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { UserRecord } from './records.js';
import { stripKeys, type Table } from './table.js';

export interface UsersRepo {
  upsert(user: UserRecord): Promise<void>;
  get(sub: string): Promise<UserRecord | null>;
}

const key = (sub: string) => ({ PK: `USER#${sub}`, SK: 'PROFILE' });

export function createUsersRepo(table: Table): UsersRepo {
  return {
    async upsert(user) {
      await table.doc.send(new PutCommand({ TableName: table.name, Item: { ...key(user.sub), ...user } }));
    },
    async get(sub) {
      const out = await table.doc.send(new GetCommand({ TableName: table.name, Key: key(sub) }));
      return out.Item ? (stripKeys(out.Item) as UserRecord) : null;
    },
  };
}
```

`libs/api/data-access-persistence/src/lib/auth-sessions-repo.ts`:

```ts
import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { AuthSessionRecord } from './records.js';
import { stripKeys, type Table } from './table.js';

export interface AuthSessionsRepo {
  create(rec: AuthSessionRecord): Promise<void>;
  /** Returns null when missing or expired (DynamoDB TTL deletion is lazy, so expiry is also checked here). */
  get(idHash: string, nowMs: number): Promise<AuthSessionRecord | null>;
  delete(idHash: string): Promise<void>;
}

const key = (idHash: string) => ({ PK: `AUTHSESSION#${idHash}`, SK: 'META' });

export function createAuthSessionsRepo(table: Table): AuthSessionsRepo {
  return {
    async create(rec) {
      await table.doc.send(new PutCommand({ TableName: table.name, Item: { ...key(rec.idHash), ...rec } }));
    },
    async get(idHash, nowMs) {
      const out = await table.doc.send(new GetCommand({ TableName: table.name, Key: key(idHash) }));
      if (!out.Item) return null;
      const rec = stripKeys(out.Item) as AuthSessionRecord;
      return rec.expiresAt * 1000 > nowMs ? rec : null;
    },
    async delete(idHash) {
      await table.doc.send(new DeleteCommand({ TableName: table.name, Key: key(idHash) }));
    },
  };
}
```

`libs/api/data-access-persistence/src/lib/templates-repo.ts`:

```ts
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { StaleWriteError } from './errors.js';
import type { TemplateRecord } from './records.js';
import { GSI1, queryAll, stripKeys, type Table } from './table.js';

export interface TemplatesRepo {
  create(rec: TemplateRecord): Promise<void>;
  get(orgId: string, id: string): Promise<TemplateRecord | null>;
  listByOrg(orgId: string, opts: { includeArchived: boolean }): Promise<TemplateRecord[]>;
  update(rec: TemplateRecord): Promise<void>;
}

const item = (rec: TemplateRecord) => ({
  PK: `TEMPLATE#${rec.id}`,
  SK: 'META',
  GSI1PK: `ORG#${rec.orgId}`,
  GSI1SK: `TEMPLATE#${rec.title.toLowerCase()}#${rec.id}`,
  ...rec,
});

export function createTemplatesRepo(table: Table): TemplatesRepo {
  return {
    async create(rec) {
      await table.doc.send(
        new PutCommand({ TableName: table.name, Item: item(rec), ConditionExpression: 'attribute_not_exists(PK)' }),
      );
    },
    async get(orgId, id) {
      const out = await table.doc.send(
        new GetCommand({ TableName: table.name, Key: { PK: `TEMPLATE#${id}`, SK: 'META' } }),
      );
      if (!out.Item || out.Item['orgId'] !== orgId) return null;
      return stripKeys(out.Item) as TemplateRecord;
    },
    async listByOrg(orgId, { includeArchived }) {
      const rows = await queryAll<Record<string, unknown>>(table, {
        IndexName: GSI1,
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `ORG#${orgId}`, ':prefix': 'TEMPLATE#' },
      });
      return rows
        .map((r) => stripKeys(r) as TemplateRecord)
        .filter((t) => includeArchived || !t.archived);
    },
    async update(rec) {
      try {
        await table.doc.send(
          new PutCommand({
            TableName: table.name,
            Item: item(rec),
            ConditionExpression: 'attribute_exists(PK) AND orgId = :org',
            ExpressionAttributeValues: { ':org': rec.orgId },
          }),
        );
      } catch (e) {
        if (e instanceof ConditionalCheckFailedException) throw new StaleWriteError('Template not found');
        throw e;
      }
    },
  };
}
```

Extend `src/testing/index.ts`:
- import the three factories and their types
- add `users: UsersRepo; authSessions: AuthSessionsRepo; templates: TemplatesRepo` to `TestStores`
- build them from `table` in `createTestStores()`

Add the three repos to `src/index.ts` (`export * from './lib/users-repo.js'` and so on).

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `pnpm nx run-many -t test lint typecheck -p api-data-access-persistence`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/api/data-access-persistence
git commit -m "feat(api-data-access-persistence): users, auth sessions and templates repositories

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Persistence repos for sessions (optimistic concurrency) and invites

**Files:**
- Create: `libs/api/data-access-persistence/src/lib/sessions-repo.ts`, `invites-repo.ts`
- Test: `libs/api/data-access-persistence/src/lib/sessions-repo.spec.ts`, `invites-repo.spec.ts`
- Modify: `libs/api/data-access-persistence/src/index.ts`, `src/testing/index.ts`

**Interfaces:**
- Produces:

```ts
export interface SessionsRepo {
  create(rec: SessionRecord): Promise<void>;                     // rec.version must be 1
  get(orgId: string, id: string): Promise<SessionRecord | null>; // null if missing OR other org
  listByOrg(orgId: string, opts: { status?: SessionStatus }): Promise<SessionRecord[]>; // newest first
  /** Writes `next` with version = expectedVersion + 1 iff the stored version is expectedVersion. Returns the stored record. */
  update(next: SessionRecord, expectedVersion: number): Promise<SessionRecord>; // StaleWriteError otherwise
}
export interface InvitesRepo {
  create(rec: InviteRecord): Promise<void>;
  get(hash: string): Promise<InviteRecord | null>;
  revoke(hash: string, atMs: number): Promise<void>;  // no-op if already revoked; ignores missing
}
export function createSessionsRepo(table: Table): SessionsRepo
export function createInvitesRepo(table: Table): InvitesRepo
// TestStores gains: sessions, invites
```

- [ ] **Step 1: Write the failing tests**

`libs/api/data-access-persistence/src/lib/sessions-repo.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createTestStores } from '../testing/index.js';
import { StaleWriteError } from './errors.js';
import type { SessionRecord } from './records.js';

const session = (over: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 's1',
  orgId: 'default',
  templateId: 't1',
  templateSnapshot: { title: 'URL shortener', instructionsMd: '# Go', rubricMd: '- x', durationMin: 45, boardSeedKey: null },
  candidateName: 'Bo',
  status: 'created',
  startedAt: null,
  durationSec: 2700,
  extensionSec: 0,
  endedAt: null,
  endedBy: null,
  cancelReason: null,
  activeInviteHash: 'h1',
  createdBy: 'sub-1',
  createdAt: 100,
  version: 1,
  ...over,
});

describe('SessionsRepo', () => {
  it('creates and gets within the same org only', async () => {
    const { sessions } = await createTestStores();
    await sessions.create(session());
    await expect(sessions.get('default', 's1')).resolves.toEqual(session());
    await expect(sessions.get('other-org', 's1')).resolves.toBeNull();
  });

  it('lists newest first and filters by status', async () => {
    const { sessions } = await createTestStores();
    await sessions.create(session({ id: 's1', createdAt: 100 }));
    await sessions.create(session({ id: 's2', createdAt: 300, status: 'live' }));
    await sessions.create(session({ id: 's3', createdAt: 200 }));
    await sessions.create(session({ id: 's4', createdAt: 400, orgId: 'other-org' }));
    expect((await sessions.listByOrg('default', {})).map((s) => s.id)).toEqual(['s2', 's3', 's1']);
    expect((await sessions.listByOrg('default', { status: 'created' })).map((s) => s.id)).toEqual(['s3', 's1']);
  });

  it('update bumps the version when the expected version matches', async () => {
    const { sessions } = await createTestStores();
    await sessions.create(session());
    const stored = await sessions.update(session({ status: 'live', startedAt: 500 }), 1);
    expect(stored).toMatchObject({ status: 'live', startedAt: 500, version: 2 });
    await expect(sessions.get('default', 's1')).resolves.toEqual(stored);
  });

  it('update with a stale version throws StaleWriteError, and exactly one of two racing updates wins', async () => {
    const { sessions } = await createTestStores();
    await sessions.create(session());
    const results = await Promise.allSettled([
      sessions.update(session({ status: 'live', startedAt: 1 }), 1),
      sessions.update(session({ status: 'cancelled', endedAt: 1 }), 1),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(StaleWriteError);
  });

  it('update cannot move a session to another org', async () => {
    const { sessions } = await createTestStores();
    await sessions.create(session());
    await expect(sessions.update(session({ orgId: 'other-org' }), 1)).rejects.toBeInstanceOf(StaleWriteError);
  });
});
```

`libs/api/data-access-persistence/src/lib/invites-repo.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createTestStores } from '../testing/index.js';

describe('InvitesRepo', () => {
  it('creates, gets, and revokes once', async () => {
    const { invites } = await createTestStores();
    await invites.create({ hash: 'h1', orgId: 'default', sessionId: 's1', createdAt: 1, revokedAt: null });
    await expect(invites.get('h1')).resolves.toEqual({
      hash: 'h1',
      orgId: 'default',
      sessionId: 's1',
      createdAt: 1,
      revokedAt: null,
    });
    await invites.revoke('h1', 50);
    await invites.revoke('h1', 99); // keeps the first revocation time
    await expect(invites.get('h1')).resolves.toMatchObject({ revokedAt: 50 });
    await expect(invites.get('missing')).resolves.toBeNull();
    await expect(invites.revoke('missing', 1)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm nx test api-data-access-persistence`
Expected: FAIL, because the modules and `TestStores` members are missing.

- [ ] **Step 3: Implement**

`libs/api/data-access-persistence/src/lib/sessions-repo.ts`:

```ts
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { SessionStatus } from '@swint/shared-domain';
import { StaleWriteError } from './errors.js';
import type { SessionRecord } from './records.js';
import { GSI1, queryAll, stripKeys, type Table } from './table.js';

export interface SessionsRepo {
  create(rec: SessionRecord): Promise<void>;
  get(orgId: string, id: string): Promise<SessionRecord | null>;
  listByOrg(orgId: string, opts: { status?: SessionStatus }): Promise<SessionRecord[]>;
  update(next: SessionRecord, expectedVersion: number): Promise<SessionRecord>;
}

const pad = (n: number) => String(n).padStart(15, '0');

const item = (rec: SessionRecord) => ({
  PK: `SESSION#${rec.id}`,
  SK: 'META',
  GSI1PK: `ORG#${rec.orgId}`,
  GSI1SK: `SESSION#${pad(rec.createdAt)}#${rec.id}`,
  ...rec,
});

export function createSessionsRepo(table: Table): SessionsRepo {
  return {
    async create(rec) {
      await table.doc.send(
        new PutCommand({
          TableName: table.name,
          Item: item({ ...rec, version: 1 }),
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
    },
    async get(orgId, id) {
      const out = await table.doc.send(
        new GetCommand({ TableName: table.name, Key: { PK: `SESSION#${id}`, SK: 'META' } }),
      );
      if (!out.Item || out.Item['orgId'] !== orgId) return null;
      return stripKeys(out.Item) as SessionRecord;
    },
    async listByOrg(orgId, { status }) {
      const rows = await queryAll<Record<string, unknown>>(table, {
        IndexName: GSI1,
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `ORG#${orgId}`, ':prefix': 'SESSION#' },
        ScanIndexForward: false,
      });
      return rows.map((r) => stripKeys(r) as SessionRecord).filter((s) => !status || s.status === status);
    },
    async update(next, expectedVersion) {
      const stored: SessionRecord = { ...next, version: expectedVersion + 1 };
      try {
        await table.doc.send(
          new PutCommand({
            TableName: table.name,
            Item: item(stored),
            ConditionExpression: 'attribute_exists(PK) AND #v = :expected AND orgId = :org',
            ExpressionAttributeNames: { '#v': 'version' },
            ExpressionAttributeValues: { ':expected': expectedVersion, ':org': next.orgId },
          }),
        );
      } catch (e) {
        if (e instanceof ConditionalCheckFailedException) throw new StaleWriteError();
        throw e;
      }
      return stored;
    },
  };
}
```

`libs/api/data-access-persistence/src/lib/invites-repo.ts`:

```ts
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { InviteRecord } from './records.js';
import { stripKeys, type Table } from './table.js';

export interface InvitesRepo {
  create(rec: InviteRecord): Promise<void>;
  get(hash: string): Promise<InviteRecord | null>;
  revoke(hash: string, atMs: number): Promise<void>;
}

const key = (hash: string) => ({ PK: `INVITE#${hash}`, SK: 'META' });

export function createInvitesRepo(table: Table): InvitesRepo {
  return {
    async create(rec) {
      await table.doc.send(
        new PutCommand({
          TableName: table.name,
          Item: { ...key(rec.hash), ...rec },
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
    },
    async get(hash) {
      const out = await table.doc.send(new GetCommand({ TableName: table.name, Key: key(hash) }));
      return out.Item ? (stripKeys(out.Item) as InviteRecord) : null;
    },
    async revoke(hash, atMs) {
      try {
        await table.doc.send(
          new UpdateCommand({
            TableName: table.name,
            Key: key(hash),
            UpdateExpression: 'SET revokedAt = :at',
            ConditionExpression: 'attribute_exists(PK) AND revokedAt = :null',
            ExpressionAttributeValues: { ':at': atMs, ':null': null },
          }),
        );
      } catch (e) {
        if (e instanceof ConditionalCheckFailedException) return; // missing or already revoked
        throw e;
      }
    },
  };
}
```

Extend `TestStores` with `sessions: SessionsRepo; invites: InvitesRepo` and export both repos from `src/index.ts`.

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `pnpm nx run-many -t test lint typecheck -p api-data-access-persistence`
Expected: PASS, including the race test (exactly one winner).

- [ ] **Step 5: Commit**

```bash
git add libs/api/data-access-persistence
git commit -m "feat(api-data-access-persistence): sessions repo with optimistic concurrency and invites repo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `api-feature-templates`, templates router

**Files:**
- Create: `libs/api/feature-templates/src/lib/templates-router.ts`
- Test: `libs/api/feature-templates/src/lib/templates-router.spec.ts`
- Modify: `libs/api/feature-templates/src/index.ts`, `package.json`, vitest config (globalSetup)

**Interfaces:**
- Consumes: `interviewerProcedures`, `Clock`, `IdGenerator`, `Identity` (Task 3); `TemplatesRepo`, `BlobStore`, `blobKeys`, `TemplateRecord`, `StaleWriteError` (Tasks 4–5); `Template`, `TemplateSummary`, `BoardSeed` from `@swint/shared-api-contract`
- Produces:

```ts
export interface TemplatesDeps { templates: TemplatesRepo; blobs: BlobStore; clock: Clock; newId: IdGenerator }
export function createTemplatesRouter(deps: TemplatesDeps): { list; get; getSeed; create; update; archive } // implemented contract.templates procedures
export function toTemplate(rec: TemplateRecord): Template
```

- [ ] **Step 1: Declare dependencies and test setup**

In `libs/api/feature-templates/package.json` `dependencies`:
- `@swint/api-util-rpc`, `@swint/api-data-access-persistence`, `@swint/shared-api-contract` (all `workspace:*`)
- `@orpc/server`

Run `pnpm install && pnpm nx sync`. In this library's vitest config `test` block:

```ts
globalSetup: ['../../../libs/api/data-access-persistence/src/testing/global-setup.ts'],
hookTimeout: 120_000,
testTimeout: 30_000,
```

(Adjust the relative path to this library's location. It must point at the persistence library's `src/testing/global-setup.ts`.)

- [ ] **Step 2: Write the failing tests**

`libs/api/feature-templates/src/lib/templates-router.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createRouterClient } from '@orpc/server';
import type { Identity } from '@swint/api-util-rpc';
import { createTestStores } from '@swint/api-data-access-persistence/testing';
import { createTemplatesRouter } from './templates-router.js';

const interviewer = (orgId = 'default'): Identity => ({
  kind: 'interviewer',
  sub: 'sub-1',
  name: 'Ada',
  email: null,
  orgId,
  roles: ['interviewer'],
});

async function setup() {
  const stores = await createTestStores();
  let t = 1_000;
  let n = 0;
  const router = createTemplatesRouter({
    templates: stores.templates,
    blobs: stores.blobs,
    clock: { now: () => (t += 10) },
    newId: () => `id-${++n}`,
  });
  const as = (identity: Identity | null) =>
    createRouterClient({ templates: router }, { context: { identity, requestId: 't' } }).templates;
  return { stores, as };
}

const input = {
  title: 'URL shortener',
  instructionsMd: '# Design it',
  rubricMd: '- scaling',
  durationMin: 45,
  boardSeed: { elements: [{ id: 'e1', type: 'rectangle', version: 1, versionNonce: 5, index: 'a0', isDeleted: false }] },
};

describe('templates router', () => {
  it('rejects anonymous (UNAUTHORIZED) and candidates (FORBIDDEN)', async () => {
    const { as } = await setup();
    await expect(as(null).list({})).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(
      as({ kind: 'candidate', sessionId: 's', orgId: 'default', inviteHash: 'h', name: 'Bo' }).list({}),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('creates, gets and returns the starting board', async () => {
    const { as } = await setup();
    const created = await as(interviewer()).create(input);
    expect(created).toMatchObject({
      id: 'id-1',
      title: 'URL shortener',
      hasBoardSeed: true,
      archived: false,
      createdBy: 'sub-1',
    });
    await expect(as(interviewer()).get({ id: created.id })).resolves.toEqual(created);
    await expect(as(interviewer()).getSeed({ id: created.id })).resolves.toEqual(input.boardSeed);
  });

  it('getSeed returns an empty board when the template has none', async () => {
    const { as } = await setup();
    const created = await as(interviewer()).create({ ...input, boardSeed: null });
    expect(created.hasBoardSeed).toBe(false);
    await expect(as(interviewer()).getSeed({ id: created.id })).resolves.toEqual({ elements: [] });
  });

  it('isolates orgs: another org gets NOT_FOUND', async () => {
    const { as } = await setup();
    const created = await as(interviewer()).create(input);
    await expect(as(interviewer('other-org')).get({ id: created.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(as(interviewer('other-org')).list({})).resolves.toEqual([]);
  });

  it('update with boardSeed null keeps the starting board; a new seed is written to a new key', async () => {
    const { stores, as } = await setup();
    const created = await as(interviewer()).create(input);
    const before = await stores.templates.get('default', created.id);
    const updated = await as(interviewer()).update({ id: created.id, ...input, title: 'Renamed', boardSeed: null });
    expect(updated).toMatchObject({ title: 'Renamed', hasBoardSeed: true });
    expect((await stores.templates.get('default', created.id))?.boardSeedKey).toBe(before?.boardSeedKey);
    await as(interviewer()).update({ id: created.id, ...input, boardSeed: { elements: [] } });
    expect((await stores.templates.get('default', created.id))?.boardSeedKey).not.toBe(before?.boardSeedKey);
    expect(updated.updatedAt).toBeGreaterThan(created.updatedAt);
  });

  it('archive hides from the default list but includeArchived shows it', async () => {
    const { as } = await setup();
    const a = await as(interviewer()).create({ ...input, title: 'A' });
    await as(interviewer()).create({ ...input, title: 'B' });
    await expect(as(interviewer()).archive({ id: a.id })).resolves.toMatchObject({ archived: true });
    expect((await as(interviewer()).list({})).map((t) => t.title)).toEqual(['B']);
    expect((await as(interviewer()).list({ includeArchived: false })).map((t) => t.title)).toEqual(['B']);
    expect((await as(interviewer()).list({ includeArchived: true })).map((t) => t.title)).toEqual(['A', 'B']);
  });

  it('update/archive of a missing template is NOT_FOUND', async () => {
    const { as } = await setup();
    await expect(as(interviewer()).update({ id: 'nope', ...input })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(as(interviewer()).archive({ id: 'nope' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `pnpm nx test api-feature-templates`
Expected: FAIL, because `./templates-router.js` cannot be resolved.

- [ ] **Step 4: Implement**

`libs/api/feature-templates/src/lib/templates-router.ts`:

```ts
import { ORPCError } from '@orpc/server';
import type { BoardSeed, Template, TemplateSummary } from '@swint/shared-api-contract';
import {
  blobKeys,
  StaleWriteError,
  type BlobStore,
  type TemplateRecord,
  type TemplatesRepo,
} from '@swint/api-data-access-persistence';
import { interviewerProcedures, type Clock, type IdGenerator } from '@swint/api-util-rpc';

export interface TemplatesDeps {
  templates: TemplatesRepo;
  blobs: BlobStore;
  clock: Clock;
  newId: IdGenerator;
}

export function toTemplate(rec: TemplateRecord): Template {
  return {
    id: rec.id,
    title: rec.title,
    instructionsMd: rec.instructionsMd,
    rubricMd: rec.rubricMd,
    durationMin: rec.durationMin,
    hasBoardSeed: rec.boardSeedKey !== null,
    archived: rec.archived,
    createdBy: rec.createdBy,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}

const toSummary = (rec: TemplateRecord): TemplateSummary => ({
  id: rec.id,
  title: rec.title,
  durationMin: rec.durationMin,
  archived: rec.archived,
  updatedAt: rec.updatedAt,
});

export function createTemplatesRouter(deps: TemplatesDeps) {
  const p = interviewerProcedures.templates;

  async function load(orgId: string, id: string): Promise<TemplateRecord> {
    const rec = await deps.templates.get(orgId, id);
    if (!rec) throw new ORPCError('NOT_FOUND');
    return rec;
  }

  async function writeSeed(orgId: string, templateId: string, seed: BoardSeed): Promise<string> {
    const key = blobKeys.templateSeed(orgId, templateId, deps.newId());
    await deps.blobs.putJson(key, seed);
    return key;
  }

  async function save(rec: TemplateRecord): Promise<TemplateRecord> {
    try {
      await deps.templates.update(rec);
      return rec;
    } catch (e) {
      if (e instanceof StaleWriteError) throw new ORPCError('NOT_FOUND');
      throw e;
    }
  }

  return {
    list: p.list.handler(async ({ input, context }) => {
      const recs = await deps.templates.listByOrg(context.interviewer.orgId, {
        includeArchived: input.includeArchived ?? false,
      });
      return recs.map(toSummary);
    }),

    get: p.get.handler(async ({ input, context }) => toTemplate(await load(context.interviewer.orgId, input.id))),

    getSeed: p.getSeed.handler(async ({ input, context }) => {
      const rec = await load(context.interviewer.orgId, input.id);
      if (!rec.boardSeedKey) return { elements: [] };
      return (await deps.blobs.getJson<BoardSeed>(rec.boardSeedKey)) ?? { elements: [] };
    }),

    create: p.create.handler(async ({ input, context }) => {
      const { orgId, sub } = context.interviewer;
      const id = deps.newId();
      const now = deps.clock.now();
      const rec: TemplateRecord = {
        id,
        orgId,
        title: input.title,
        instructionsMd: input.instructionsMd,
        rubricMd: input.rubricMd,
        durationMin: input.durationMin,
        boardSeedKey: input.boardSeed ? await writeSeed(orgId, id, input.boardSeed) : null,
        archived: false,
        createdBy: sub,
        createdAt: now,
        updatedAt: now,
      };
      await deps.templates.create(rec);
      return toTemplate(rec);
    }),

    update: p.update.handler(async ({ input, context }) => {
      const { orgId } = context.interviewer;
      const current = await load(orgId, input.id);
      const next: TemplateRecord = {
        ...current,
        title: input.title,
        instructionsMd: input.instructionsMd,
        rubricMd: input.rubricMd,
        durationMin: input.durationMin,
        boardSeedKey: input.boardSeed ? await writeSeed(orgId, current.id, input.boardSeed) : current.boardSeedKey,
        updatedAt: deps.clock.now(),
      };
      return toTemplate(await save(next));
    }),

    archive: p.archive.handler(async ({ input, context }) => {
      const current = await load(context.interviewer.orgId, input.id);
      return toTemplate(await save({ ...current, archived: true, updatedAt: deps.clock.now() }));
    }),
  };
}
```

Note: `newId()` is called once for the template id and once per seed write. The tests rely only on the first id being `id-1`.

`libs/api/feature-templates/src/index.ts`:

```ts
export * from './lib/templates-router.js';
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `pnpm nx run-many -t test lint typecheck -p api-feature-templates`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libs/api/feature-templates pnpm-lock.yaml
git commit -m "feat(api-feature-templates): templates router with org isolation and board seeds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `api-feature-sessions`: mappers, initial board, events, and the list/get/create procedures

**Files:**
- Create: `libs/api/feature-sessions/src/lib/session-events.ts`, `mappers.ts`, `initial-board.ts`, `sessions-router.ts`
- Test: `libs/api/feature-sessions/src/lib/initial-board.spec.ts`, `sessions-router.spec.ts`
- Modify: `libs/api/feature-sessions/src/index.ts`, `package.json`, vitest config (globalSetup as in Task 7)

**Interfaces:**
- Consumes: Tasks 3–7; `initialLifecycle` from `@swint/shared-domain`; `getBoardElements`, `SyncedElement` from `@swint/shared-collab-protocol`; `yjs`
- Produces:

```ts
export interface SessionEvents { sessionChanged(session: SessionRecord): void | Promise<void> }
export const noopSessionEvents: SessionEvents;
export function toSession(rec: SessionRecord): Session;
export function toSessionSummary(rec: SessionRecord): SessionSummary;
export function buildInitialBoardUpdate(seed: BoardSeed): Uint8Array;   // Y.encodeStateAsUpdate of a doc whose board map holds the seed
export interface SessionsDeps {
  sessions: SessionsRepo; invites: InvitesRepo; templates: TemplatesRepo; blobs: BlobStore;
  clock: Clock; newId: IdGenerator; newToken: () => string; publicBaseUrl: string; events: SessionEvents;
}
export function createSessionsRouter(deps: SessionsDeps): { list; get; create; start; extend; end; cancel; regenerateInvite }
```

Candidate URL: `${publicBaseUrl}/join/${token}`. Interviewer URL: `${publicBaseUrl}/s/${sessionId}`.

This task implements `list`, `get` and `create`. Task 9 adds the command procedures. To keep the router typed against the full contract group now, define `start`, `extend`, `end`, `cancel` and `regenerateInvite` in this task as handlers that throw `new ORPCError('NOT_IMPLEMENTED')`. Task 9 replaces them.

- [ ] **Step 1: Declare dependencies and test setup**

`libs/api/feature-sessions/package.json` `dependencies`:
- `@swint/api-util-rpc`, `@swint/api-data-access-persistence`, `@swint/shared-api-contract`, `@swint/shared-domain`, `@swint/shared-collab-protocol` (all `workspace:*`)
- `@orpc/server`, `yjs`

Run `pnpm install && pnpm nx sync`. Add the same vitest `globalSetup` / timeouts as in Task 7 Step 1.

- [ ] **Step 2: Write the failing tests**

`libs/api/feature-sessions/src/lib/initial-board.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { getBoardElements } from '@swint/shared-collab-protocol';
import { buildInitialBoardUpdate } from './initial-board.js';

describe('buildInitialBoardUpdate', () => {
  it('encodes the seed elements into the board map', () => {
    const update = buildInitialBoardUpdate({
      elements: [
        { id: 'e1', type: 'rectangle', version: 3, versionNonce: 9, index: 'a0', isDeleted: false, x: 1 },
        { id: 'e2', type: 'text' },
      ],
    });
    const doc = new Y.Doc();
    Y.applyUpdate(doc, update);
    const board = getBoardElements(doc);
    expect(board.get('e1')).toMatchObject({ id: 'e1', version: 3, versionNonce: 9, index: 'a0', x: 1 });
    // missing sync fields get safe defaults
    expect(board.get('e2')).toMatchObject({ id: 'e2', version: 1, versionNonce: 0, index: null, isDeleted: false });
  });

  it('an empty seed yields a decodable empty board', () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, buildInitialBoardUpdate({ elements: [] }));
    expect(getBoardElements(doc).size).toBe(0);
  });
});
```

`libs/api/feature-sessions/src/lib/sessions-router.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createRouterClient } from '@orpc/server';
import { getBoardElements } from '@swint/shared-collab-protocol';
import type { Identity } from '@swint/api-util-rpc';
import { sha256Hex } from '@swint/api-util-rpc';
import { blobKeys } from '@swint/api-data-access-persistence';
import { createTestStores } from '@swint/api-data-access-persistence/testing';
import { createSessionsRouter } from './sessions-router.js';

const interviewer = (orgId = 'default', sub = 'sub-1'): Identity => ({
  kind: 'interviewer',
  sub,
  name: 'Ada',
  email: null,
  orgId,
  roles: ['interviewer'],
});
const candidate: Identity = { kind: 'candidate', sessionId: 'x', orgId: 'default', inviteHash: 'h', name: 'Bo' };

export async function setupSessions() {
  const stores = await createTestStores();
  let t = 10_000;
  let n = 0;
  let tok = 0;
  const events = { sessionChanged: vi.fn() };
  const router = createSessionsRouter({
    sessions: stores.sessions,
    invites: stores.invites,
    templates: stores.templates,
    blobs: stores.blobs,
    clock: { now: () => (t += 1_000) },
    newId: () => `id-${++n}`,
    newToken: () => `token-${++tok}`,
    publicBaseUrl: 'http://localhost:4200',
    events,
  });
  const as = (identity: Identity | null) =>
    createRouterClient({ sessions: router }, { context: { identity, requestId: 't' } }).sessions;
  await stores.templates.create({
    id: 'tpl-1',
    orgId: 'default',
    title: 'URL shortener',
    instructionsMd: '# Go',
    rubricMd: '- scaling',
    durationMin: 45,
    boardSeedKey: 'seeds/tpl-1.json',
    archived: false,
    createdBy: 'sub-1',
    createdAt: 1,
    updatedAt: 1,
  });
  await stores.blobs.putJson('seeds/tpl-1.json', {
    elements: [{ id: 'e1', type: 'rectangle', version: 2, versionNonce: 4, index: 'a0', isDeleted: false }],
  });
  return { stores, as, events };
}

describe('sessions router: access', () => {
  it('every procedure rejects candidates with FORBIDDEN and anonymous with UNAUTHORIZED', async () => {
    const { as } = await setupSessions();
    const calls = (c: ReturnType<typeof as>) => [
      () => c.list({}),
      () => c.get({ id: 'x' }),
      () => c.create({ templateId: 'tpl-1', candidateName: 'Bo' }),
      () => c.start({ id: 'x' }),
      () => c.extend({ id: 'x', minutes: 5 }),
      () => c.end({ id: 'x' }),
      () => c.cancel({ id: 'x' }),
      () => c.regenerateInvite({ id: 'x' }),
    ];
    for (const call of calls(as(candidate))) await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    for (const call of calls(as(null))) await expect(call()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('sessions router: create / get / list', () => {
  it('create snapshots the template, stores a hashed invite, seeds the board and returns links', async () => {
    const { stores, as } = await setupSessions();
    const out = await as(interviewer()).create({ templateId: 'tpl-1', candidateName: 'Bo' });
    expect(out.candidateUrl).toBe('http://localhost:4200/join/token-1');
    expect(out.interviewerUrl).toBe(`http://localhost:4200/s/${out.session.id}`);
    expect(out.session).toMatchObject({
      title: 'URL shortener',
      candidateName: 'Bo',
      status: 'created',
      startedAt: null,
      durationSec: 2700,
      extensionSec: 0,
      instructionsMd: '# Go',
      rubricMd: '- scaling',
      createdBy: 'sub-1',
    });

    const invite = await stores.invites.get(sha256Hex('token-1'));
    expect(invite).toMatchObject({ sessionId: out.session.id, orgId: 'default', revokedAt: null });
    expect(await stores.invites.get('token-1')).toBeNull(); // raw token never stored

    const bytes = await stores.blobs.getBytes(blobKeys.sessionBoardLatest('default', out.session.id));
    const doc = new Y.Doc();
    Y.applyUpdate(doc, bytes!);
    expect(getBoardElements(doc).get('e1')).toMatchObject({ id: 'e1', version: 2 });
  });

  it('editing the template afterwards does not change the session (snapshot)', async () => {
    const { stores, as } = await setupSessions();
    const out = await as(interviewer()).create({ templateId: 'tpl-1', candidateName: 'Bo' });
    const tpl = (await stores.templates.get('default', 'tpl-1'))!;
    await stores.templates.update({ ...tpl, instructionsMd: 'CHANGED' });
    await expect(as(interviewer()).get({ id: out.session.id })).resolves.toMatchObject({ instructionsMd: '# Go' });
  });

  it('create from a missing, foreign or archived template fails', async () => {
    const { stores, as } = await setupSessions();
    await expect(as(interviewer()).create({ templateId: 'nope', candidateName: 'Bo' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      as(interviewer('other-org')).create({ templateId: 'tpl-1', candidateName: 'Bo' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const tpl = (await stores.templates.get('default', 'tpl-1'))!;
    await stores.templates.update({ ...tpl, archived: true });
    await expect(as(interviewer()).create({ templateId: 'tpl-1', candidateName: 'Bo' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('get and list are org-scoped; list filters by status, newest first', async () => {
    const { as } = await setupSessions();
    const a = await as(interviewer()).create({ templateId: 'tpl-1', candidateName: 'A' });
    const b = await as(interviewer()).create({ templateId: 'tpl-1', candidateName: 'B' });
    expect((await as(interviewer()).list({})).map((s) => s.candidateName)).toEqual(['B', 'A']);
    expect(await as(interviewer()).list({ status: 'live' })).toEqual([]);
    await expect(as(interviewer('other-org')).get({ id: a.session.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await as(interviewer('other-org')).list({})).toEqual([]);
    expect(b.session.id).not.toBe(a.session.id);
  });
});
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `pnpm nx test api-feature-sessions`
Expected: FAIL, because the modules cannot be resolved.

- [ ] **Step 4: Implement**

`libs/api/feature-sessions/src/lib/session-events.ts`:

```ts
import type { SessionRecord } from '@swint/api-data-access-persistence';

/** Notified after every successful lifecycle change. Plan 3 broadcasts session.state to collaborators. */
export interface SessionEvents {
  sessionChanged(session: SessionRecord): void | Promise<void>;
}

export const noopSessionEvents: SessionEvents = { sessionChanged: () => undefined };
```

`libs/api/feature-sessions/src/lib/mappers.ts`:

```ts
import type { Session, SessionSummary } from '@swint/shared-api-contract';
import type { SessionRecord } from '@swint/api-data-access-persistence';

export function toSession(rec: SessionRecord): Session {
  return {
    id: rec.id,
    title: rec.templateSnapshot.title,
    candidateName: rec.candidateName,
    status: rec.status,
    startedAt: rec.startedAt,
    durationSec: rec.durationSec,
    extensionSec: rec.extensionSec,
    endedAt: rec.endedAt,
    endedBy: rec.endedBy,
    cancelReason: rec.cancelReason,
    instructionsMd: rec.templateSnapshot.instructionsMd,
    rubricMd: rec.templateSnapshot.rubricMd,
    createdBy: rec.createdBy,
    createdAt: rec.createdAt,
  };
}

export function toSessionSummary(rec: SessionRecord): SessionSummary {
  return {
    id: rec.id,
    title: rec.templateSnapshot.title,
    candidateName: rec.candidateName,
    status: rec.status,
    startedAt: rec.startedAt,
    createdAt: rec.createdAt,
  };
}
```

`libs/api/feature-sessions/src/lib/initial-board.ts`:

```ts
import * as Y from 'yjs';
import type { BoardSeed } from '@swint/shared-api-contract';
import { getBoardElements, type SyncedElement } from '@swint/shared-collab-protocol';

function toSynced(raw: Record<string, unknown> & { id: string }): SyncedElement {
  return {
    ...raw,
    id: raw.id,
    version: typeof raw['version'] === 'number' ? raw['version'] : 1,
    versionNonce: typeof raw['versionNonce'] === 'number' ? raw['versionNonce'] : 0,
    index: typeof raw['index'] === 'string' ? raw['index'] : null,
    isDeleted: raw['isDeleted'] === true,
  };
}

export function buildInitialBoardUpdate(seed: BoardSeed): Uint8Array {
  const doc = new Y.Doc();
  const board = getBoardElements(doc);
  doc.transact(() => {
    for (const element of seed.elements) board.set(element.id, toSynced(element));
  });
  return Y.encodeStateAsUpdate(doc);
}
```

`libs/api/feature-sessions/src/lib/sessions-router.ts` (list/get/create real; commands stubbed until Task 9):

```ts
import { ORPCError } from '@orpc/server';
import type { BoardSeed } from '@swint/shared-api-contract';
import { initialLifecycle } from '@swint/shared-domain';
import {
  blobKeys,
  type BlobStore,
  type InvitesRepo,
  type SessionRecord,
  type SessionsRepo,
  type TemplatesRepo,
} from '@swint/api-data-access-persistence';
import { interviewerProcedures, sha256Hex, type Clock, type IdGenerator } from '@swint/api-util-rpc';
import { buildInitialBoardUpdate } from './initial-board.js';
import { toSession, toSessionSummary } from './mappers.js';
import type { SessionEvents } from './session-events.js';

export interface SessionsDeps {
  sessions: SessionsRepo;
  invites: InvitesRepo;
  templates: TemplatesRepo;
  blobs: BlobStore;
  clock: Clock;
  newId: IdGenerator;
  /** Returns a fresh raw invite token (only its sha256 is stored). */
  newToken: () => string;
  /** Public origin of the web app, e.g. http://localhost:4200 */
  publicBaseUrl: string;
  events: SessionEvents;
}

export function createSessionsRouter(deps: SessionsDeps) {
  const p = interviewerProcedures.sessions;

  async function load(orgId: string, id: string): Promise<SessionRecord> {
    const rec = await deps.sessions.get(orgId, id);
    if (!rec) throw new ORPCError('NOT_FOUND');
    return rec;
  }

  async function issueInvite(orgId: string, sessionId: string): Promise<{ hash: string; candidateUrl: string }> {
    const token = deps.newToken();
    const hash = sha256Hex(token);
    await deps.invites.create({ hash, orgId, sessionId, createdAt: deps.clock.now(), revokedAt: null });
    return { hash, candidateUrl: `${deps.publicBaseUrl}/join/${token}` };
  }

  const notImplemented = () => {
    throw new ORPCError('NOT_IMPLEMENTED');
  };

  return {
    list: p.list.handler(async ({ input, context }) =>
      (await deps.sessions.listByOrg(context.interviewer.orgId, { status: input.status })).map(toSessionSummary),
    ),

    get: p.get.handler(async ({ input, context }) => toSession(await load(context.interviewer.orgId, input.id))),

    create: p.create.handler(async ({ input, context }) => {
      const { orgId, sub } = context.interviewer;
      const template = await deps.templates.get(orgId, input.templateId);
      if (!template) throw new ORPCError('NOT_FOUND');
      if (template.archived) throw new ORPCError('BAD_REQUEST', { message: 'Template is archived' });

      const id = deps.newId();
      const seed = template.boardSeedKey ? await deps.blobs.getJson<BoardSeed>(template.boardSeedKey) : null;
      await deps.blobs.putBytes(
        blobKeys.sessionBoardLatest(orgId, id),
        buildInitialBoardUpdate(seed ?? { elements: [] }),
      );

      const invite = await issueInvite(orgId, id);
      const rec: SessionRecord = {
        id,
        orgId,
        templateId: template.id,
        templateSnapshot: {
          title: template.title,
          instructionsMd: template.instructionsMd,
          rubricMd: template.rubricMd,
          durationMin: template.durationMin,
          boardSeedKey: template.boardSeedKey,
        },
        candidateName: input.candidateName,
        ...initialLifecycle(template.durationMin * 60),
        activeInviteHash: invite.hash,
        createdBy: sub,
        createdAt: deps.clock.now(),
        version: 1,
      };
      await deps.sessions.create(rec);
      return {
        session: toSession(rec),
        candidateUrl: invite.candidateUrl,
        interviewerUrl: `${deps.publicBaseUrl}/s/${id}`,
      };
    }),

    start: p.start.handler(notImplemented),
    extend: p.extend.handler(notImplemented),
    end: p.end.handler(notImplemented),
    cancel: p.cancel.handler(notImplemented),
    regenerateInvite: p.regenerateInvite.handler(notImplemented),
  };
}
```

`libs/api/feature-sessions/src/index.ts`:

```ts
export * from './lib/session-events.js';
export * from './lib/mappers.js';
export * from './lib/initial-board.js';
export * from './lib/sessions-router.js';
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `pnpm nx run-many -t test lint typecheck -p api-feature-sessions`
Expected: PASS, because the access test only checks the auth middleware, which runs before the stub handlers.

- [ ] **Step 6: Commit**

```bash
git add libs/api/feature-sessions pnpm-lock.yaml
git commit -m "feat(api-feature-sessions): create/get/list with template snapshot, hashed invites and seeded board

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: `api-feature-sessions`: lifecycle commands, invite regeneration and the room router

**Files:**
- Modify: `libs/api/feature-sessions/src/lib/sessions-router.ts`, `mappers.ts`, `src/index.ts`
- Create: `libs/api/feature-sessions/src/lib/room-router.ts`
- Test: `libs/api/feature-sessions/src/lib/sessions-commands.spec.ts`, `room-router.spec.ts`

**Interfaces:**
- Consumes: `applyCommand`, `InvalidTransitionError`, `isFinished`, `SessionCommand` from `@swint/shared-domain`; `StaleWriteError`; `base` from `@swint/api-util-rpc`
- Produces:

```ts
export function toRoomView(rec: SessionRecord, identity: Identity): RoomView
export interface RoomDeps { sessions: SessionsRepo }
export function createRoomRouter(deps: RoomDeps): { get }   // implemented contract.room procedures
```

Command semantics:
1. Load the session for the caller's org (`NOT_FOUND` otherwise).
2. Run `applyCommand(state, command, { now, actorId: interviewer.sub })`. `InvalidTransitionError` → `CONFLICT`.
3. Call `sessions.update(next, rec.version)`. `StaleWriteError` → `CONFLICT`.
4. Call `events.sessionChanged(stored)`.
5. Return `toSession(stored)`.

`cancel` stores `cancelReason` from the (already normalised) input. `regenerateInvite` returns `CONFLICT` once the session is finished. Otherwise it revokes the active invite, issues a new one and updates `activeInviteHash` via `update(..., version)`.

Room semantics:
- No identity → `UNAUTHORIZED`.
- Interviewer → the session from their org (`NOT_FOUND` otherwise) as the interviewer view.
- Candidate: if `identity.sessionId !== input.sessionId` → `FORBIDDEN`. Otherwise load the session with `identity.orgId`.
  - finished → `FORBIDDEN` with `data: { reason: 'session_ended' }`
  - otherwise → the candidate view, with `instructionsMd: null` while `created`

- [ ] **Step 1: Write the failing tests**

Move the `setupSessions` helper from `sessions-router.spec.ts` into `libs/api/feature-sessions/src/lib/test-setup.ts`, unchanged, and import it from both spec files. `test-setup.ts` is test-only and must not be exported from `index.ts`. Then add:

`libs/api/feature-sessions/src/lib/sessions-commands.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Identity } from '@swint/api-util-rpc';
import { sha256Hex } from '@swint/api-util-rpc';
import { setupSessions } from './test-setup.js';

const ada: Identity = { kind: 'interviewer', sub: 'sub-1', name: 'Ada', email: null, orgId: 'default', roles: ['interviewer'] };
const grace: Identity = { ...ada, sub: 'sub-2', name: 'Grace' };

async function created() {
  const ctx = await setupSessions();
  const out = await ctx.as(ada).create({ templateId: 'tpl-1', candidateName: 'Bo' });
  return { ...ctx, id: out.session.id };
}

describe('lifecycle commands', () => {
  it('start → extend → end, emitting sessionChanged each time', async () => {
    const { as, id, events } = await created();
    const started = await as(ada).start({ id });
    expect(started).toMatchObject({ status: 'live' });
    expect(started.startedAt).toEqual(expect.any(Number));
    await expect(as(ada).extend({ id, minutes: 10 })).resolves.toMatchObject({ extensionSec: 600 });
    await expect(as(grace).end({ id })).resolves.toMatchObject({ status: 'ended', endedBy: 'sub-2' });
    expect(events.sessionChanged).toHaveBeenCalledTimes(3);
    expect(events.sessionChanged.mock.calls.at(-1)?.[0]).toMatchObject({ id, status: 'ended', version: 4 });
  });

  it('cancel stores the reason, or null when absent', async () => {
    const a = await created();
    await expect(a.as(ada).cancel({ id: a.id, reason: 'no-show' })).resolves.toMatchObject({
      status: 'cancelled',
      cancelReason: 'no-show',
    });
    const b = await created();
    await expect(b.as(ada).cancel({ id: b.id })).resolves.toMatchObject({ status: 'cancelled', cancelReason: null });
  });

  it('invalid transitions are CONFLICT and do not emit events', async () => {
    const { as, id, events } = await created();
    await expect(as(ada).end({ id })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(as(ada).extend({ id, minutes: 5 })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(events.sessionChanged).not.toHaveBeenCalled();
  });

  it('two interviewers ending at once: exactly one succeeds, the other gets CONFLICT', async () => {
    const { as, id } = await created();
    await as(ada).start({ id });
    const results = await Promise.allSettled([as(ada).end({ id }), as(grace).end({ id })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('commands on another org session are NOT_FOUND', async () => {
    const { as, id } = await created();
    await expect(as({ ...ada, orgId: 'other-org' }).start({ id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('regenerateInvite', () => {
  it('revokes the old invite and issues a new one', async () => {
    const { as, id, stores } = await created(); // first token was token-1
    const { candidateUrl } = await as(ada).regenerateInvite({ id });
    expect(candidateUrl).toBe('http://localhost:4200/join/token-2');
    await expect(stores.invites.get(sha256Hex('token-1'))).resolves.toMatchObject({ revokedAt: expect.any(Number) });
    await expect(stores.invites.get(sha256Hex('token-2'))).resolves.toMatchObject({ revokedAt: null, sessionId: id });
    await expect(stores.sessions.get('default', id)).resolves.toMatchObject({ activeInviteHash: sha256Hex('token-2') });
  });

  it('is CONFLICT once the session is finished', async () => {
    const { as, id } = await created();
    await as(ada).cancel({ id });
    await expect(as(ada).regenerateInvite({ id })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
```

`libs/api/feature-sessions/src/lib/room-router.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createRouterClient } from '@orpc/server';
import type { Identity } from '@swint/api-util-rpc';
import { createRoomRouter } from './room-router.js';
import { setupSessions } from './test-setup.js';

const ada: Identity = { kind: 'interviewer', sub: 'sub-1', name: 'Ada', email: null, orgId: 'default', roles: ['interviewer'] };

async function setup() {
  const ctx = await setupSessions();
  const out = await ctx.as(ada).create({ templateId: 'tpl-1', candidateName: 'Bo' });
  const id = out.session.id;
  const room = (identity: Identity | null) =>
    createRouterClient({ room: createRoomRouter({ sessions: ctx.stores.sessions }) }, {
      context: { identity, requestId: 't' },
    }).room;
  const cand: Identity = { kind: 'candidate', sessionId: id, orgId: 'default', inviteHash: 'h', name: 'Bo' };
  return { ...ctx, id, room, cand };
}

describe('room.get', () => {
  it('anonymous is UNAUTHORIZED', async () => {
    const { room, id } = await setup();
    await expect(room(null).get({ sessionId: id })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('interviewer view includes rubric and candidate name', async () => {
    const { room, id } = await setup();
    await expect(room(ada).get({ sessionId: id })).resolves.toMatchObject({
      role: 'interviewer',
      sessionId: id,
      rubricMd: '- scaling',
      candidateName: 'Bo',
      instructionsMd: '# Go',
      me: { name: 'Ada', sub: 'sub-1' },
    });
  });

  it('candidate sees the waiting room (no instructions) before start, and never the rubric', async () => {
    const { room, id, cand } = await setup();
    const view = await room(cand).get({ sessionId: id });
    expect(view).toMatchObject({ role: 'candidate', status: 'created', instructionsMd: null, me: { name: 'Bo' } });
    expect(view).not.toHaveProperty('rubricMd');
    expect(view).not.toHaveProperty('cancelReason');
  });

  it('candidate sees instructions once live', async () => {
    const { room, id, cand, as } = await setup();
    await as(ada).start({ id });
    await expect(room(cand).get({ sessionId: id })).resolves.toMatchObject({ status: 'live', instructionsMd: '# Go' });
  });

  it('candidate of another session is FORBIDDEN', async () => {
    const { room, id, cand } = await setup();
    await expect(room({ ...cand, sessionId: 'other' }).get({ sessionId: id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('candidate after the session finished is FORBIDDEN with reason session_ended', async () => {
    const { room, id, cand, as } = await setup();
    await as(ada).cancel({ id, reason: 'secret reason' });
    await expect(room(cand).get({ sessionId: id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      data: { reason: 'session_ended' },
    });
  });

  it('interviewer of another org is NOT_FOUND', async () => {
    const { room, id } = await setup();
    await expect(room({ ...ada, orgId: 'other-org' }).get({ sessionId: id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
```

Note: the candidate-view privacy check relies on output validation. `createRouterClient` validates outputs against the contract. If the stripped keys still appear (the client skips output parsing), make `toRoomView` build the candidate view with **only** the candidate fields. The test must pass either way.

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm nx test api-feature-sessions`
Expected: FAIL, with `NOT_IMPLEMENTED` for commands and `./room-router.js` missing.

- [ ] **Step 3: Implement the commands**

In `sessions-router.ts`:
- add the imports `applyCommand`, `InvalidTransitionError`, `isFinished`, `type SessionCommand` from `@swint/shared-domain`
- add `StaleWriteError` from persistence
- add `type InterviewerIdentity` from `@swint/api-util-rpc`
- replace the five stubs:

```ts
  async function runCommand(interviewer: InterviewerIdentity, id: string, command: SessionCommand) {
    const rec = await load(interviewer.orgId, id);
    let next: SessionRecord;
    try {
      next = { ...rec, ...applyCommand(rec, command, { now: deps.clock.now(), actorId: interviewer.sub }) };
    } catch (e) {
      if (e instanceof InvalidTransitionError) throw new ORPCError('CONFLICT', { message: e.message });
      throw e;
    }
    let stored: SessionRecord;
    try {
      stored = await deps.sessions.update(next, rec.version);
    } catch (e) {
      if (e instanceof StaleWriteError) throw new ORPCError('CONFLICT', { message: 'Session changed, retry' });
      throw e;
    }
    await deps.events.sessionChanged(stored);
    return toSession(stored);
  }
```

```ts
    start: p.start.handler(({ input, context }) => runCommand(context.interviewer, input.id, { type: 'start' })),
    extend: p.extend.handler(({ input, context }) =>
      runCommand(context.interviewer, input.id, { type: 'extend', minutes: input.minutes }),
    ),
    end: p.end.handler(({ input, context }) => runCommand(context.interviewer, input.id, { type: 'end' })),
    cancel: p.cancel.handler(({ input, context }) =>
      runCommand(context.interviewer, input.id, { type: 'cancel', reason: input.reason }),
    ),
    regenerateInvite: p.regenerateInvite.handler(async ({ input, context }) => {
      const rec = await load(context.interviewer.orgId, input.id);
      if (isFinished(rec.status)) throw new ORPCError('CONFLICT', { message: 'Session is finished' });
      const invite = await issueInvite(rec.orgId, rec.id);
      try {
        await deps.sessions.update({ ...rec, activeInviteHash: invite.hash }, rec.version);
      } catch (e) {
        await deps.invites.revoke(invite.hash, deps.clock.now());
        if (e instanceof StaleWriteError) throw new ORPCError('CONFLICT', { message: 'Session changed, retry' });
        throw e;
      }
      await deps.invites.revoke(rec.activeInviteHash, deps.clock.now());
      return { candidateUrl: invite.candidateUrl };
    }),
```

Remove the `notImplemented` helper. `applyCommand` receives the record (structurally a `SessionLifecycleState` plus more fields). Spreading its result over `rec` keeps the non-lifecycle fields.

- [ ] **Step 4: Implement the room router**

Add to `mappers.ts`:

```ts
import type { RoomView } from '@swint/shared-api-contract';
import type { Identity } from '@swint/api-util-rpc';

export function toRoomView(rec: SessionRecord, identity: Identity): RoomView {
  const common = {
    sessionId: rec.id,
    title: rec.templateSnapshot.title,
    status: rec.status,
    timer: { startedAt: rec.startedAt, durationSec: rec.durationSec, extensionSec: rec.extensionSec },
  };
  if (identity.kind === 'interviewer') {
    return {
      ...common,
      role: 'interviewer',
      instructionsMd: rec.templateSnapshot.instructionsMd,
      rubricMd: rec.templateSnapshot.rubricMd,
      candidateName: rec.candidateName,
      me: { name: identity.name, sub: identity.sub },
    };
  }
  return {
    ...common,
    role: 'candidate',
    instructionsMd: rec.status === 'created' ? null : rec.templateSnapshot.instructionsMd,
    me: { name: rec.candidateName },
  };
}
```

`libs/api/feature-sessions/src/lib/room-router.ts`:

```ts
import { ORPCError } from '@orpc/server';
import { isFinished } from '@swint/shared-domain';
import { INTERVIEWER_ROLE, base } from '@swint/api-util-rpc';
import type { SessionsRepo } from '@swint/api-data-access-persistence';
import { toRoomView } from './mappers.js';

export interface RoomDeps {
  sessions: SessionsRepo;
}

export function createRoomRouter(deps: RoomDeps) {
  return {
    get: base.room.get.handler(async ({ input, context }) => {
      const identity = context.identity;
      if (!identity) throw new ORPCError('UNAUTHORIZED');

      if (identity.kind === 'interviewer') {
        if (!identity.roles.includes(INTERVIEWER_ROLE)) throw new ORPCError('FORBIDDEN');
        const rec = await deps.sessions.get(identity.orgId, input.sessionId);
        if (!rec) throw new ORPCError('NOT_FOUND');
        return toRoomView(rec, identity);
      }

      if (identity.sessionId !== input.sessionId) throw new ORPCError('FORBIDDEN');
      const rec = await deps.sessions.get(identity.orgId, input.sessionId);
      if (!rec) throw new ORPCError('FORBIDDEN');
      if (isFinished(rec.status)) throw new ORPCError('FORBIDDEN', { data: { reason: 'session_ended' } });
      return toRoomView(rec, identity);
    }),
  };
}
```

Add `export * from './lib/room-router.js';` to `src/index.ts`. Add `@swint/api-util-rpc` to dependencies if it isn't already there.

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `pnpm nx run-many -t test lint typecheck -p api-feature-sessions`
Expected: PASS, including the concurrent-end test.

- [ ] **Step 6: Commit**

```bash
git add libs/api/feature-sessions
git commit -m "feat(api-feature-sessions): lifecycle commands, invite regeneration and room views

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: `api-feature-auth`: cookies, identity resolver and the candidate join route

**Files:**
- Create: `libs/api/feature-auth/src/lib/cookies.ts`, `identity-resolver.ts`, `join-route.ts`
- Test: `libs/api/feature-auth/src/lib/identity-resolver.spec.ts`, `join-route.spec.ts`
- Modify: `libs/api/feature-auth/src/index.ts`, `package.json`, vitest config (globalSetup as in Task 7)

**Interfaces:**
- Consumes: `Identity`, `sha256Hex`, `Clock` (Task 3); `AuthSessionsRepo`, `InvitesRepo`, `SessionsRepo` (Tasks 5–6); `isFinished`
- Produces:

```ts
export const COOKIE = { session: 'swint_sid', candidate: 'swint_cand', oidc: 'swint_oidc' } as const;
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const OIDC_STATE_TTL_MS = 10 * 60 * 1000;
export function cookieOptions(opts: { secure: boolean; maxAgeMs?: number }): CookieSerializeOptions;
export interface CandidateCookie { sessionId: string; inviteHash: string; exp: number }
export function readSignedJson<T>(request: FastifyRequest, name: string): T | null;
export function readSignedValue(request: FastifyRequest, name: string): string | null;
export interface IdentityResolverDeps { authSessions: AuthSessionsRepo; invites: InvitesRepo; sessions: SessionsRepo; clock: Clock }
export type IdentityResolver = (request: FastifyRequest) => Promise<Identity | null>;
export function createIdentityResolver(deps: IdentityResolverDeps): IdentityResolver;
export interface JoinRouteDeps { invites: InvitesRepo; sessions: SessionsRepo; clock: Clock; secureCookies: boolean }
export function registerJoinRoute(app: FastifyInstance, deps: JoinRouteDeps): void;
```

Behaviour:
- **Resolver:**
  - A valid `swint_sid` (signed) → `authSessions.get(sha256Hex(sid), now)` → interviewer identity. This takes precedence.
  - Otherwise a valid `swint_cand` (signed JSON, `exp > now`) whose invite exists, isn't revoked and matches `sessionId` → candidate identity. The candidate's `name` comes from the session record.
  - Otherwise `null`.
  - Finished sessions are **not** rejected here (see the ruling in Global Constraints).
- **Join route (`GET /join/:token`):**
  - Look up the invite by `sha256Hex(token)`.
  - Valid, not revoked, and session not finished → set `swint_cand` (12 h) and `302` to `/s/{sessionId}`.
  - Revoked or missing invite → `302` to `/link-invalid?reason=invite_revoked`.
  - Finished session → `302` to `/link-invalid?reason=session_ended`.
  - Plan 4 renders `/link-invalid` (outside `/join/*`, so the dev proxy never forwards it to the API).

- [ ] **Step 1: Declare dependencies and test setup**

`libs/api/feature-auth/package.json` `dependencies`:
- `@swint/api-util-rpc`, `@swint/api-data-access-persistence`, `@swint/shared-domain`, `@swint/shared-api-contract` (all `workspace:*`)
- `fastify`, `@fastify/cookie`, `openid-client`, `@orpc/server`

Run `pnpm install && pnpm nx sync`. Add the vitest `globalSetup` / timeouts as in Task 7. Set `"types": ["node"]` in `tsconfig.lib.json` if it isn't already.

- [ ] **Step 2: Write the failing tests**

`libs/api/feature-auth/src/lib/identity-resolver.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { sha256Hex } from '@swint/api-util-rpc';
import { createTestStores } from '@swint/api-data-access-persistence/testing';
import type { SessionRecord } from '@swint/api-data-access-persistence';
import { COOKIE } from './cookies.js';
import { createIdentityResolver } from './identity-resolver.js';

const SECRET = 'test-cookie-secret-that-is-long-enough-123';
const NOW = 1_700_000_000_000;

async function setup() {
  const stores = await createTestStores();
  const resolve = createIdentityResolver({
    authSessions: stores.authSessions,
    invites: stores.invites,
    sessions: stores.sessions,
    clock: { now: () => NOW },
  });
  const app = Fastify();
  await app.register(cookie, { secret: SECRET });
  app.get('/whoami', async (req) => ({ identity: await resolve(req) }));
  await app.ready();
  const session: SessionRecord = {
    id: 's1',
    orgId: 'default',
    templateId: 't1',
    templateSnapshot: { title: 'T', instructionsMd: '', rubricMd: '', durationMin: 45, boardSeedKey: null },
    candidateName: 'Bo',
    status: 'created',
    startedAt: null,
    durationSec: 2700,
    extensionSec: 0,
    endedAt: null,
    endedBy: null,
    cancelReason: null,
    activeInviteHash: 'inv-hash',
    createdBy: 'sub-1',
    createdAt: 1,
    version: 1,
  };
  await stores.sessions.create(session);
  await stores.invites.create({ hash: 'inv-hash', orgId: 'default', sessionId: 's1', createdAt: 1, revokedAt: null });
  const whoami = async (cookies: Record<string, string>) =>
    (await app.inject({ method: 'GET', url: '/whoami', cookies })).json().identity;
  return { stores, app, whoami };
}

describe('identity resolver', () => {
  it('no cookies → null', async () => {
    const { whoami } = await setup();
    expect(await whoami({})).toBeNull();
  });

  it('valid interviewer session cookie → interviewer identity', async () => {
    const { stores, app, whoami } = await setup();
    await stores.authSessions.create({
      idHash: sha256Hex('sid-1'),
      userSub: 'sub-1',
      orgId: 'default',
      name: 'Ada',
      email: 'a@x.io',
      roles: ['interviewer'],
      idToken: 'jwt',
      expiresAt: NOW / 1000 + 3600,
    });
    expect(await whoami({ [COOKIE.session]: app.signCookie('sid-1') })).toEqual({
      kind: 'interviewer',
      sub: 'sub-1',
      name: 'Ada',
      email: 'a@x.io',
      orgId: 'default',
      roles: ['interviewer'],
    });
  });

  it('unsigned / tampered / expired session cookie → null', async () => {
    const { stores, app, whoami } = await setup();
    await stores.authSessions.create({
      idHash: sha256Hex('sid-old'),
      userSub: 'sub-1',
      orgId: 'default',
      name: 'Ada',
      email: null,
      roles: ['interviewer'],
      idToken: 'jwt',
      expiresAt: NOW / 1000 - 1,
    });
    expect(await whoami({ [COOKIE.session]: 'sid-old' })).toBeNull();
    expect(await whoami({ [COOKIE.session]: app.signCookie('sid-old') })).toBeNull();
    expect(await whoami({ [COOKIE.session]: app.signCookie('unknown') })).toBeNull();
  });

  it('valid candidate cookie → candidate identity with the session candidate name', async () => {
    const { app, whoami } = await setup();
    const value = app.signCookie(JSON.stringify({ sessionId: 's1', inviteHash: 'inv-hash', exp: NOW + 1000 }));
    expect(await whoami({ [COOKIE.candidate]: value })).toEqual({
      kind: 'candidate',
      sessionId: 's1',
      orgId: 'default',
      inviteHash: 'inv-hash',
      name: 'Bo',
    });
  });

  it('candidate cookie: expired, revoked invite, or mismatched session → null', async () => {
    const { stores, app, whoami } = await setup();
    const sign = (o: object) => app.signCookie(JSON.stringify(o));
    expect(await whoami({ [COOKIE.candidate]: sign({ sessionId: 's1', inviteHash: 'inv-hash', exp: NOW - 1 }) })).toBeNull();
    expect(
      await whoami({ [COOKIE.candidate]: sign({ sessionId: 'other', inviteHash: 'inv-hash', exp: NOW + 1 }) }),
    ).toBeNull();
    await stores.invites.revoke('inv-hash', NOW);
    expect(
      await whoami({ [COOKIE.candidate]: sign({ sessionId: 's1', inviteHash: 'inv-hash', exp: NOW + 1 }) }),
    ).toBeNull();
  });
});
```

`libs/api/feature-auth/src/lib/join-route.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { sha256Hex } from '@swint/api-util-rpc';
import { createTestStores } from '@swint/api-data-access-persistence/testing';
import type { SessionRecord } from '@swint/api-data-access-persistence';
import { COOKIE } from './cookies.js';
import { registerJoinRoute } from './join-route.js';

const SECRET = 'test-cookie-secret-that-is-long-enough-123';
const NOW = 1_700_000_000_000;

async function setup(status: SessionRecord['status'] = 'created') {
  const stores = await createTestStores();
  const app = Fastify();
  await app.register(cookie, { secret: SECRET });
  registerJoinRoute(app, { invites: stores.invites, sessions: stores.sessions, clock: { now: () => NOW }, secureCookies: false });
  await app.ready();
  await stores.sessions.create({
    id: 's1',
    orgId: 'default',
    templateId: 't1',
    templateSnapshot: { title: 'T', instructionsMd: '', rubricMd: '', durationMin: 45, boardSeedKey: null },
    candidateName: 'Bo',
    status,
    startedAt: null,
    durationSec: 2700,
    extensionSec: 0,
    endedAt: null,
    endedBy: null,
    cancelReason: null,
    activeInviteHash: sha256Hex('tok'),
    createdBy: 'sub-1',
    createdAt: 1,
    version: 1,
  });
  await stores.invites.create({ hash: sha256Hex('tok'), orgId: 'default', sessionId: 's1', createdAt: 1, revokedAt: null });
  return { stores, app };
}

describe('GET /join/:token', () => {
  it('valid token → signed httpOnly candidate cookie and redirect to the room', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/join/tok' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/s/s1');
    const c = res.cookies.find((x) => x.name === COOKIE.candidate)!;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe('Lax');
    expect(c.path).toBe('/');
    const unsigned = app.unsignCookie(c.value);
    expect(unsigned.valid).toBe(true);
    expect(JSON.parse(unsigned.value!)).toEqual({ sessionId: 's1', inviteHash: sha256Hex('tok'), exp: NOW + 12 * 3600_000 });
  });

  it('unknown or revoked token → invalid page with invite_revoked', async () => {
    const { app, stores } = await setup();
    const unknown = await app.inject({ method: 'GET', url: '/join/nope' });
    expect(unknown.headers.location).toBe('/link-invalid?reason=invite_revoked');
    await stores.invites.revoke(sha256Hex('tok'), NOW);
    const revoked = await app.inject({ method: 'GET', url: '/join/tok' });
    expect(revoked.headers.location).toBe('/link-invalid?reason=invite_revoked');
    expect(revoked.cookies.find((x) => x.name === COOKIE.candidate)).toBeUndefined();
  });

  it('finished session → invalid page with session_ended', async () => {
    const { app } = await setup('ended');
    const res = await app.inject({ method: 'GET', url: '/join/tok' });
    expect(res.headers.location).toBe('/link-invalid?reason=session_ended');
  });
});
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `pnpm nx test api-feature-auth`
Expected: FAIL, because the modules cannot be resolved.

- [ ] **Step 4: Implement**

`libs/api/feature-auth/src/lib/cookies.ts`:

```ts
import type { FastifyRequest } from 'fastify';
import type { CookieSerializeOptions } from '@fastify/cookie';

export const COOKIE = { session: 'swint_sid', candidate: 'swint_cand', oidc: 'swint_oidc' } as const;
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const OIDC_STATE_TTL_MS = 10 * 60 * 1000;

export interface CandidateCookie {
  sessionId: string;
  inviteHash: string;
  exp: number;
}

export function cookieOptions(opts: { secure: boolean; maxAgeMs?: number }): CookieSerializeOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: opts.secure,
    signed: true,
    ...(opts.maxAgeMs !== undefined ? { maxAge: Math.floor(opts.maxAgeMs / 1000) } : {}),
  };
}

export function readSignedValue(request: FastifyRequest, name: string): string | null {
  const raw = request.cookies[name];
  if (!raw) return null;
  const result = request.unsignCookie(raw);
  return result.valid ? result.value : null;
}

export function readSignedJson<T>(request: FastifyRequest, name: string): T | null {
  const value = readSignedValue(request, name);
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
```

`libs/api/feature-auth/src/lib/identity-resolver.ts`:

```ts
import type { FastifyRequest } from 'fastify';
import type { AuthSessionsRepo, InvitesRepo, SessionsRepo } from '@swint/api-data-access-persistence';
import { sha256Hex, type Clock, type Identity } from '@swint/api-util-rpc';
import { COOKIE, readSignedJson, readSignedValue, type CandidateCookie } from './cookies.js';

export interface IdentityResolverDeps {
  authSessions: AuthSessionsRepo;
  invites: InvitesRepo;
  sessions: SessionsRepo;
  clock: Clock;
}

export type IdentityResolver = (request: FastifyRequest) => Promise<Identity | null>;

export function createIdentityResolver(deps: IdentityResolverDeps): IdentityResolver {
  return async (request) => {
    const now = deps.clock.now();

    const sid = readSignedValue(request, COOKIE.session);
    if (sid) {
      const auth = await deps.authSessions.get(sha256Hex(sid), now);
      if (auth) {
        return {
          kind: 'interviewer',
          sub: auth.userSub,
          name: auth.name,
          email: auth.email,
          orgId: auth.orgId,
          roles: auth.roles,
        };
      }
    }

    const cand = readSignedJson<CandidateCookie>(request, COOKIE.candidate);
    if (cand && typeof cand.exp === 'number' && cand.exp > now) {
      const invite = await deps.invites.get(cand.inviteHash);
      if (invite && invite.revokedAt === null && invite.sessionId === cand.sessionId) {
        const session = await deps.sessions.get(invite.orgId, invite.sessionId);
        if (session) {
          return {
            kind: 'candidate',
            sessionId: session.id,
            orgId: session.orgId,
            inviteHash: invite.hash,
            name: session.candidateName,
          };
        }
      }
    }

    return null;
  };
}
```

`libs/api/feature-auth/src/lib/join-route.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { isFinished } from '@swint/shared-domain';
import type { InvitesRepo, SessionsRepo } from '@swint/api-data-access-persistence';
import { sha256Hex, type Clock } from '@swint/api-util-rpc';
import { COOKIE, cookieOptions, SESSION_TTL_MS, type CandidateCookie } from './cookies.js';

export interface JoinRouteDeps {
  invites: InvitesRepo;
  sessions: SessionsRepo;
  clock: Clock;
  secureCookies: boolean;
}

export function registerJoinRoute(app: FastifyInstance, deps: JoinRouteDeps): void {
  app.get<{ Params: { token: string } }>('/join/:token', async (request, reply) => {
    const hash = sha256Hex(request.params.token);
    const invite = await deps.invites.get(hash);
    if (!invite || invite.revokedAt !== null) return reply.redirect('/link-invalid?reason=invite_revoked', 302);
    const session = await deps.sessions.get(invite.orgId, invite.sessionId);
    if (!session) return reply.redirect('/link-invalid?reason=invite_revoked', 302);
    if (isFinished(session.status)) return reply.redirect('/link-invalid?reason=session_ended', 302);

    const payload: CandidateCookie = { sessionId: session.id, inviteHash: hash, exp: deps.clock.now() + SESSION_TTL_MS };
    reply.setCookie(COOKIE.candidate, JSON.stringify(payload), cookieOptions({ secure: deps.secureCookies, maxAgeMs: SESSION_TTL_MS }));
    return reply.redirect(`/s/${session.id}`, 302);
  });
}
```

If Fastify 5's `reply.redirect` takes `(url, code)` in a different order, check `node_modules/fastify/types/reply.d.ts` and follow it.

`libs/api/feature-auth/src/index.ts`:

```ts
export * from './lib/cookies.js';
export * from './lib/identity-resolver.js';
export * from './lib/join-route.js';
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `pnpm nx run-many -t test lint typecheck -p api-feature-auth`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libs/api/feature-auth pnpm-lock.yaml
git commit -m "feat(api-feature-auth): signed cookies, identity resolver and candidate join route

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: `api-feature-auth`: OIDC login, callback and logout, plus `me.get`

**Files:**
- Create: `libs/api/feature-auth/src/lib/oidc.ts`, `auth-routes.ts`, `me-router.ts`
- Test: `libs/api/feature-auth/src/lib/auth-routes.spec.ts`, `me-router.spec.ts`
- Modify: `libs/api/feature-auth/src/index.ts`

**Interfaces:**
- Produces:

```ts
export interface OidcClaims { sub: string; name?: string; preferred_username?: string; email?: string; roles?: unknown }
export interface OidcClient {
  /** Builds the authorization URL; the caller stores state + verifier. */
  createAuthorization(): Promise<{ url: URL; state: string; verifier: string }>;
  /** Exchanges the callback URL for tokens, validating state + PKCE. */
  exchange(callbackUrl: URL, expected: { state: string; verifier: string }): Promise<{ claims: OidcClaims; idToken: string }>;
  endSessionUrl(idToken: string): Promise<URL>;
}
export interface OidcSettings { issuer: string; clientId: string; clientSecret: string; redirectUri: string; postLogoutRedirectUri: string; allowInsecureHttp: boolean }
export function createOidcClient(settings: OidcSettings): OidcClient;   // openid-client v6, lazy + retrying discovery
export interface AuthRoutesDeps {
  oidc: OidcClient; users: UsersRepo; authSessions: AuthSessionsRepo; clock: Clock;
  publicBaseUrl: string; secureCookies: boolean; defaultOrgId: string;
}
export function registerAuthRoutes(app: FastifyInstance, deps: AuthRoutesDeps): void;
export function createMeRouter(): { get };  // implemented contract.me procedures
```

Route behaviour:
- **`GET /auth/login?returnTo=/path`**
  - `returnTo` must start with `/` and not `//`; otherwise use `/`.
  - Set `swint_oidc` (signed JSON `{ state, verifier, returnTo }`, 10 min) and `302` to the authorization URL.
- **`GET /auth/callback`**
  - Read and clear `swint_oidc`. If it's missing or invalid → `400` text `Login expired, please try again`.
  - Call `exchange(new URL(request.url, publicBaseUrl), { state, verifier })`. If it throws → `400` text `Login failed`.
  - `roles = Array.isArray(claims.roles) ? claims.roles.filter(isString) : []`. If the user lacks `interviewer` → `403` text `You are not allowed to use Swint`.
  - Upsert the user:
    - `name = claims.name ?? claims.preferred_username ?? claims.sub`
    - `orgId = defaultOrgId`
    - `email = claims.email ?? null`
  - Create an auth session: `sid = randomToken()`, stored by `sha256Hex(sid)`, `expiresAt` = now + 12 h **in seconds**, `idToken`.
  - Set `swint_sid` (12 h) and `302` to `returnTo`.
- **`POST /auth/logout`**
  - If there's a valid `swint_sid`: read the auth session, delete it, clear the cookie, and respond `200 { redirectUrl }` with the Keycloak end-session URL.
  - Otherwise clear the cookie and respond `200 { redirectUrl: '/' }`.

- [ ] **Step 1: Write the failing tests**

`libs/api/feature-auth/src/lib/auth-routes.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { sha256Hex } from '@swint/api-util-rpc';
import { createTestStores } from '@swint/api-data-access-persistence/testing';
import { COOKIE } from './cookies.js';
import { registerAuthRoutes } from './auth-routes.js';
import type { OidcClaims, OidcClient } from './oidc.js';

const SECRET = 'test-cookie-secret-that-is-long-enough-123';
const NOW = 1_700_000_000_000;

function fakeOidc(claims: OidcClaims, opts: { failExchange?: boolean } = {}): OidcClient & { exchanged: unknown[] } {
  const exchanged: unknown[] = [];
  return {
    exchanged,
    async createAuthorization() {
      return { url: new URL('http://idp.test/auth?client_id=swint-api'), state: 'st-1', verifier: 'ver-1' };
    },
    async exchange(url, expected) {
      exchanged.push({ url: url.toString(), expected });
      if (opts.failExchange) throw new Error('bad code');
      return { claims, idToken: 'id-token-1' };
    },
    async endSessionUrl(idToken) {
      return new URL(`http://idp.test/logout?id_token_hint=${idToken}`);
    },
  };
}

async function setup(claims: OidcClaims, opts: { failExchange?: boolean } = {}) {
  const stores = await createTestStores();
  const oidc = fakeOidc(claims, opts);
  const app = Fastify();
  await app.register(cookie, { secret: SECRET });
  registerAuthRoutes(app, {
    oidc,
    users: stores.users,
    authSessions: stores.authSessions,
    clock: { now: () => NOW },
    publicBaseUrl: 'http://localhost:4200',
    secureCookies: false,
    defaultOrgId: 'default',
  });
  await app.ready();
  return { app, stores, oidc };
}

const okClaims: OidcClaims = { sub: 'kc-1', name: 'Ada Interviewer', email: 'ada@example.com', roles: ['interviewer'] };

async function loginCookie(app: Awaited<ReturnType<typeof setup>>['app'], returnTo = '/sessions') {
  const res = await app.inject({ method: 'GET', url: `/auth/login?returnTo=${encodeURIComponent(returnTo)}` });
  return { res, oidcCookie: res.cookies.find((c) => c.name === COOKIE.oidc)! };
}

describe('auth routes', () => {
  it('login stores state+verifier in a signed cookie and redirects to the IdP', async () => {
    const { app } = await setup(okClaims);
    const { res, oidcCookie } = await loginCookie(app);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('http://idp.test/auth?client_id=swint-api');
    expect(JSON.parse(app.unsignCookie(oidcCookie.value).value!)).toEqual({
      state: 'st-1',
      verifier: 'ver-1',
      returnTo: '/sessions',
    });
  });

  it.each(['//evil.com', 'https://evil.com', 'nope'])('login sanitises returnTo %s to /', async (bad) => {
    const { app } = await setup(okClaims);
    const { oidcCookie } = await loginCookie(app, bad);
    expect(JSON.parse(app.unsignCookie(oidcCookie.value).value!).returnTo).toBe('/');
  });

  it('callback creates the user + auth session, sets swint_sid and redirects to returnTo', async () => {
    const { app, stores, oidc } = await setup(okClaims);
    const { oidcCookie } = await loginCookie(app, '/sessions');
    const res = await app.inject({
      method: 'GET',
      url: '/auth/callback?code=abc&state=st-1',
      cookies: { [COOKIE.oidc]: oidcCookie.value },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/sessions');
    expect(oidc.exchanged[0]).toEqual({
      url: 'http://localhost:4200/auth/callback?code=abc&state=st-1',
      expected: { state: 'st-1', verifier: 'ver-1' },
    });
    const sid = app.unsignCookie(res.cookies.find((c) => c.name === COOKIE.session)!.value).value!;
    await expect(stores.authSessions.get(sha256Hex(sid), NOW)).resolves.toMatchObject({
      userSub: 'kc-1',
      orgId: 'default',
      roles: ['interviewer'],
      idToken: 'id-token-1',
      expiresAt: (NOW + 12 * 3600_000) / 1000,
    });
    await expect(stores.users.get('kc-1')).resolves.toMatchObject({ name: 'Ada Interviewer', email: 'ada@example.com' });
    expect(res.cookies.find((c) => c.name === COOKIE.oidc)?.value).toBe('');
  });

  it('callback without the oidc cookie is 400', async () => {
    const { app } = await setup(okClaims);
    const res = await app.inject({ method: 'GET', url: '/auth/callback?code=abc&state=st-1' });
    expect(res.statusCode).toBe(400);
  });

  it('callback with a failing exchange is 400', async () => {
    const { app } = await setup(okClaims, { failExchange: true });
    const { oidcCookie } = await loginCookie(app);
    const res = await app.inject({ method: 'GET', url: '/auth/callback?code=x&state=st-1', cookies: { [COOKIE.oidc]: oidcCookie.value } });
    expect(res.statusCode).toBe(400);
  });

  it('callback for a user without the interviewer role is 403 and creates no session', async () => {
    const { app, stores } = await setup({ ...okClaims, roles: ['something-else'] });
    const { oidcCookie } = await loginCookie(app);
    const res = await app.inject({ method: 'GET', url: '/auth/callback?code=x&state=st-1', cookies: { [COOKIE.oidc]: oidcCookie.value } });
    expect(res.statusCode).toBe(403);
    expect(res.cookies.find((c) => c.name === COOKIE.session)).toBeUndefined();
    await expect(stores.users.get('kc-1')).resolves.toBeNull();
  });

  it('logout deletes the auth session, clears the cookie and returns the IdP logout URL', async () => {
    const { app, stores } = await setup(okClaims);
    const { oidcCookie } = await loginCookie(app);
    const cb = await app.inject({ method: 'GET', url: '/auth/callback?code=x&state=st-1', cookies: { [COOKIE.oidc]: oidcCookie.value } });
    const sidCookie = cb.cookies.find((c) => c.name === COOKIE.session)!.value;
    const sid = app.unsignCookie(sidCookie).value!;
    const res = await app.inject({ method: 'POST', url: '/auth/logout', cookies: { [COOKIE.session]: sidCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ redirectUrl: 'http://idp.test/logout?id_token_hint=id-token-1' });
    expect(res.cookies.find((c) => c.name === COOKIE.session)?.value).toBe('');
    await expect(stores.authSessions.get(sha256Hex(sid), NOW)).resolves.toBeNull();
  });

  it('logout without a session returns redirectUrl /', async () => {
    const { app } = await setup(okClaims);
    const res = await app.inject({ method: 'POST', url: '/auth/logout' });
    expect(res.json()).toEqual({ redirectUrl: '/' });
  });
});
```

`libs/api/feature-auth/src/lib/me-router.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createRouterClient } from '@orpc/server';
import type { Identity } from '@swint/api-util-rpc';
import { createMeRouter } from './me-router.js';

const client = (identity: Identity | null) =>
  createRouterClient({ me: createMeRouter() }, { context: { identity, requestId: 't' } }).me;

describe('me.get', () => {
  it('returns the interviewer profile', async () => {
    await expect(
      client({ kind: 'interviewer', sub: 's', name: 'Ada', email: null, orgId: 'default', roles: ['interviewer'] }).get(),
    ).resolves.toEqual({ sub: 's', name: 'Ada', email: null, orgId: 'default', roles: ['interviewer'] });
  });
  it('rejects candidates and anonymous', async () => {
    await expect(client(null).get()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(
      client({ kind: 'candidate', sessionId: 'x', orgId: 'default', inviteHash: 'h', name: 'Bo' }).get(),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm nx test api-feature-auth`
Expected: FAIL, because the modules cannot be resolved.

- [ ] **Step 3: Implement the OIDC client**

`libs/api/feature-auth/src/lib/oidc.ts`:

```ts
import * as client from 'openid-client';

export interface OidcClaims {
  sub: string;
  name?: string;
  preferred_username?: string;
  email?: string;
  roles?: unknown;
}

export interface OidcClient {
  createAuthorization(): Promise<{ url: URL; state: string; verifier: string }>;
  exchange(callbackUrl: URL, expected: { state: string; verifier: string }): Promise<{ claims: OidcClaims; idToken: string }>;
  endSessionUrl(idToken: string): Promise<URL>;
}

export interface OidcSettings {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
  /** true only for local http Keycloak */
  allowInsecureHttp: boolean;
}

export function createOidcClient(settings: OidcSettings): OidcClient {
  let configPromise: Promise<client.Configuration> | null = null;

  /** Lazy discovery: Keycloak may still be starting when the API boots. Failed attempts are retried on next use. */
  function config(): Promise<client.Configuration> {
    if (!configPromise) {
      configPromise = client
        .discovery(
          new URL(settings.issuer),
          settings.clientId,
          settings.clientSecret,
          undefined,
          settings.allowInsecureHttp ? { execute: [client.allowInsecureRequests] } : undefined,
        )
        .catch((e) => {
          configPromise = null;
          throw e;
        });
    }
    return configPromise;
  }

  return {
    async createAuthorization() {
      const cfg = await config();
      const verifier = client.randomPKCECodeVerifier();
      const state = client.randomState();
      const url = client.buildAuthorizationUrl(cfg, {
        redirect_uri: settings.redirectUri,
        scope: 'openid profile email',
        code_challenge: await client.calculatePKCECodeChallenge(verifier),
        code_challenge_method: 'S256',
        state,
      });
      return { url, state, verifier };
    },
    async exchange(callbackUrl, expected) {
      const cfg = await config();
      const tokens = await client.authorizationCodeGrant(cfg, callbackUrl, {
        pkceCodeVerifier: expected.verifier,
        expectedState: expected.state,
      });
      const claims = tokens.claims();
      if (!claims || !tokens.id_token) throw new Error('No ID token in response');
      return { claims: claims as unknown as OidcClaims, idToken: tokens.id_token };
    },
    async endSessionUrl(idToken) {
      const cfg = await config();
      return client.buildEndSessionUrl(cfg, {
        id_token_hint: idToken,
        post_logout_redirect_uri: settings.postLogoutRedirectUri,
      });
    },
  };
}
```

If an `openid-client` 6.8.9 signature differs (for example the `discovery` options position), check `node_modules/openid-client/build/index.d.ts` and adapt the call. Keep the `OidcClient` interface unchanged.

- [ ] **Step 4: Implement the routes and `me.get`**

`libs/api/feature-auth/src/lib/auth-routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { AuthSessionsRepo, UsersRepo } from '@swint/api-data-access-persistence';
import { INTERVIEWER_ROLE, randomToken, sha256Hex, type Clock } from '@swint/api-util-rpc';
import {
  COOKIE,
  cookieOptions,
  OIDC_STATE_TTL_MS,
  readSignedJson,
  readSignedValue,
  SESSION_TTL_MS,
} from './cookies.js';
import type { OidcClient } from './oidc.js';

export interface AuthRoutesDeps {
  oidc: OidcClient;
  users: UsersRepo;
  authSessions: AuthSessionsRepo;
  clock: Clock;
  publicBaseUrl: string;
  secureCookies: boolean;
  defaultOrgId: string;
}

interface OidcStateCookie {
  state: string;
  verifier: string;
  returnTo: string;
}

const safeReturnTo = (value: unknown): string =>
  typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/';

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRoutesDeps): void {
  const clearOpts = { path: '/' };

  app.get<{ Querystring: { returnTo?: string } }>('/auth/login', async (request, reply) => {
    const { url, state, verifier } = await deps.oidc.createAuthorization();
    const payload: OidcStateCookie = { state, verifier, returnTo: safeReturnTo(request.query.returnTo) };
    reply.setCookie(COOKIE.oidc, JSON.stringify(payload), cookieOptions({ secure: deps.secureCookies, maxAgeMs: OIDC_STATE_TTL_MS }));
    return reply.redirect(url.toString(), 302);
  });

  app.get('/auth/callback', async (request, reply) => {
    const saved = readSignedJson<OidcStateCookie>(request, COOKIE.oidc);
    reply.clearCookie(COOKIE.oidc, clearOpts);
    if (!saved) return reply.code(400).type('text/plain').send('Login expired, please try again');

    let result: Awaited<ReturnType<OidcClient['exchange']>>;
    try {
      result = await deps.oidc.exchange(new URL(request.url, deps.publicBaseUrl), {
        state: saved.state,
        verifier: saved.verifier,
      });
    } catch (e) {
      request.log.warn({ err: e }, 'oidc exchange failed');
      return reply.code(400).type('text/plain').send('Login failed');
    }

    const { claims, idToken } = result;
    const roles = Array.isArray(claims.roles) ? claims.roles.filter((r): r is string => typeof r === 'string') : [];
    if (!roles.includes(INTERVIEWER_ROLE)) {
      return reply.code(403).type('text/plain').send('You are not allowed to use Swint');
    }

    const now = deps.clock.now();
    const name = claims.name ?? claims.preferred_username ?? claims.sub;
    const email = claims.email ?? null;
    await deps.users.upsert({ sub: claims.sub, orgId: deps.defaultOrgId, name, email, roles, lastLoginAt: now });

    const sid = randomToken();
    await deps.authSessions.create({
      idHash: sha256Hex(sid),
      userSub: claims.sub,
      orgId: deps.defaultOrgId,
      name,
      email,
      roles,
      idToken,
      expiresAt: Math.floor((now + SESSION_TTL_MS) / 1000),
    });
    reply.setCookie(COOKIE.session, sid, cookieOptions({ secure: deps.secureCookies, maxAgeMs: SESSION_TTL_MS }));
    return reply.redirect(saved.returnTo, 302);
  });

  app.post('/auth/logout', async (request, reply) => {
    const sid = readSignedValue(request, COOKIE.session);
    reply.clearCookie(COOKIE.session, clearOpts);
    if (!sid) return { redirectUrl: '/' };
    const idHash = sha256Hex(sid);
    const auth = await deps.authSessions.get(idHash, deps.clock.now());
    await deps.authSessions.delete(idHash);
    if (!auth) return { redirectUrl: '/' };
    try {
      return { redirectUrl: (await deps.oidc.endSessionUrl(auth.idToken)).toString() };
    } catch {
      return { redirectUrl: '/' };
    }
  });
}
```

Check: `expiresAt` in the callback test equals `(NOW + 12h) / 1000`, which is a whole number for the test `NOW`, so `Math.floor` matches.

`libs/api/feature-auth/src/lib/me-router.ts`:

```ts
import { interviewerProcedures } from '@swint/api-util-rpc';

export function createMeRouter() {
  return {
    get: interviewerProcedures.me.get.handler(({ context }) => ({
      sub: context.interviewer.sub,
      name: context.interviewer.name,
      email: context.interviewer.email,
      orgId: context.interviewer.orgId,
      roles: context.interviewer.roles,
    })),
  };
}
```

Append to `src/index.ts`:

```ts
export * from './lib/oidc.js';
export * from './lib/auth-routes.js';
export * from './lib/me-router.js';
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `pnpm nx run-many -t test lint typecheck -p api-feature-auth`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libs/api/feature-auth
git commit -m "feat(api-feature-auth): OIDC login/callback/logout with PKCE and me.get

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: `apps/api`: config, server assembly, composition root and the HTTP integration tests

**Files:**
- Create: `apps/api/src/app/config.ts`, `router.ts`, `server.ts`, `create-app.ts`
- Test: `apps/api/src/app/config.spec.ts`, `apps/api/src/app/api.integration.spec.ts`
- Modify: `apps/api/package.json` (deps), `apps/api` vitest config (globalSetup)

**Interfaces:**
- Consumes: everything above
- Produces:

```ts
export const configSchema; export type AppConfig = z.infer<typeof configSchema>;
export function loadConfig(env: NodeJS.ProcessEnv): AppConfig;   // throws with a readable message on invalid env
export function buildRouter(deps: RouterDeps): Router;             // full contract router
export interface ServerDeps { config: AppConfig; router: Router; resolveIdentity: IdentityResolver; registerRoutes: (app: FastifyInstance) => void }
export async function buildServer(deps: ServerDeps): Promise<FastifyInstance>;
export interface AppRepos { users; authSessions; templates; sessions; invites; blobs }
export async function createApp(config: AppConfig, overrides?: { oidc?: OidcClient; events?: SessionEvents }): Promise<{ server: FastifyInstance; repos: AppRepos; close(): Promise<void> }>;
```

**Config** (env var → field, with dev defaults):

| Env | Field | Default (non-production) | Rule |
|---|---|---|---|
| `NODE_ENV` | `nodeEnv` | `development` | `development \| test \| production` |
| `PORT` | `port` | `3000` | int |
| `HOST` | `host` | `0.0.0.0` | |
| `PUBLIC_BASE_URL` | `publicBaseUrl` | `http://localhost:4200` | url, no trailing slash |
| `OIDC_ISSUER` | `oidcIssuer` | `http://localhost:8080/realms/swint` | url |
| `OIDC_CLIENT_ID` | `oidcClientId` | `swint-api` | |
| `OIDC_CLIENT_SECRET` | `oidcClientSecret` | `swint-dev-secret` | required in production |
| `COOKIE_SECRET` | `cookieSecret` | `dev-only-cookie-secret-change-me-0123456789` | ≥ 32 chars; production must not use the default |
| `AWS_REGION` | `awsRegion` | `us-east-1` | |
| `DYNAMODB_ENDPOINT` | `dynamoEndpoint` | `http://localhost:8000` | optional in production |
| `S3_ENDPOINT` | `s3Endpoint` | `http://localhost:9090` | optional in production |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | `awsCredentials` | `test` / `test` when endpoints are set | |
| `TABLE_NAME` | `tableName` | `swint` | |
| `BUCKET_NAME` | `bucketName` | `swint` | |
| `DEFAULT_ORG_ID` | `defaultOrgId` | `default` | |
| `ENSURE_INFRA` | `ensureInfra` | `true` | `false` default in production |
| `LOG_LEVEL` | `logLevel` | `info` | |

- [ ] **Step 1: Declare dependencies and test setup**

`apps/api/package.json` `dependencies`:
- all six `@swint/*` api and shared libraries it imports (`workspace:*`)
- `fastify`, `@fastify/cookie`, `@orpc/server`, `@orpc/openapi`, `@orpc/zod`, `zod`, `pino`

Run `pnpm install && pnpm nx sync`. In `apps/api`'s vitest config, add the persistence `globalSetup` (relative path to `libs/api/data-access-persistence/src/testing/global-setup.ts`), `hookTimeout: 120_000` and `testTimeout: 30_000`.

- [ ] **Step 2: Write the failing tests**

`apps/api/src/app/config.spec.ts`:

```ts
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
```

`apps/api/src/app/api.integration.spec.ts`:

```ts
import { describe, expect, inject, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import '@swint/api-data-access-persistence/testing'; // ProvidedContext typings for inject()
import { sha256Hex } from '@swint/api-util-rpc';
import type { OidcClient } from '@swint/api-feature-auth';
import { COOKIE } from '@swint/api-feature-auth';
import { createApp } from './create-app.js';
import { loadConfig } from './config.js';

const fakeOidc: OidcClient = {
  createAuthorization: async () => ({ url: new URL('http://idp.test/auth'), state: 's', verifier: 'v' }),
  exchange: async () => {
    throw new Error('not used');
  },
  endSessionUrl: async () => new URL('http://idp.test/logout'),
};

async function setup() {
  const suffix = randomUUID().slice(0, 8);
  const config = loadConfig({
    NODE_ENV: 'test',
    DYNAMODB_ENDPOINT: inject('dynamoEndpoint'),
    S3_ENDPOINT: inject('s3Endpoint'),
    TABLE_NAME: `swint-it-${suffix}`,
    BUCKET_NAME: `swint-it-${suffix}`,
    LOG_LEVEL: 'silent',
  });
  const app = await createApp(config, { oidc: fakeOidc });
  const server = app.server;
  const repos = app.repos; // exposed for tests (see create-app)

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

  return { server, repos, interviewerCookie, close: app.close };
}

const templateBody = { title: 'URL shortener', instructionsMd: '# Go', rubricMd: '- scaling', durationMin: 45, boardSeed: null };

describe('API over HTTP', () => {
  it('healthz and openapi.json', async () => {
    const { server, close } = await setup();
    expect((await server.inject({ method: 'GET', url: '/healthz' })).json()).toEqual({ ok: true });
    const spec = (await server.inject({ method: 'GET', url: '/api/openapi.json' })).json();
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(['/me', '/templates', '/sessions/{id}/extend', '/room/{sessionId}']));
    await close();
  });

  it('anonymous /api/me is 401; interviewer /api/me is 200', async () => {
    const { server, interviewerCookie, close } = await setup();
    expect((await server.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(401);
    const res = await server.inject({ method: 'GET', url: '/api/me', cookies: await interviewerCookie() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ sub: 'sub-1', orgId: 'default' });
    await close();
  });

  it('full interview flow: template → session → candidate join → room → start → concurrent end → ended', async () => {
    const { server, interviewerCookie, close } = await setup();
    const ic = await interviewerCookie();

    const tpl = (await server.inject({ method: 'POST', url: '/api/templates', cookies: ic, payload: templateBody })).json();
    const archived = (
      await server.inject({ method: 'POST', url: '/api/templates', cookies: ic, payload: { ...templateBody, title: 'Old' } })
    ).json();
    await server.inject({ method: 'POST', url: `/api/templates/${archived.id}/archive`, cookies: ic });
    const listFalse = await server.inject({ method: 'GET', url: '/api/templates?includeArchived=false', cookies: ic });
    expect(listFalse.json().map((t: { title: string }) => t.title)).toEqual(['URL shortener']);
    const listTrue = await server.inject({ method: 'GET', url: '/api/templates?includeArchived=true', cookies: ic });
    expect(listTrue.json()).toHaveLength(2);

    const created = await server.inject({
      method: 'POST',
      url: '/api/sessions',
      cookies: ic,
      payload: { templateId: tpl.id, candidateName: 'Bo' },
    });
    expect(created.statusCode).toBe(200);
    const { session, candidateUrl } = created.json();
    const token = new URL(candidateUrl).pathname.split('/').pop()!;

    const join = await server.inject({ method: 'GET', url: `/join/${token}` });
    expect(join.statusCode).toBe(302);
    expect(join.headers.location).toBe(`/s/${session.id}`);
    const cc = { [COOKIE.candidate]: join.cookies.find((c) => c.name === COOKIE.candidate)!.value };

    const waiting = await server.inject({ method: 'GET', url: `/api/room/${session.id}`, cookies: cc });
    expect(waiting.statusCode).toBe(200);
    expect(waiting.json()).toMatchObject({ role: 'candidate', status: 'created', instructionsMd: null });
    expect(waiting.json()).not.toHaveProperty('rubricMd');

    // candidates can never read session details (rubric, cancel reason)
    expect((await server.inject({ method: 'GET', url: `/api/sessions/${session.id}`, cookies: cc })).statusCode).toBe(403);
    expect((await server.inject({ method: 'GET', url: '/api/templates', cookies: cc })).statusCode).toBe(403);

    expect((await server.inject({ method: 'POST', url: `/api/sessions/${session.id}/start`, cookies: ic })).statusCode).toBe(200);
    const live = (await server.inject({ method: 'GET', url: `/api/room/${session.id}`, cookies: cc })).json();
    expect(live).toMatchObject({ status: 'live', instructionsMd: '# Go' });

    const ic2 = await interviewerCookie('sub-2');
    const [a, b] = await Promise.all([
      server.inject({ method: 'POST', url: `/api/sessions/${session.id}/end`, cookies: ic }),
      server.inject({ method: 'POST', url: `/api/sessions/${session.id}/end`, cookies: ic2 }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);

    const after = await server.inject({ method: 'GET', url: `/api/room/${session.id}`, cookies: cc });
    expect(after.statusCode).toBe(403);
    expect(after.json()).toMatchObject({ data: { reason: 'session_ended' } });
    expect((await server.inject({ method: 'GET', url: `/join/${token}` })).headers.location).toBe(
      '/link-invalid?reason=session_ended',
    );
    await close();
  });

  it('org isolation over HTTP', async () => {
    const { server, interviewerCookie, close } = await setup();
    const tpl = (
      await server.inject({ method: 'POST', url: '/api/templates', cookies: await interviewerCookie(), payload: templateBody })
    ).json();
    const other = await interviewerCookie('sub-9', 'other-org');
    expect((await server.inject({ method: 'GET', url: `/api/templates/${tpl.id}`, cookies: other })).statusCode).toBe(404);
    await close();
  });

  it('validation errors are 400', async () => {
    const { server, interviewerCookie, close } = await setup();
    const res = await server.inject({
      method: 'POST',
      url: '/api/templates',
      cookies: await interviewerCookie(),
      payload: { ...templateBody, durationMin: 1 },
    });
    expect(res.statusCode).toBe(400);
    await close();
  });
});
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `pnpm nx test api`
Expected: FAIL, because the modules cannot be resolved.

- [ ] **Step 4: Implement config**

`apps/api/src/app/config.ts`:

```ts
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
```

- [ ] **Step 5: Implement the router, server and composition root**

`apps/api/src/app/router.ts`:

```ts
import { base } from '@swint/api-util-rpc';
import { createMeRouter } from '@swint/api-feature-auth';
import { createTemplatesRouter, type TemplatesDeps } from '@swint/api-feature-templates';
import { createRoomRouter, createSessionsRouter, type SessionsDeps } from '@swint/api-feature-sessions';

export type RouterDeps = TemplatesDeps & SessionsDeps;

export function buildRouter(deps: RouterDeps) {
  return base.router({
    me: createMeRouter(),
    templates: createTemplatesRouter(deps),
    sessions: createSessionsRouter(deps),
    room: createRoomRouter(deps),
  });
}

export type AppRouter = ReturnType<typeof buildRouter>;
```

`apps/api/src/app/server.ts`:

```ts
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { onError } from '@orpc/server';
import { OpenAPIHandler } from '@orpc/openapi/fastify';
import { OpenAPIGenerator } from '@orpc/openapi';
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4';
import { contract } from '@swint/shared-api-contract';
import type { IdentityResolver } from '@swint/api-feature-auth';
import type { AppConfig } from './config.js';
import type { AppRouter } from './router.js';

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
        app.log.error({ err: error }, 'rpc error');
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
```

Notes:
- `onError` logs every thrown `ORPCError`, including expected 4xx. To keep logs quiet, log only when `!(error instanceof ORPCError) || error.status >= 500`.
- Check that `@orpc/openapi/fastify` exports `OpenAPIHandler` (`node_modules/@orpc/openapi/dist/adapters/fastify`). If the subpath differs, use the documented one.

`apps/api/src/app/create-app.ts`:

```ts
import type { FastifyInstance } from 'fastify';
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
  createIdentityResolver,
  createOidcClient,
  registerAuthRoutes,
  registerJoinRoute,
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

export async function createApp(
  config: AppConfig,
  overrides: { oidc?: OidcClient; events?: SessionEvents } = {},
): Promise<{ server: FastifyInstance; repos: AppRepos; close(): Promise<void> }> {
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
    close: async () => {
      await server.close();
      raw.destroy();
      s3.destroy();
    },
  };
}
```

- [ ] **Step 6: Run the tests to confirm they pass**

Run: `pnpm nx run-many -t test lint typecheck -p api`
Expected: PASS.

Things that commonly need attention:
- **Error JSON shape.** If the 403 body shape differs (oRPC's error JSON is `{ defined, code, status, message, data }`), keep the assertion on `data.reason`. `toMatchObject` tolerates extra fields.
- **`includeArchived=false` must return only the unarchived template.** If it doesn't, check how `OpenAPIHandler` decodes query strings for `z.union([z.boolean(), z.stringbool()])`. Fix the decoding in the server (e.g. a bracket-notation or query-coercion plugin from `@orpc/openapi`), not the test.

- [ ] **Step 7: Commit**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat(api): config, Fastify server with oRPC OpenAPI handler, composition root and HTTP integration tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Process entry, graceful shutdown, smoke test against Docker Compose, and README

**Files:**
- Modify: `apps/api/src/main.ts`
- Create or modify: `README.md`

**Interfaces:**
- Consumes: `loadConfig`, `createApp` (Task 12)

- [ ] **Step 1: Implement `main.ts`**

`apps/api/src/main.ts`:

```ts
import { createApp } from './app/create-app.js';
import { loadConfig } from './app/config.js';

async function main() {
  const config = loadConfig(process.env);
  const app = await createApp(config);
  await app.server.listen({ port: config.port, host: config.host });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.server.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.server.log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Smoke test against the real infrastructure**

```bash
docker compose up -d
until curl -sf http://localhost:8080/realms/swint/.well-known/openid-configuration >/dev/null; do sleep 2; done
pnpm nx serve api &   # or run in a second terminal
until curl -sf http://localhost:3000/healthz >/dev/null; do sleep 1; done
curl -s http://localhost:3000/healthz
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/me
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' 'http://localhost:3000/auth/login?returnTo=/'
curl -s http://localhost:3000/api/openapi.json | head -c 200; echo
```

Expected:
- `{"ok":true}`
- `401` for `/api/me`
- `302 http://localhost:8080/realms/swint/protocol/openid-connect/auth?...` for the login, including `code_challenge_method=S256` and `client_id=swint-api`
- the start of an OpenAPI 3.1 JSON document

Stop the API (`kill %1`, or Ctrl+C in its terminal), check that it logs `shutting down` and exits 0, then run `docker compose down`.

A full browser login is exercised end to end in Plan 5 (Playwright). It needs the web app's `/auth/callback` proxy from Plan 4, because the redirect URI points at `http://localhost:4200`.

If `pnpm nx serve api` fails to resolve workspace libraries at runtime, make sure the `build` target depends on `^build` (the default) and that the ESM bundle from Task 1 is used. Record what you changed.

- [ ] **Step 3: Write the README's local development section**

Create `README.md` at the repo root (or add a section if it exists):

````markdown
# Swint

Collaborative system-design interviews: shared instructions + a real-time whiteboard for candidates and interviewers.

## Local development

Requirements: Node 24, pnpm 12 (see `mise.toml`), Docker.

```bash
pnpm install
docker compose up -d          # Keycloak :8080, DynamoDB Local :8000, S3Mock :9090
pnpm nx serve api             # API :3000 (creates the table and bucket on first start)
```

Test users (Keycloak realm `swint`, password `password`): `interviewer1`, `interviewer2`, `admin`.
Keycloak admin console: http://localhost:8080 (admin / admin).

Useful endpoints:
- `GET http://localhost:3000/healthz`
- `GET http://localhost:3000/api/openapi.json`

Tests (integration tests start their own containers via Testcontainers; Docker must be running):

```bash
pnpm nx run-many -t lint test typecheck
```
````

- [ ] **Step 4: Full verification**

```bash
pnpm nx run-many -t lint test typecheck build
```

Expected: every project passes. This includes the Plan 1 libraries.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/main.ts README.md
git commit -m "feat(api): process entry with graceful shutdown; README local development

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Done criteria for Plan 2

- `pnpm nx run-many -t lint test typecheck build` passes for all projects (Plan 1 + Plan 2).
- `docker compose up -d && pnpm nx serve api` serves `/healthz`, `/api/openapi.json`, a 401 on `/api/me`, and a 302 to Keycloak on `/auth/login`.
- The HTTP integration test proves:
  - candidate cookie → 403 on `/api/sessions/{id}` and `/api/templates`
  - candidate room view without `rubricMd`, and `instructionsMd: null` before start
  - concurrent `end` → exactly one 200 and one 409
  - `?includeArchived=false` excludes archived templates
  - org isolation → 404
  - a candidate after end → 403 with `reason: session_ended`, and `/join` redirects to `session_ended`
- Hand-off to Plan 3:
  - `SessionEvents.sessionChanged` is the hook for broadcasts.
  - `blobKeys.sessionBoardLatest` / `sessionBoardCheckpoint` / `sessionNotesLatest` are the S3 keys to load and store.
  - `createIdentityResolver` resolves WebSocket upgrade requests from the same cookies.
  - `createApp` returns `server`, so Plan 3 can attach Hocuspocus to `server.server`.
````
