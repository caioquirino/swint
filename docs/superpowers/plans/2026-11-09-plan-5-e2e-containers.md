# Plan 5 — End-to-End Tests, Containers and Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the whole v1 flow in a real browser against real Keycloak, ship the API and web app as containers (`docker compose --profile app up`), and close the hardening items deferred from Plans 1–4.

**Architecture:**
- **E2E:** one Playwright project, `apps/web-e2e`, runs the same suite against two targets:
  - the dev servers (Vite proxy plus `tsx watch`), which is the default;
  - the container stack (nginx plus the API image), selected with `E2E_BASE_URL=http://localhost:8088`.
- **Images:** one multi-stage root `Dockerfile` builds both images.
  - It runs `pnpm install` once.
  - `api` is the Nx-pruned API output (`nx run api:prune`) installed with `pnpm install --prod`.
  - `web` is the Vite build served by nginx, which proxies `/api`, `/auth`, `/join` and `/collab` (WebSocket) to the API.
- **Hardening:**
  - The collab WebSocket gets an Origin allowlist, ping/pong liveness, a per-socket message budget, periodic identity revalidation (this is what makes sign-out and role removal reach open sockets), and a per-document size cap.
  - Persistence gets consistent reads and prunes test-only dependencies from the production install.
  - The web app gets route-level code splitting, self-hosted Excalidraw fonts, and blocking of image/embed elements on the board.

**Tech Stack:**
- Playwright 1.65 with `@nx/playwright` 24.0.4
- Docker multi-stage builds: `node:24-bookworm-slim`, `nginx:1.29-alpine`
- Prettier 3.9.10
- `vite-plugin-static-copy` 4.1.1
- Existing: Nx 24.0.4, pnpm 12.18.0, Fastify, Hocuspocus 4.8, React 19, Vite 8, Excalidraw 0.18.1

**Spec:** `docs/superpowers/specs/2026-11-08-swint-foundation-design.md`. This plan covers:
- §8 "End-to-end" row (Playwright, two browser contexts, real Keycloak)
- §10 "profile `app`: `api`, `web` … web served by nginx, which proxies `/api`, `/auth`, `/join`, `/collab`"
- §10 "Full stack: `docker compose --profile app up --build`"
- §11 risk 3 (single process)

## Global Constraints

Every task's requirements implicitly include this section.

### Process and safety
- Never commit `.superpowers/`.
- Never disable commit signing or pass `--no-gpg-sign`. If signing fails, stop and report.
- Never push or merge.
- Don't kill processes you didn't start. The developer's `docker compose` infra (keycloak, dynamodb, s3) may already be running: reuse it.
  - Task 10 is the only exception: it recreates the `keycloak` service with `docker compose up -d --force-recreate keycloak` so the realm is re-imported. Keycloak runs `start-dev` with in-container storage, so nothing of value is lost.
- **Formatting:** from Task 1 on, run `pnpm nx format:write --uncommitted` before every commit. `pnpm nx format:check --all` must pass at the end of every task.
- **Verification:** each task ends with `pnpm nx run-many -t lint test typecheck build` exiting 0 (Docker must be running: integration tests use Testcontainers).
  - Tasks that touch e2e or containers also run the commands named in their own steps.

### Workspace conventions (unchanged from Plans 1–4)
- **Imports:** relative imports use `.js` extensions (module `nodenext`).
- **Project names:** no `@swint/` prefix (e.g. `api-collab-server`, `web-feature-session-room`). Packages are named `@swint/<project>`.
- **Dependencies:** every lib declares exactly the dependencies its non-spec code imports (`@nx/dependency-checks`). Every lib lists `tslib`.
  - Web libs run dependency-checks with `buildTargets: ["typecheck"]` plus `ignoredDependencies` for vitest and `@testing-library/*`.
- **Test-only code:** lives in `src/testing/**` and is exposed through a `./testing` subpath. It is excluded from `tsconfig.lib.json`.
- **Integration tests:** use Testcontainers via `@swint/api-data-access-persistence/testing`.
- **apps/api build:** esbuild ESM, `bundle: false`, output `apps/api/dist/main.js`. `nx run api:prune` produces:
  - `apps/api/dist/package.json`
  - `pnpm-lock.yaml`
  - `pnpm-workspace.yaml`
  - `workspace_modules/@swint/*`
- **Real-time contract:** see `libs/shared/collab-protocol/README.md`. 4403 with `session_ended` or `invite_revoked` is terminal on the client. Any other close code makes the provider reconnect.
  - After 3 failed opens the client reports `unreachable` and probes REST. A REST `UNAUTHORIZED` shows the sign-in screen.

### Exact values
| Item | Value |
|---|---|
| Prettier | `prettier@3.9.10`, `.prettierrc.json` = `{ "singleQuote": true, "printWidth": 140 }` |
| Playwright | `@playwright/test@1.65.0`, `@nx/playwright@24.0.4` |
| Static copy | `vite-plugin-static-copy@4.1.1` |
| Base images | `node:24-bookworm-slim`, `nginx:1.29-alpine` |
| pnpm in images | `pnpm@12.18.0` (installed with `npm install -g`) |
| Host ports | Keycloak `127.0.0.1:8080`, DynamoDB `127.0.0.1:8000`, S3 `127.0.0.1:9090`, dev web 4200, dev API 3000, full-stack web `127.0.0.1:8088` (nginx listens on 8080 in the container) |
| New API env | `OIDC_INTERNAL_URL` (optional URL), `COLLAB_REVALIDATE_MS` (int ≥ 1000, default `60000`) |
| Collab defaults | ping every `25000` ms; revalidate every `60000` ms; message budget `{ ratePerSec: 200, burst: 1000 }`; `MAX_DOCUMENT_BYTES = 10 * 1024 * 1024`; `MAX_PAYLOAD_BYTES` (5 MiB frames) unchanged |
| Close codes | Revalidation failure: `1008` with reason `unauthenticated`. Over budget: `1008` with reason `rate_limited`. Both are non-terminal on the client. Origin not allowed: HTTP `403` at upgrade. Unauthenticated: HTTP `401` (unchanged). |
| Allowed WS origins | `[new URL(config.publicBaseUrl).origin]`. Requests without an `Origin` header (non-browser clients) are allowed. |
| Unsupported-board toast | `Images and embeds are not supported on the shared board.` |
| not_started retry backoff | `min(pollMs * 2 ** attempt, 30000)` |
| Excalidraw font asset path | `window.EXCALIDRAW_ASSET_PATH = \`${window.location.origin}/\``; fonts served at `/fonts/**` |

### Deployment constraint (spec §11 risk 3; carried from Plan 3)
Run **exactly one API replica**. Collab documents and `sessionChanged` live in process memory. Running more replicas needs sticky routing per session plus pub/sub (Hocuspocus Redis extension). The compose file runs one `api` service with no `deploy.replicas`, and the README states this.

### Deferred (not in this plan; already recorded in memory)
- Cleaning up orphaned S3 template seeds.
- Session-read performance (fine at v1 scale).
- Multi-replica support.
- AWS deployment.

### Rulings already made in this plan
- **R1:** The WebSocket `not_started` *rejection* branch (REST says live, WS says not started) cannot be produced deterministically in a browser; it needs a race between two reads. It stays covered by `live-room.spec.tsx`. E2E covers the waiting room → live transition the user actually sees.
- **R2:** "Interviewer revocation on open sockets" is done by periodic revalidation of the upgrade cookies (Task 4), not by event fan-out from logout. One mechanism covers logout, auth-session expiry and role removal.
- **R3:** The revoked-candidate wording is fixed on the client. The browser remembers it was a candidate in that session (localStorage) and shows the invalid-link screen instead of "Sign in" on `UNAUTHORIZED`. The server cannot tell the two cases apart without leaking whether an invite existed.
- **R4:** The OIDC issuer must be reachable from inside the API container. Instead of changing Keycloak's hostname, the API rewrites backchannel requests to `OIDC_INTERNAL_URL` with openid-client's `customFetch`.
  - Browser-facing URLs (authorize, end-session) keep the public issuer origin.
  - Verified before writing this plan: `http://keycloak:8080/realms/swint/.well-known/openid-configuration` from the compose network returns issuer `http://localhost:8080/realms/swint`.
- **R5:** Test-only runtime dependencies of `api-data-access-persistence` (`testcontainers`, `vitest`) become optional peer dependencies plus devDependencies.
  - `@nx/dependency-checks` accepts `peerDependencies`.
  - `pnpm install --prod` does not install optional peers.
  - Verified before writing this plan: the current pruned install contains both packages.

---

## File Structure

```
.prettierrc.json, .prettierignore, .git-blame-ignore-revs          Task 1
.dockerignore, Dockerfile                                          Tasks 9–10
docker-compose.yml                                                 Task 10
docker/keycloak/swint-realm.json                                   Task 10
README.md                                                          Tasks 10, 12
libs/api/data-access-persistence/
  package.json                       optional peers (Task 2)
  src/lib/table.ts                   fromItem<T> (Task 2)
  src/lib/*-repo.ts                  ConsistentRead, fromItem (Task 2)
  src/lib/{table,consistent-reads}.spec.ts, aws.spec.ts, sessions-repo.spec.ts, invites-repo.spec.ts
apps/api/src/app/
  config.ts                          OIDC_INTERNAL_URL (Task 3), COLLAB_REVALIDATE_MS (Task 4)
  create-app.ts                      cleanup on startup failure (Task 3), collab options (Task 4)
  create-app.cleanup.spec.ts         Task 3
  collab-origin.integration.spec.ts  Task 4
libs/api/feature-auth/src/lib/oidc.ts, oidc.spec.ts                Task 3
libs/api/collab-server/src/lib/
  rate-limit.ts (+spec)              Task 4
  still-authorized.ts (+spec)        Task 4
  upgrade.ts (+spec)                 Task 4
  doc-size-guard.ts (+spec)          Task 5
  collab-server.ts (+spec)           Tasks 4–5
libs/api/collab-server/src/testing/collab-test-kit.ts              Task 5
libs/shared/collab-protocol/src/lib/board-validation.ts (+spec)    Task 6
libs/web/ui-whiteboard/src/lib/binding/excalidraw-binding.ts (+spec)          Task 6
libs/web/ui-whiteboard/src/lib/components/collaborative-board.{tsx,css,spec}  Task 6
apps/web/vite.config.mts, src/main.tsx, src/app/app.tsx (+spec)    Task 7
apps/web/nginx.conf                                                Task 10
libs/web/** polish                                                 Task 8
apps/web-e2e/**                                                    Tasks 11–12
nx.json, package.json                                              Tasks 1, 7, 8, 11
```

---

### Task 1: Prettier tooling and one-time workspace format

**Files:**
- Create: `.prettierrc.json`, `.prettierignore`, `.git-blame-ignore-revs`
- Modify: `package.json` (devDependency), every file Prettier reformats (separate commit)

**Interfaces:**
- Produces: `pnpm nx format:write --uncommitted` / `pnpm nx format:check --all` work for every later task.

- [ ] **Step 1: Add Prettier**

Run: `pnpm add -D -w prettier@3.9.10`

- [ ] **Step 2: Add the config files**

`.prettierrc.json`:
```json
{ "singleQuote": true, "printWidth": 140 }
```

`.prettierignore`:
```
**/dist
**/out-tsc
**/test-output
**/coverage
.nx/cache
.nx/workspace-data
pnpm-lock.yaml
docs/superpowers/
.superpowers/
.openidea/
.vscode/
.claude/
```

- [ ] **Step 3: Confirm the check fails before formatting**

Run: `pnpm nx format:check --all`
Expected: non-zero exit, listing unformatted files. This is the "failing test" for this task.

- [ ] **Step 4: Commit the tooling**

```bash
git add package.json pnpm-lock.yaml .prettierrc.json .prettierignore
git commit -m "build: add prettier 3.9.10 with workspace config"
```

- [ ] **Step 5: Format the workspace**

Run: `pnpm nx format:write --all`
Then: `pnpm nx format:check --all`. Expected: exit 0.
Then: `pnpm nx run-many -t lint test typecheck build`. Expected: exit 0. Formatting must not change behaviour; if anything fails, the formatter touched something it should not, so add it to `.prettierignore`.

- [ ] **Step 6: Commit the reformat on its own**

```bash
git add -A -- . ':!.superpowers' ':!.openidea' ':!.vscode'
git commit -m "style: format the workspace with prettier"
```

- [ ] **Step 7: Ignore the reformat in blame**

```bash
git rev-parse HEAD > .git-blame-ignore-revs
git add .git-blame-ignore-revs
git commit -m "chore: ignore the prettier reformat in git blame"
```

---

### Task 2: Persistence — production-safe dependencies, consistent reads, typed items, test gaps

**Files:**
- Modify: `libs/api/data-access-persistence/package.json`
- Modify: `libs/api/data-access-persistence/src/lib/table.ts`
- Modify: `users-repo.ts`, `auth-sessions-repo.ts`, `templates-repo.ts`, `sessions-repo.ts`, `invites-repo.ts` (all in `src/lib/`)
- Create: `src/lib/table.spec.ts`, `src/lib/consistent-reads.spec.ts`
- Modify: `src/lib/aws.spec.ts`, `src/lib/sessions-repo.spec.ts`, `src/lib/invites-repo.spec.ts`

**Interfaces:**
- Produces: `fromItem<T>(item: Record<string, unknown>): T`, exported from `table.ts` alongside `stripKeys`.
- Behaviour: every `get` on the base table uses `ConsistentRead: true`. Sessions, invites and auth sessions gate access; users and templates get it for uniformity.

- [ ] **Step 1: Write the failing tests**

`src/lib/table.spec.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { createTestStores } from '../testing/index.js';
import { fromItem, queryAll } from './table.js';

describe('table helpers', () => {
  it('fromItem strips the key attributes', () => {
    expect(fromItem<{ id: string }>({ PK: 'a', SK: 'b', GSI1PK: 'c', GSI1SK: 'd', id: 'x' })).toEqual({ id: 'x' });
  });

  it('queryAll follows LastEvaluatedKey across pages', async () => {
    const { table } = await createTestStores();
    for (let i = 0; i < 5; i++) {
      await table.doc.send(new PutCommand({ TableName: table.name, Item: { PK: 'P#1', SK: `S#${i}` } }));
    }
    const send = vi.spyOn(table.doc, 'send');
    const items = await queryAll<{ SK: string }>(table, {
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': 'P#1' },
      Limit: 2,
    });
    expect(items.map((i) => i.SK)).toEqual(['S#0', 'S#1', 'S#2', 'S#3', 'S#4']);
    expect(send).toHaveBeenCalledTimes(3);
  });
});
```

`src/lib/consistent-reads.spec.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import type { GetCommand } from '@aws-sdk/lib-dynamodb';
import { createTestStores } from '../testing/index.js';

describe('repositories', () => {
  it('read single items with ConsistentRead (access checks must not see stale records)', async () => {
    const s = await createTestStores();
    const send = vi.spyOn(s.table.doc, 'send');
    await s.sessions.get('default', 'missing');
    await s.invites.get('missing');
    await s.authSessions.get('missing', 0);
    await s.users.get('missing');
    await s.templates.get('default', 'missing');
    const inputs = send.mock.calls.map(([cmd]) => (cmd as GetCommand).input);
    expect(inputs).toHaveLength(5);
    for (const input of inputs) expect(input.ConsistentRead).toBe(true);
  });
});
```

Append to `src/lib/aws.spec.ts`, inside the existing `describe` (add `DescribeTimeToLiveCommand` to the `@aws-sdk/client-dynamodb` import):
```ts
  it('creates an on-demand table with an ALL-projection GSI1 and TTL on expiresAt', async () => {
    const stores = await createTestStores();
    const { Table } = await stores.raw.send(new DescribeTableCommand({ TableName: stores.table.name }));
    expect(Table?.BillingModeSummary?.BillingMode).toBe('PAY_PER_REQUEST');
    expect(Table?.GlobalSecondaryIndexes?.[0]?.Projection).toEqual({ ProjectionType: 'ALL' });
    const ttl = await stores.raw.send(new DescribeTimeToLiveCommand({ TableName: stores.table.name }));
    expect(ttl.TimeToLiveDescription).toMatchObject({ AttributeName: 'expiresAt', TimeToLiveStatus: 'ENABLED' });
  });
```
If DynamoDB Local 3.3.2 omits `BillingModeSummary`, replace that one assertion with `expect(Table?.ProvisionedThroughput?.ReadCapacityUnits ?? 0).toBe(0)` and note the deviation in the report.

Append to `src/lib/sessions-repo.spec.ts`, inside `describe('SessionsRepo')`:
```ts
  it('update of a missing session throws StaleWriteError', async () => {
    const { sessions } = await createTestStores();
    await expect(sessions.update(session({ id: 'nope' }), 1)).rejects.toBeInstanceOf(StaleWriteError);
  });
```

Append to `src/lib/invites-repo.spec.ts`, inside its `describe`:
```ts
  it('revoking a missing invite is a no-op', async () => {
    const { invites } = await createTestStores();
    await expect(invites.revoke('missing', 1)).resolves.toBeUndefined();
    await expect(invites.get('missing')).resolves.toBeNull();
  });
```

- [ ] **Step 2: Run the tests and confirm what fails**

Run: `pnpm nx test api-data-access-persistence`
Expected:
- FAIL: `fromItem` is not exported, and `ConsistentRead` is `undefined`.
- The other new tests may already pass. They fill coverage gaps from the Plan 2 review, so keep them.

- [ ] **Step 3: Implement `fromItem` and use it everywhere**

In `src/lib/table.ts`, add after `stripKeys`:
```ts
/** A stored item as a typed record: key attributes removed, cast once here rather than at every call site. */
export function fromItem<T>(item: Record<string, unknown>): T {
  return stripKeys(item) as unknown as T;
}
```

In each repository, replace every `stripKeys(x) as unknown as R` and `stripKeys(x) as R` with `fromItem<R>(x)`, and drop `stripKeys` from the import when it is no longer used:
- `users-repo.ts:19`
- `auth-sessions-repo.ts:22`
- `templates-repo.ts:34`, `:42`
- `sessions-repo.ts:42`, `:51`
- `invites-repo.ts:27`

Then run: `grep -rn "as unknown as" libs/api/data-access-persistence/src/lib --include='*.ts' | grep -v spec`. Expected: only the line inside `fromItem` (and the existing one inside `stripKeys`).

- [ ] **Step 4: Add `ConsistentRead: true` to every `GetCommand`**

Example (`sessions-repo.ts`):
```ts
new GetCommand({ TableName: table.name, Key: { PK: `SESSION#${id}`, SK: 'META' }, ConsistentRead: true }),
```
Apply the same change in `users-repo.ts`, `auth-sessions-repo.ts`, `templates-repo.ts` and `invites-repo.ts`.

- [ ] **Step 5: Make the test-only packages optional peers**

In `libs/api/data-access-persistence/package.json`, remove `testcontainers` and `vitest` from `dependencies` and add:
```json
  "peerDependencies": {
    "testcontainers": "^12.2.1",
    "vitest": "~5.0.1"
  },
  "peerDependenciesMeta": {
    "testcontainers": { "optional": true },
    "vitest": { "optional": true }
  },
  "devDependencies": {
    "testcontainers": "^12.2.1",
    "vitest": "~5.0.1"
  }
```
Run: `pnpm install`

- [ ] **Step 6: Run the tests, lint and the production-install check**

Run: `pnpm nx run-many -t lint test typecheck -p api-data-access-persistence api`. Expected: PASS.

Then confirm the pruned production install no longer contains them:
```bash
pnpm nx run api:prune --skip-nx-cache
T=$(mktemp -d) && cp -r apps/api/dist/. "$T"/ && (cd "$T" && pnpm install --prod --frozen-lockfile >/dev/null && ls node_modules/.pnpm | grep -cE '^(testcontainers|vitest)@' ; true)
```
Expected: `0`. Then `rm -rf "$T"`.

- [ ] **Step 7: Full verification and commit**

Run: `pnpm nx run-many -t lint test typecheck build` and `pnpm nx format:check --all`.
```bash
pnpm nx format:write --uncommitted
git add libs/api/data-access-persistence pnpm-lock.yaml
git commit -m "feat(api-data-access-persistence): consistent reads, typed fromItem, test-only deps as optional peers"
```

---

### Task 3: API — OIDC backchannel URL and cleanup on startup failure

**Files:**
- Modify: `libs/api/feature-auth/src/lib/oidc.ts`
- Create: `libs/api/feature-auth/src/lib/oidc.spec.ts`
- Modify: `apps/api/src/app/config.ts`, `apps/api/src/app/config.spec.ts`
- Modify: `apps/api/src/app/create-app.ts`
- Create: `apps/api/src/app/create-app.cleanup.spec.ts`

**Interfaces:**
- Produces:
  - `OidcSettings.internalUrl?: string`
  - `backchannelFetch(issuer: string, internalUrl: string, fetchImpl?: typeof fetch): client.CustomFetch`, exported from `oidc.ts` and re-exported via the lib's existing `export *`
  - `AppConfig.oidcInternalUrl: string | undefined`
- Consumes: openid-client 6.8.9's `client.customFetch` symbol. `DiscoveryRequestOptions[customFetch]` is copied onto the resulting `Configuration`, so token, JWKS and userinfo requests use it too.

- [ ] **Step 1: Write the failing tests**

`libs/api/feature-auth/src/lib/oidc.spec.ts`:
```ts
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { backchannelFetch, createOidcClient } from './oidc.js';

const PUBLIC_ISSUER = 'http://idp.public.test/realms/swint';

let server: Server | undefined;
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
});

describe('backchannelFetch', () => {
  it('sends requests for the issuer origin to the internal origin and leaves others alone', async () => {
    const seen: string[] = [];
    const f = backchannelFetch('http://localhost:8080/realms/swint', 'http://keycloak:8080', async (u) => {
      seen.push(String(u));
      return new Response('{}');
    });
    await f('http://localhost:8080/realms/swint/protocol/openid-connect/token?x=1', { method: 'POST', headers: {} } as never);
    await f('https://elsewhere.test/jwks', { method: 'GET', headers: {} } as never);
    expect(seen).toEqual(['http://keycloak:8080/realms/swint/protocol/openid-connect/token?x=1', 'https://elsewhere.test/jwks']);
  });
});

describe('createOidcClient with internalUrl', () => {
  it('discovers through the internal URL but sends browsers to the public issuer', async () => {
    const requested: string[] = [];
    server = createServer((req, res) => {
      requested.push(req.url ?? '');
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          issuer: PUBLIC_ISSUER,
          authorization_endpoint: `${PUBLIC_ISSUER}/protocol/openid-connect/auth`,
          token_endpoint: `${PUBLIC_ISSUER}/protocol/openid-connect/token`,
          jwks_uri: `${PUBLIC_ISSUER}/protocol/openid-connect/certs`,
          end_session_endpoint: `${PUBLIC_ISSUER}/protocol/openid-connect/logout`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          code_challenge_methods_supported: ['S256'],
        }),
      );
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;

    const oidc = createOidcClient({
      issuer: PUBLIC_ISSUER,
      internalUrl: `http://127.0.0.1:${port}`,
      clientId: 'swint-api',
      clientSecret: 's',
      redirectUri: 'http://localhost:8088/auth/callback',
      postLogoutRedirectUri: 'http://localhost:8088/',
      allowInsecureHttp: true,
    });
    const { url } = await oidc.createAuthorization();
    expect(url.origin).toBe('http://idp.public.test');
    expect(requested).toEqual(['/realms/swint/.well-known/openid-configuration']);
  });
});
```

In `apps/api/src/app/config.spec.ts`, add inside the existing `describe`:
```ts
  it('reads OIDC_INTERNAL_URL (optional, trailing slash removed)', () => {
    expect(loadConfig({ NODE_ENV: 'test' }).oidcInternalUrl).toBeUndefined();
    expect(loadConfig({ NODE_ENV: 'test', OIDC_INTERNAL_URL: 'http://keycloak:8080/' }).oidcInternalUrl).toBe('http://keycloak:8080');
  });
```

`apps/api/src/app/create-app.cleanup.spec.ts`:
```ts
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
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm nx test api-feature-auth` and `pnpm nx test api`
Expected: FAIL. `backchannelFetch` is not exported, `oidcInternalUrl` is undefined, and the destroy spies are called 0 times.

- [ ] **Step 3: Implement the OIDC backchannel**

In `libs/api/feature-auth/src/lib/oidc.ts`:
- add the field to `OidcSettings`:
```ts
  /**
   * Origin the API uses to reach the issuer when it differs from the one browsers use (e.g. http://keycloak:8080
   * inside Docker while browsers use http://localhost:8080). Only fetched requests are rewritten; the authorize
   * and end-session URLs are built for the browser and keep the public issuer origin.
   */
  internalUrl?: string;
```
- add the helper:
```ts
/** A customFetch that sends requests for the issuer's public origin to `internalUrl`'s origin instead. */
export function backchannelFetch(issuer: string, internalUrl: string, fetchImpl: typeof fetch = (u, i) => fetch(u, i)): client.CustomFetch {
  const from = new URL(issuer).origin;
  const to = new URL(internalUrl).origin;
  return (url, options) => {
    const target = new URL(url);
    const href = target.origin === from ? new URL(target.pathname + target.search, to).href : url;
    return fetchImpl(href, options as RequestInit);
  };
}
```
- replace the `client.discovery(...)` call's options argument:
```ts
      const options: client.DiscoveryRequestOptions = {};
      if (settings.allowInsecureHttp) options.execute = [client.allowInsecureRequests];
      if (settings.internalUrl) options[client.customFetch] = backchannelFetch(settings.issuer, settings.internalUrl);
      configPromise = client
        .discovery(new URL(settings.issuer), settings.clientId, settings.clientSecret, undefined, options)
        .catch((e) => {
          configPromise = null;
          throw e;
        });
```

- [ ] **Step 4: Wire the config**

In `apps/api/src/app/config.ts`:
- add `OIDC_INTERNAL_URL: z.url().optional(),` to `raw`
- add `oidcInternalUrl: env.OIDC_INTERNAL_URL?.replace(/\/$/, ''),` to the returned object, after `oidcIssuer`

In `create-app.ts`, inside `createOidcClient({...})`, add `internalUrl: config.oidcInternalUrl,`.

- [ ] **Step 5: Release the AWS clients when startup fails**

In `apps/api/src/app/create-app.ts`, keep `createDynamo` and `createS3` as the first statements, then wrap **everything from `if (config.ensureInfra) {` down to and including the final `return { ... };`** in `try { … } catch`. Declare `let server: FastifyInstance | undefined;` before the `try`, and change `const server = await buildServer(...)` to `server = await buildServer(...)`.

Inside the returned object, reference the server through a local `const started = server;` declared right before `return`, so the `close` closure uses a non-optional value. The end of the function becomes:
```ts
    const started = server;
    return {
      server: started,
      repos,
      resolveIdentityFromCookieHeader,
      collab,
      close: async () => {
        try {
          await collab.close();
        } finally {
          try {
            await started.close();
          } finally {
            raw.destroy();
            s3.destroy();
          }
        }
      },
    };
  } catch (err) {
    // Startup failed (e.g. DynamoDB unreachable during ensureTable): release what was opened, then rethrow.
    await server?.close().catch(() => undefined);
    raw.destroy();
    s3.destroy();
    throw err;
  }
}
```
`FastifyInstance` is already imported as a type at the top of the file.

- [ ] **Step 6: Run the tests**

Run: `pnpm nx run-many -t test lint typecheck -p api-feature-auth api`. Expected: PASS.

- [ ] **Step 7: Full verification and commit**

```bash
pnpm nx run-many -t lint test typecheck build && pnpm nx format:check --all
pnpm nx format:write --uncommitted
git add libs/api/feature-auth apps/api
git commit -m "feat(api): OIDC backchannel URL for containers; release AWS clients when startup fails"
```

---

### Task 4: Collab socket hardening — Origin allowlist, liveness, message budget, identity revalidation

**Files:**
- Create: `libs/api/collab-server/src/lib/rate-limit.ts` and `rate-limit.spec.ts`
- Create: `libs/api/collab-server/src/lib/still-authorized.ts` and `still-authorized.spec.ts`
- Modify: `libs/api/collab-server/src/lib/upgrade.ts`, `upgrade.spec.ts`
- Modify: `libs/api/collab-server/src/lib/collab-server.ts` (deps passthrough)
- Modify: `libs/api/collab-server/src/index.ts`
- Modify: `apps/api/src/app/config.ts`, `config.spec.ts`, `create-app.ts`
- Create: `apps/api/src/app/collab-origin.integration.spec.ts`

**Interfaces:**
- Produces, from `rate-limit.ts`:
  - `interface TokenBucket { take(): boolean }`
  - `createTokenBucket(opts: { ratePerSec: number; burst: number; now?: () => number }): TokenBucket`
- Produces, from `still-authorized.ts`: `stillAuthorized(original: Identity, fresh: Identity | null): boolean`.
- Produces, from `upgrade.ts`:
  - `UNAUTHENTICATED_CLOSE = { code: 1008, reason: 'unauthenticated' } as const`
  - `RATE_LIMITED_CLOSE = { code: 1008, reason: 'rate_limited' } as const`
  - `DEFAULT_MESSAGE_RATE = { ratePerSec: 200, burst: 1000 }`
  - `DEFAULT_PING_INTERVAL_MS = 25_000`
  - `DEFAULT_REVALIDATE_INTERVAL_MS = 60_000`
- `UpgradeHandlerOptions` and `CollabServerDeps` gain these optional fields:
  - `allowedOrigins?: readonly string[]`
  - `pingIntervalMs?: number`
  - `revalidateIntervalMs?: number`
  - `messageRate?: { ratePerSec: number; burst: number }`
- `AppConfig.collabRevalidateMs: number` (env `COLLAB_REVALIDATE_MS`, default 60000, minimum 1000).

- [ ] **Step 1: Write the failing unit tests**

`rate-limit.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { createTokenBucket } from './rate-limit.js';

describe('createTokenBucket', () => {
  it('allows a burst, then refills at the configured rate, never above the burst', () => {
    let t = 0;
    const bucket = createTokenBucket({ ratePerSec: 4, burst: 3, now: () => t });
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([true, true, true, false]);
    t = 500; // +2 tokens
    expect([bucket.take(), bucket.take(), bucket.take()]).toEqual([true, true, false]);
    t = 60_000; // long idle: capped at burst
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([true, true, true, false]);
  });
});
```

`still-authorized.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Identity } from '@swint/api-util-rpc';
import { stillAuthorized } from './still-authorized.js';

const ada: Identity = { kind: 'interviewer', sub: 'sub-1', name: 'Ada', email: null, orgId: 'default', roles: ['interviewer'] };
const bo: Identity = { kind: 'candidate', sessionId: 's1', orgId: 'default', inviteHash: 'h1', name: 'Bo' };

describe('stillAuthorized', () => {
  it('keeps the same interviewer with the interviewer role', () => {
    expect(stillAuthorized(ada, { ...ada, name: 'Ada L.' })).toBe(true);
  });
  it.each([
    ['signed out / expired', null],
    ['another user', { ...ada, sub: 'sub-2' }],
    ['role removed', { ...ada, roles: [] }],
    ['another org', { ...ada, orgId: 'other' }],
    ['now a candidate', bo],
  ])('drops an interviewer who is %s', (_label, fresh) => {
    expect(stillAuthorized(ada, fresh as Identity | null)).toBe(false);
  });
  it('keeps a candidate with the same invite, drops one whose invite changed', () => {
    expect(stillAuthorized(bo, bo)).toBe(true);
    expect(stillAuthorized(bo, { ...bo, inviteHash: 'h2' })).toBe(false);
    expect(stillAuthorized(bo, { ...bo, sessionId: 's2' })).toBe(false);
  });
});
```

Append to `upgrade.spec.ts`. First extend the imports:
- `import { attachUpgradeHandler, MAX_PAYLOAD_BYTES, type UpgradeHandle, type UpgradeHandlerOptions } from './upgrade.js';`
- `import type { Identity } from '@swint/api-util-rpc';` (already imported)

Then add:
```ts
/** A Hocuspocus stand-in: these tests are about the socket layer, not the Yjs protocol. */
const stubHocuspocus = {
  handleConnection: () => ({ handleMessage: () => undefined, handleClose: () => undefined, touch: () => undefined }),
} as unknown as Hocuspocus<CollabContext>;

async function startWith(opts: Partial<UpgradeHandlerOptions>) {
  const server = createServer((_q, r) => r.end('ok'));
  const h = attachUpgradeHandler(server, { path: '/collab', hocuspocus: stubHocuspocus, resolveIdentity: (c) => resolver(c), logger, ...opts });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const p = (server.address() as AddressInfo).port;
  return {
    url: `ws://127.0.0.1:${p}/collab`,
    close: async () => {
      await h.close();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

/** 101 when the socket opens, otherwise the HTTP status of the refused upgrade. */
function outcome(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    ws.once('error', () => undefined);
    ws.once('open', () => resolve(101));
    ws.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
  });
}
const closedWith = (ws: WebSocket) =>
  new Promise<{ code: number; reason: string }>((r) => ws.once('close', (code, reason) => r({ code, reason: reason.toString() })));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('socket policy', () => {
  it('refuses a browser Origin outside the allowlist with 403; allows listed and absent Origins', async () => {
    const s = await startWith({ allowedOrigins: ['http://app.test'] });
    const evil = new WebSocket(s.url, { headers: { cookie: 'ada' }, origin: 'http://evil.test' });
    const ok = new WebSocket(s.url, { headers: { cookie: 'ada' }, origin: 'http://app.test' });
    const noOrigin = new WebSocket(s.url, { headers: { cookie: 'ada' } });
    expect(await Promise.all([outcome(evil), outcome(ok), outcome(noOrigin)])).toEqual([403, 101, 101]);
    [evil, ok, noOrigin].forEach((w) => w.terminate());
    await s.close();
  });

  it('terminates a socket that stops answering pings and keeps one that answers', async () => {
    const s = await startWith({ pingIntervalMs: 50 });
    const silent = new WebSocket(s.url, { headers: { cookie: 'ada' }, autoPong: false });
    const healthy = new WebSocket(s.url, { headers: { cookie: 'ada' } });
    expect(await Promise.all([outcome(silent), outcome(healthy)])).toEqual([101, 101]);
    const silentClosed = closedWith(silent);
    await expect(silentClosed).resolves.toMatchObject({ code: 1006 });
    await sleep(200);
    expect(healthy.readyState).toBe(WebSocket.OPEN);
    healthy.terminate();
    await s.close();
  });

  it('closes a socket that exceeds its message budget with 1008 rate_limited', async () => {
    const s = await startWith({ messageRate: { ratePerSec: 1, burst: 3 } });
    const ws = new WebSocket(s.url, { headers: { cookie: 'ada' } });
    expect(await outcome(ws)).toBe(101);
    const closed = closedWith(ws);
    for (let i = 0; i < 10; i++) ws.send(new Uint8Array([0]));
    await expect(closed).resolves.toEqual({ code: 1008, reason: 'rate_limited' });
    await s.close();
  });

  it('closes a socket whose identity no longer resolves with 1008 unauthenticated', async () => {
    const s = await startWith({ revalidateIntervalMs: 50 });
    const ws = new WebSocket(s.url, { headers: { cookie: 'ada' } });
    expect(await outcome(ws)).toBe(101);
    await sleep(150);
    expect(ws.readyState).toBe(WebSocket.OPEN); // still valid: kept
    const closed = closedWith(ws);
    resolver = async () => null; // signed out
    await expect(closed).resolves.toEqual({ code: 1008, reason: 'unauthenticated' });
    await s.close();
  });

  it('closes an interviewer socket whose interviewer role was removed', async () => {
    const s = await startWith({ revalidateIntervalMs: 50 });
    const ws = new WebSocket(s.url, { headers: { cookie: 'ada' } });
    expect(await outcome(ws)).toBe(101);
    const closed = closedWith(ws);
    resolver = async () => ({ ...ada, roles: [] });
    await expect(closed).resolves.toEqual({ code: 1008, reason: 'unauthenticated' });
    await s.close();
  });
});
```
(`resolver` is the module-level variable the existing `beforeEach` resets to `c === 'ada' ? ada : null`.)

In `apps/api/src/app/config.spec.ts`:
```ts
  it('reads COLLAB_REVALIDATE_MS (default 60000, minimum 1000)', () => {
    expect(loadConfig({ NODE_ENV: 'test' }).collabRevalidateMs).toBe(60_000);
    expect(loadConfig({ NODE_ENV: 'test', COLLAB_REVALIDATE_MS: '2000' }).collabRevalidateMs).toBe(2000);
    expect(() => loadConfig({ NODE_ENV: 'test', COLLAB_REVALIDATE_MS: '10' })).toThrow(/COLLAB_REVALIDATE_MS/);
  });
```

`apps/api/src/app/collab-origin.integration.spec.ts`:
```ts
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { setup, type TestApp } from '../test/app-test-setup.js';

let app: TestApp | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const cookieHeader = (cookies: Record<string, string>) =>
  Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

function outcome(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    ws.once('error', () => undefined);
    ws.once('open', () => {
      resolve(101);
      ws.terminate();
    });
    ws.once('unexpected-response', (_req, res) => {
      resolve(res.statusCode ?? 0);
      ws.terminate();
    });
  });
}

describe('collab upgrade Origin allowlist (from PUBLIC_BASE_URL)', () => {
  it('accepts the app origin and non-browser clients; refuses other browser origins with 403', async () => {
    app = await setup({ listen: true });
    const headers = { cookie: cookieHeader(await app.interviewerCookie()) };
    const url = `ws://127.0.0.1:${app.port}/collab`;
    expect(await outcome(new WebSocket(url, { headers, origin: 'http://localhost:4200' }))).toBe(101);
    expect(await outcome(new WebSocket(url, { headers }))).toBe(101);
    expect(await outcome(new WebSocket(url, { headers, origin: 'http://evil.test' }))).toBe(403);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm nx test api-collab-server` and `pnpm nx test api`
Expected: FAIL. The modules and options don't exist, so the evil origin opens (101).

- [ ] **Step 3: Implement the token bucket and the identity check**

`rate-limit.ts`:
```ts
export interface TokenBucket {
  /** Takes one token; false when the budget is exhausted. */
  take(): boolean;
}

export function createTokenBucket(opts: { ratePerSec: number; burst: number; now?: () => number }): TokenBucket {
  const now = opts.now ?? (() => performance.now());
  let tokens = opts.burst;
  let last = now();
  return {
    take() {
      const t = now();
      tokens = Math.min(opts.burst, tokens + ((t - last) / 1000) * opts.ratePerSec);
      last = t;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}
```

`still-authorized.ts`:
```ts
import { INTERVIEWER_ROLE, type Identity } from '@swint/api-util-rpc';

/** Whether `fresh` (re-resolved from the same upgrade cookies) still grants what `original` was granted. */
export function stillAuthorized(original: Identity, fresh: Identity | null): boolean {
  if (!fresh || fresh.orgId !== original.orgId) return false;
  if (original.kind === 'interviewer') {
    return fresh.kind === 'interviewer' && fresh.sub === original.sub && fresh.roles.includes(INTERVIEWER_ROLE);
  }
  return fresh.kind === 'candidate' && fresh.sessionId === original.sessionId && fresh.inviteHash === original.inviteHash;
}
```

- [ ] **Step 4: Extend the upgrade handler**

In `upgrade.ts`:
- add the imports `import WebSocket, { WebSocketServer } from 'ws';` (replacing the existing `ws` import), `import { createTokenBucket, type TokenBucket } from './rate-limit.js';` and `import { stillAuthorized } from './still-authorized.js';`
- extend `UpgradeHandlerOptions`:
```ts
  /** Browser Origins allowed to open a socket. Undefined disables the check; a request without Origin (non-browser) is allowed. */
  allowedOrigins?: readonly string[];
  /** Ping interval; a socket that misses a pong by the next tick is terminated. Default 25000. */
  pingIntervalMs?: number;
  /** How often each socket's upgrade cookies are re-resolved; sockets that lost access are closed (1008). Default 60000. */
  revalidateIntervalMs?: number;
  /** Per-socket inbound message budget. Default DEFAULT_MESSAGE_RATE. */
  messageRate?: { ratePerSec: number; burst: number };
```
- add the exported constants:
```ts
export const DEFAULT_PING_INTERVAL_MS = 25_000;
export const DEFAULT_REVALIDATE_INTERVAL_MS = 60_000;
export const DEFAULT_MESSAGE_RATE = { ratePerSec: 200, burst: 1000 } as const;
/** Non-terminal for clients: they reconnect, and a reconnect without a valid identity gets HTTP 401. */
export const UNAUTHENTICATED_CLOSE = { code: 1008, reason: 'unauthenticated' } as const;
export const RATE_LIMITED_CLOSE = { code: 1008, reason: 'rate_limited' } as const;
```
- inside `attachUpgradeHandler`, after `const wss = …`, add the per-socket state map:
```ts
  interface SocketState {
    cookie: string | undefined;
    identity: Identity;
    alive: boolean;
    bucket: TokenBucket;
  }
  const live = new Map<WebSocket, SocketState>();
  const rate = opts.messageRate ?? DEFAULT_MESSAGE_RATE;
```
- in `onUpgrade`, right after the `url.pathname !== path` block, add the Origin check:
```ts
    const origin = req.headers.origin;
    if (opts.allowedOrigins && origin !== undefined && !opts.allowedOrigins.includes(origin)) {
      logger.info({ reason: 'origin_not_allowed', origin }, 'collab upgrade refused');
      socket.on('error', () => undefined);
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
```
- replace the body of the `wss.handleUpgrade` callback with:
```ts
      wss.handleUpgrade(req, socket, head, (ws) => {
        try {
          const client = hocuspocus.handleConnection(ws, toWebRequest(req), { identity: authed });
          const state: SocketState = { cookie: req.headers.cookie, identity: authed, alive: true, bucket: createTokenBucket(rate) };
          live.set(ws, state);
          ws.on('message', (d) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            if (!state.bucket.take()) {
              logger.warn({ reason: RATE_LIMITED_CLOSE.reason }, 'collab: closing socket over its message budget');
              ws.close(RATE_LIMITED_CLOSE.code, RATE_LIMITED_CLOSE.reason);
              return;
            }
            client.handleMessage(new Uint8Array(d as Buffer));
          });
          ws.on('close', (code, reason) => {
            live.delete(ws);
            client.handleClose({ code, reason: reason.toString() });
          });
          ws.on('pong', () => {
            state.alive = true;
            client.touch();
          });
          ws.on('error', (err) => logger.warn({ err }, 'collab websocket error'));
        } catch (err) {
          logger.error({ err }, 'collab upgrade: connection setup failed');
          ws.terminate();
        }
      });
```
- before `httpServer.on('upgrade', onUpgrade);`, add the two timers:
```ts
  // Liveness: a socket that did not answer the previous ping is dead (half-open TCP, sleeping laptop).
  const pingTimer = setInterval(() => {
    for (const [ws, state] of live) {
      if (!state.alive) {
        ws.terminate();
        continue;
      }
      state.alive = false;
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }
  }, opts.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS);
  pingTimer.unref();

  // Revalidation: sign-out, auth-session expiry and role removal must reach sockets opened before them.
  let revalidating = false;
  const revalidateTimer = setInterval(() => {
    if (revalidating) return;
    revalidating = true;
    void Promise.all(
      [...live].map(async ([ws, state]) => {
        let fresh: Identity | null;
        try {
          fresh = await resolveIdentity(state.cookie);
        } catch (err) {
          logger.warn({ err }, 'collab: revalidation failed; keeping the socket');
          return;
        }
        if (!stillAuthorized(state.identity, fresh) && ws.readyState === WebSocket.OPEN) {
          logger.info({ reason: UNAUTHENTICATED_CLOSE.reason }, 'collab: closing a socket that lost access');
          ws.close(UNAUTHENTICATED_CLOSE.code, UNAUTHENTICATED_CLOSE.reason);
        }
      }),
    ).finally(() => {
      revalidating = false;
    });
  }, opts.revalidateIntervalMs ?? DEFAULT_REVALIDATE_INTERVAL_MS);
  revalidateTimer.unref();
```
- at the start of `close()`, add `clearInterval(pingTimer); clearInterval(revalidateTimer);`.

- [ ] **Step 5: Pass the options through the collab server and the app**

In `collab-server.ts`:
- add to `CollabServerDeps`:
```ts
  /** See UpgradeHandlerOptions. */
  allowedOrigins?: readonly string[];
  pingIntervalMs?: number;
  revalidateIntervalMs?: number;
  messageRate?: { ratePerSec: number; burst: number };
```
- in `attach`, pass `allowedOrigins: deps.allowedOrigins, pingIntervalMs: deps.pingIntervalMs, revalidateIntervalMs: deps.revalidateIntervalMs, messageRate: deps.messageRate`.

In `src/index.ts`, add `export * from './lib/rate-limit.js';` and `export * from './lib/still-authorized.js';`.

In `apps/api/src/app/config.ts`:
- add to `raw`: `COLLAB_REVALIDATE_MS: z.coerce.number().int().min(1000).default(60_000),`
- add to the returned object: `collabRevalidateMs: env.COLLAB_REVALIDATE_MS,`

In `create-app.ts`, inside `createCollabServer({...})`, add:
```ts
    allowedOrigins: [new URL(config.publicBaseUrl).origin],
    revalidateIntervalMs: config.collabRevalidateMs,
```

- [ ] **Step 6: Run the tests**

Run: `pnpm nx run-many -t test lint typecheck -p api-collab-server api`. Expected: PASS, including the existing `collab.integration.spec.ts` (Node clients send no Origin).

- [ ] **Step 7: Full verification and commit**

```bash
pnpm nx run-many -t lint test typecheck build && pnpm nx format:check --all
pnpm nx format:write --uncommitted
git add libs/api/collab-server apps/api
git commit -m "feat(api-collab-server): origin allowlist, ping liveness, message budget and periodic identity revalidation"
```

---

### Task 5: Collab per-document size cap

**Files:**
- Create: `libs/api/collab-server/src/lib/doc-size-guard.ts` and `doc-size-guard.spec.ts`
- Modify: `libs/api/collab-server/src/lib/collab-server.ts`, `collab-server.spec.ts`
- Modify: `libs/api/collab-server/src/testing/collab-test-kit.ts`
- Modify: `libs/api/collab-server/src/index.ts`

**Interfaces:**
- Produces:
  - `MAX_DOCUMENT_BYTES = 10 * 1024 * 1024`
  - `interface DocSizeGuard { admit(name: string, bytes: number): boolean; forget(name: string): void }`
  - `createDocSizeGuard(maxBytes: number, measure: (name: string) => number): DocSizeGuard`
  - `CollabServerDeps.maxDocumentBytes?: number`
- Behaviour: when a connection's message would push its document past the cap, that connection becomes read-only and the message is dropped. Hocuspocus checks `connection.readOnly` after `beforeHandleMessage`, inside `MessageReceiver.apply`. Other connections keep writing while the real size allows it.

- [ ] **Step 1: Write the failing tests**

`doc-size-guard.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { createDocSizeGuard } from './doc-size-guard.js';

describe('createDocSizeGuard', () => {
  it('admits messages while the running estimate stays under the cap, without measuring again', () => {
    let measured = 0;
    const guard = createDocSizeGuard(100, () => {
      measured++;
      return 10;
    });
    expect(guard.admit('d', 40)).toBe(true); // first use measures (10) → 50
    expect(guard.admit('d', 40)).toBe(true); // 90
    expect(measured).toBe(1);
  });

  it('re-measures once the estimate crosses the cap, and admits when the real size leaves room', () => {
    let real = 10;
    const guard = createDocSizeGuard(100, () => real);
    expect(guard.admit('d', 80)).toBe(true); // estimate 90
    real = 20; // messages overestimate growth
    expect(guard.admit('d', 50)).toBe(true); // 140 > 100 → measure 20 + 50 = 70
  });

  it('rejects when the real size plus the message exceeds the cap', () => {
    const guard = createDocSizeGuard(100, () => 90);
    expect(guard.admit('d', 20)).toBe(false);
    expect(guard.admit('d', 5)).toBe(true);
  });

  it('forget drops the estimate (the next use measures again)', () => {
    let measured = 0;
    const guard = createDocSizeGuard(100, () => {
      measured++;
      return 0;
    });
    guard.admit('d', 1);
    guard.forget('d');
    guard.admit('d', 1);
    expect(measured).toBe(2);
  });
});
```

Append to `collab-server.spec.ts`:
```ts
describe('collab server: document size cap', () => {
  it('makes a connection read-only once its writes would push the document past the cap; others keep writing', async () => {
    const s = await setup('live', { maxDocumentBytes: 4096 });
    const a = connectClient(kit, docName.board(s.id), 'ada');
    const b = connectClient(kit, docName.board(s.id), 'bo');
    await Promise.all([a.synced, b.synced]);

    getBoardElements(a.doc).set('small', { id: 'small', version: 1, versionNonce: 1, index: 'a0', isDeleted: false });
    await expect.poll(() => getBoardElements(b.doc).get('small')?.version).toBe(1);

    getBoardElements(a.doc).set('big', { id: 'big', version: 1, versionNonce: 1, index: 'a1', isDeleted: false, text: 'x'.repeat(8192) } as never);
    getBoardElements(a.doc).set('after', { id: 'after', version: 1, versionNonce: 1, index: 'a2', isDeleted: false });
    await new Promise((r) => setTimeout(r, 300));
    expect(getBoardElements(b.doc).get('big')).toBeUndefined();
    expect(getBoardElements(b.doc).get('after')).toBeUndefined();

    getBoardElements(b.doc).set('fromB', { id: 'fromB', version: 1, versionNonce: 1, index: 'a3', isDeleted: false });
    await expect.poll(() => getBoardElements(a.doc).get('fromB')?.version).toBe(1);
    a.destroy();
    b.destroy();
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm nx test api-collab-server`
Expected: FAIL. The module is missing, and `maxDocumentBytes` is not accepted by the kit, so `big` reaches `b`.

- [ ] **Step 3: Implement the guard**

`doc-size-guard.ts`:
```ts
/** Largest encoded Yjs document the server accepts writes into (boards hold no images in v1). */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export interface DocSizeGuard {
  /** Whether a message of `bytes` may be applied to document `name`. */
  admit(name: string, bytes: number): boolean;
  /** Drops the estimate for an unloaded document. */
  forget(name: string): void;
}

/**
 * Tracks an over-estimate of each document's size (its measured size plus the bytes of every admitted message) and
 * only measures the real size (an O(document) encode) when that estimate would cross `maxBytes`.
 */
export function createDocSizeGuard(maxBytes: number, measure: (name: string) => number): DocSizeGuard {
  const estimate = new Map<string, number>();
  return {
    admit(name, bytes) {
      const base = estimate.get(name) ?? measure(name);
      if (base + bytes <= maxBytes) {
        estimate.set(name, base + bytes);
        return true;
      }
      const exact = measure(name);
      if (exact + bytes <= maxBytes) {
        estimate.set(name, exact + bytes);
        return true;
      }
      estimate.set(name, exact);
      return false;
    },
    forget(name) {
      estimate.delete(name);
    },
  };
}
```

- [ ] **Step 4: Wire it into the collab server**

In `collab-server.ts`:
- import `import { createDocSizeGuard, MAX_DOCUMENT_BYTES } from './doc-size-guard.js';`
- add to `CollabServerDeps`: `/** Default MAX_DOCUMENT_BYTES. */ maxDocumentBytes?: number;`
- after `const docStore = …`, add:
```ts
  const maxDocumentBytes = deps.maxDocumentBytes ?? MAX_DOCUMENT_BYTES;
  const sizeGuard = createDocSizeGuard(maxDocumentBytes, (name) => {
    const d = hocuspocus.documents.get(name);
    return d ? Y.encodeStateAsUpdate(d).byteLength : 0;
  });
```
- add this hook to the `new Hocuspocus({...})` configuration, next to `beforeHandleAwareness`:
```ts
    async beforeHandleMessage({ documentName, update, connection }) {
      if (connection.readOnly) return;
      if (!sizeGuard.admit(documentName, update.byteLength)) {
        // Read-only drops this message and later writes from this connection; others can still edit.
        connection.readOnly = true;
        logger.warn({ sessionId: targetOf(documentName).sessionId, maxDocumentBytes }, 'collab: document size cap reached; connection is now read-only');
      }
    },
```
- in `afterUnloadDocument`, add `sizeGuard.forget(documentName);`

In `src/testing/collab-test-kit.ts`, add `'maxDocumentBytes'` to the `Pick<CollabServerDeps, …>` union of `startCollabTestKit`'s options, and pass `maxDocumentBytes: opts.maxDocumentBytes,` into `createCollabServer`.

In `src/index.ts`, add `export * from './lib/doc-size-guard.js';`.

- [ ] **Step 5: Run the tests**

Run: `pnpm nx run-many -t test lint typecheck -p api-collab-server api`. Expected: PASS.

- [ ] **Step 6: Full verification and commit**

```bash
pnpm nx run-many -t lint test typecheck build && pnpm nx format:check --all
pnpm nx format:write --uncommitted
git add libs/api/collab-server
git commit -m "feat(api-collab-server): per-document size cap makes the writing connection read-only"
```

---

### Task 6: Board — block images and embeds locally; element count for e2e

**Files:**
- Modify: `libs/shared/collab-protocol/src/lib/board-validation.ts`, `board-validation.spec.ts`
- Modify: `libs/web/ui-whiteboard/src/lib/binding/excalidraw-binding.ts`, `excalidraw-binding.spec.ts`
- Create: `libs/web/ui-whiteboard/src/lib/components/collaborative-board.css`
- Modify: `libs/web/ui-whiteboard/src/lib/components/collaborative-board.tsx`, `collaborative-board.spec.tsx`

**Interfaces:**
- Produces:
  - `isSupportedElementType(type: unknown): boolean` (exported from `@swint/shared-collab-protocol`)
  - `UNSUPPORTED_ELEMENT_MESSAGE` (exported from `excalidraw-binding.ts` and from the lib index via the existing `export *`, or added to `src/index.ts` if the binding isn't re-exported)
  - `SceneApi.setToast?(toast: { message: string } | null): void`
  - the board container `div[data-testid="board"]` carries `data-element-count` (the number of non-deleted elements); Tasks 11–12 read it
- Behaviour: pasted, dropped or tool-created `image`, `embeddable`, `iframe` and `magicframe` elements are removed from the local scene on the next frame, with a toast, and never pushed. The embeddable toolbar item is hidden with CSS.

- [ ] **Step 1: Write the failing tests**

Append to `board-validation.spec.ts`:
```ts
describe('isSupportedElementType', () => {
  it('accepts the v1 drawing types and rejects images and embeds', () => {
    for (const t of BOARD_ELEMENT_TYPES) expect(isSupportedElementType(t)).toBe(true);
    for (const t of ['image', 'embeddable', 'iframe', 'magicframe', undefined, 3]) expect(isSupportedElementType(t)).toBe(false);
  });
});
```
(Add `isSupportedElementType` and `BOARD_ELEMENT_TYPES` to that spec's imports.)

Append to `excalidraw-binding.spec.ts`:
```ts
describe('unsupported elements', () => {
  it('removes images and embeds from the local scene with a toast, and never syncs them', () => {
    const { b, flush, sched, apiA, bindA } = setup();
    const setToast = vi.fn();
    (apiA as SceneApi).setToast = setToast;
    const image = el('img', 1, { type: 'image' });
    const embed = el('emb', 1, { type: 'embeddable' });
    bindA.handleChange([el('r', 1), image, embed], {});
    sched.frame();
    flush();
    const last = apiA.updateScene.mock.calls.at(-1)?.[0] as { elements: SyncedElement[]; captureUpdate: string };
    expect(last.elements.map((e) => e.id)).toEqual(['r']);
    expect(last.captureUpdate).toBe('NEVER');
    expect(setToast).toHaveBeenCalledWith({ message: UNSUPPORTED_ELEMENT_MESSAGE });
    expect([...getBoardElements(b).keys()]).toEqual(['r']);
  });

  it('ignores deleted unsupported elements', () => {
    const { flush, sched, apiA, bindA } = setup();
    bindA.handleChange([el('r', 1), el('img', 2, { type: 'image', isDeleted: true })], {});
    sched.frame();
    flush();
    // The constructor's awareness pass calls updateScene({ collaborators }); only scene writes matter here.
    expect(apiA.updateScene.mock.calls.filter(([s]) => 'elements' in (s as object))).toHaveLength(0);
  });
});
```
(Add `UNSUPPORTED_ELEMENT_MESSAGE` to the import from `./excalidraw-binding.js`.)

Append to `collaborative-board.spec.tsx`:
```ts
  it('exposes the number of visible elements for end-to-end tests', () => {
    render(<CollaborativeBoard doc={new Y.Doc()} awareness={null} readOnly={false} />);
    act(() => {
      (lastProps['onChange'] as (els: unknown[], s: unknown) => void)([rect, { ...rect, id: 'gone', isDeleted: true }], {});
    });
    expect(screen.getByTestId('board')).toHaveAttribute('data-element-count', '1');
  });
```
(Also add `vi.mock('./collaborative-board.css', () => ({}));` next to the existing CSS mock.)

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm nx run-many -t test -p shared-collab-protocol web-ui-whiteboard`. Expected: FAIL.

- [ ] **Step 3: Implement**

`board-validation.ts`: add
```ts
/** Whether an Excalidraw element type may live on the shared board (no images or embeds in v1). */
export function isSupportedElementType(type: unknown): boolean {
  return typeof type === 'string' && (BOARD_ELEMENT_TYPES as readonly string[]).includes(type);
}
```

In `excalidraw-binding.ts`:
- import `isSupportedElementType` from `@swint/shared-collab-protocol`
- add to `SceneApi`: `/** Excalidraw's toast; optional so fakes can omit it. */ setToast?(toast: { message: string } | null): void;`
- export `export const UNSUPPORTED_ELEMENT_MESSAGE = 'Images and embeds are not supported on the shared board.';`
- replace `flush` with:
```ts
  private readonly flush = (): void => {
    this.frame = null;
    let scene = this.pendingScene;
    this.pendingScene = null;
    if (!scene || this.destroyed || this.readOnly) return;
    const unsupported = new Set(scene.filter((e) => !e.isDeleted && !isSupportedElementType(e.type)).map((e) => e.id));
    if (unsupported.size > 0) {
      // Images and embeds would show locally but never sync (BoardSync rejects them): take them off the scene.
      scene = scene.filter((e) => !unsupported.has(e.id));
      this.o.api.updateScene({ elements: scene, captureUpdate: this.o.fns.captureNever });
      this.o.api.setToast?.({ message: UNSUPPORTED_ELEMENT_MESSAGE });
    }
    this.sync.pushLocal(scene);
  };
```
If `SyncedElement` has no `type` field, read it as `(e as { type?: unknown }).type`.

`collaborative-board.css`:
```css
/* v1 boards hold no embeds; the binding also strips any that slip through (e.g. pasted). */
.swint-board [data-testid='toolbar-embeddable'] {
  display: none;
}
```

In `collaborative-board.tsx`:
- add `import './collaborative-board.css';`
- add `const containerRef = useRef<HTMLDivElement>(null);`
- the wrapper becomes `<div ref={containerRef} className="swint-board h-full w-full" data-testid="board" data-element-count="0">`
- `onChange` becomes:
```tsx
        onChange={(elements, appState) => {
          // Written to the DOM directly (no re-render): e2e tests read it to see remote edits arrive.
          if (containerRef.current) containerRef.current.dataset['elementCount'] = String(elements.filter((e) => !e.isDeleted).length);
          bindingRef.current?.handleChange(elements as unknown as readonly SyncedElement[], appState);
        }}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm nx run-many -t test lint typecheck -p shared-collab-protocol web-ui-whiteboard`. Expected: PASS.

- [ ] **Step 5: Full verification and commit**

```bash
pnpm nx run-many -t lint test typecheck build && pnpm nx format:check --all
pnpm nx format:write --uncommitted
git add libs/shared/collab-protocol libs/web/ui-whiteboard
git commit -m "feat(web-ui-whiteboard): strip images and embeds from the local scene, hide the embed tool, expose element count"
```

---

### Task 7: Web — route-level code splitting and self-hosted Excalidraw fonts

**Files:**
- Modify: `apps/web/src/app/app.tsx`, `apps/web/src/app/app.spec.tsx`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/vite.config.mts`
- Modify: `package.json` (devDependency `vite-plugin-static-copy@4.1.1`)

**Interfaces:**
- Behaviour:
  - Feature libs load on demand. A candidate never downloads the dashboard or the template editor, and the dashboard never downloads Excalidraw.
  - `/fonts/**` is served by the dev server and copied into `apps/web/dist/fonts`.
  - Excalidraw loads fonts from the app origin.
- The `@nx/enforce-module-boundaries` rule forbids static imports of lazily loaded libs. After this task, `apps/web/src/app/app.tsx` imports `@swint/web-feature-dashboard`, `@swint/web-feature-session-room` and `@swint/web-feature-template-editor` only through `import()`.

- [ ] **Step 1: Update the app spec for asynchronous routes (failing first)**

In `app.spec.tsx`, change the `it.each` for `/link-invalid` to:
```ts
  ])('%s', async (path, heading) => {
    renderAt(path);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
  });
```
and add:
```ts
  it('shows a loading screen while a route chunk loads', () => {
    renderAt('/s/s1', fakeApi({ room: { get: () => new Promise(() => undefined) } }));
    expect(screen.getByRole('heading', { name: 'Loading…' })).toBeInTheDocument();
  });
```
Run: `pnpm nx test web`. Expected: the new test FAILS (there's no Suspense fallback yet).

- [ ] **Step 2: Lazy routes**

Replace the feature imports at the top of `app.tsx` with:
```tsx
import { lazy, Suspense, useState } from 'react';
import { Screen, Spinner } from '@swint/web-ui-primitives';

const InterviewerLayout = lazy(() => import('@swint/web-feature-dashboard').then((m) => ({ default: m.InterviewerLayout })));
const DashboardPage = lazy(() => import('@swint/web-feature-dashboard').then((m) => ({ default: m.DashboardPage })));
const TemplateEditorPage = lazy(() => import('@swint/web-feature-template-editor').then((m) => ({ default: m.TemplateEditorPage })));
const SessionRoomPage = lazy(() => import('@swint/web-feature-session-room').then((m) => ({ default: m.SessionRoomPage })));
const LinkInvalidScreen = lazy(() => import('@swint/web-feature-session-room').then((m) => ({ default: m.LinkInvalidScreen })));
```
(Remove the old `useState` and `Screen` import lines that these replace, and keep the other imports.) Wrap `<Routes>…</Routes>` in `AppRoutes`:
```tsx
    <Suspense fallback={<Screen title="Loading…"><Spinner /></Screen>}>
      <Routes>…unchanged…</Routes>
    </Suspense>
```

- [ ] **Step 3: Self-host the Excalidraw fonts**

Run: `pnpm add -D -w vite-plugin-static-copy@4.1.1`

In `apps/web/vite.config.mts`:
- fix the extensionless import warning: `import { devProxy } from './src/dev-proxy.ts';`. If `typecheck` then reports TS5097, use `'./src/dev-proxy.js'` instead and confirm `pnpm nx build web` prints no "without a file extension" warning.
- add the imports and the helper:
```ts
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

/** Excalidraw's font files (dist/prod/fonts), served at /fonts so the board never loads them from a CDN. */
function excalidrawFontsDir(): string {
  let dir = dirname(createRequire(import.meta.url).resolve('@excalidraw/excalidraw'));
  while (!existsSync(join(dir, 'package.json'))) dir = dirname(dir);
  return join(dir, 'dist', 'prod', 'fonts');
}
```
- add the plugin: `plugins: [react(), tailwindcss(), viteStaticCopy({ targets: [{ src: excalidrawFontsDir(), dest: '.' }] }), nxReadySignal()],`

In `apps/web/src/main.tsx`, before `const root = …`:
```ts
// Excalidraw resolves its font URLs against this; vite.config.mts copies the fonts to /fonts.
(window as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = `${window.location.origin}/`;
```

- [ ] **Step 4: Verify tests, the split and the fonts**

Run: `pnpm nx run-many -t test lint typecheck -p web`. Expected: PASS.

Run: `pnpm nx build web --skip-nx-cache`, then:
```bash
ls apps/web/dist/fonts/Excalifont | head -3        # expect .woff2 files
ls -l apps/web/dist/assets/index-*.js              # the entry chunk
```
Expected: the fonts exist, and the entry chunk `index-*.js` is under 400 kB. Excalidraw now lives in lazily loaded chunks.

Run: `pnpm nx build web 2>&1 | grep -c "without a file extension"`. Expected: `0`.

- [ ] **Step 5: Full verification and commit**

```bash
pnpm nx run-many -t lint test typecheck build && pnpm nx format:check --all
pnpm nx format:write --uncommitted
git add apps/web package.json pnpm-lock.yaml
git commit -m "feat(web): lazy route chunks and self-hosted Excalidraw fonts"
```

---

### Task 8: Web polish backlog

**Files:**
- Modify: `libs/web/feature-dashboard/src/lib/templates-section.tsx`, `dashboard-page.spec.tsx`
- Create: `libs/web/feature-session-room/src/lib/retry.ts`, `retry.spec.ts`
- Create: `libs/web/feature-session-room/src/lib/candidate-memory.ts`
- Modify: `libs/web/feature-session-room/src/lib/session-room-page.tsx`, `session-room-page.spec.tsx`, `live-room.tsx`
- Modify: `libs/web/ui-session-panels/src/lib/timer-bar.tsx`, `timer-bar.spec.tsx`
- Modify: `libs/web/ui-session-panels/src/lib/notes-editor.tsx`, `notes-editor.spec.tsx`
- Delete: `libs/web/{data-access-api,data-access-collab,feature-dashboard,ui-primitives,ui-session-panels}/.babelrc`
- Modify: every `libs/web/*/README.md` that still contains "This library was generated with [Nx]"
- Modify: `nx.json` (remove `"babel": true` from `generators.@nx/react.application`)

**Interfaces:**
- Produces:
  - `notStartedRetryDelay(attempt: number, pollMs: number): number` and `MAX_NOT_STARTED_RETRY_MS = 30_000` (in `retry.ts`)
  - `rememberCandidate(sessionId: string): void` and `wasCandidate(sessionId: string): boolean` (in `candidate-memory.ts`)
  - `LiveRoom` prop `retryDelayMs?: number`, defaulting to `pollMs`
  - `useNow(intervalMs = 500, enabled = true)`

- [ ] **Step 1: Write the failing tests**

`retry.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { MAX_NOT_STARTED_RETRY_MS, notStartedRetryDelay } from './retry.js';

describe('notStartedRetryDelay', () => {
  it('doubles per attempt and caps at 30 s', () => {
    expect([0, 1, 2, 3].map((a) => notStartedRetryDelay(a, 3000))).toEqual([3000, 6000, 12000, 24000]);
    expect(notStartedRetryDelay(4, 3000)).toBe(MAX_NOT_STARTED_RETRY_MS);
    expect(notStartedRetryDelay(50, 3000)).toBe(30_000);
  });
});
```

Append to `session-room-page.spec.tsx`, inside `describe('SessionRoomPage gate')`:
```ts
  it('tells a returning candidate whose link stopped working to get a new link, not to sign in', async () => {
    localStorage.setItem('swint.candidate.s1', '1');
    renderRoom(async () => { throw orpcError('UNAUTHORIZED'); });
    expect(await screen.findByRole('heading', { name: 'This link is no longer valid' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /sign in as interviewer/i })).not.toBeInTheDocument();
    localStorage.clear();
  });

  it('remembers that this browser joined as the candidate', async () => {
    renderRoom(async () => candidate('created'));
    await screen.findByRole('heading', { name: 'Waiting for your interviewer to start' });
    expect(localStorage.getItem('swint.candidate.s1')).toBe('1');
    localStorage.clear();
  });
```

Append to `dashboard-page.spec.tsx`, inside `describe('DashboardPage')`:
```ts
  it('reports a failed archive', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const a = api({ templates: { archive: vi.fn(async () => { throw new Error('boom'); }) } });
    renderWithApi(<DashboardPage />, { api: fakeApi(a) });
    await userEvent.click(await screen.findByRole('button', { name: 'Archive URL shortener' }));
    expect(await screen.findByText('Could not archive the template. Please try again.')).toBeInTheDocument();
  });
```

Append to `timer-bar.spec.tsx` (add `vi` and `render`/`screen` to its imports if missing):
```ts
describe('useNow on an ended session', () => {
  it('does not keep a ticking interval', () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    render(<TimerBar status="ended" timer={{ startedAt: 1, durationSec: 60, extensionSec: 0 }} offsetMs={0} />);
    expect(spy.mock.calls.filter(([, ms]) => ms === 500)).toHaveLength(0);
    spy.mockRestore();
  });
});
```

Append to `notes-editor.spec.tsx` (add `Awareness` from `y-protocols/awareness`, `Y`, `render` and `waitFor` imports if missing):
```ts
describe('NotesEditor user changes', () => {
  it('updates the collaboration caret user without recreating the editor', async () => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const props = { doc, awarenessProvider: { awareness }, readOnly: false };
    const { rerender } = render(<NotesEditor {...props} user={{ name: 'Ada', color: '#111111' }} />);
    await waitFor(() => expect(awareness.getLocalState()?.['user']).toMatchObject({ name: 'Ada' }));
    rerender(<NotesEditor {...props} user={{ name: 'Grace', color: '#222222' }} />);
    await waitFor(() => expect(awareness.getLocalState()?.['user']).toMatchObject({ name: 'Grace', color: '#222222' }));
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm nx run-many -t test -p web-feature-session-room web-feature-dashboard web-ui-session-panels`. Expected: FAIL.

- [ ] **Step 3: Implement**

`retry.ts`:
```ts
export const MAX_NOT_STARTED_RETRY_MS = 30_000;

/** Delay before reconnecting after a `not_started` rejection: exponential from `pollMs`, capped. */
export function notStartedRetryDelay(attempt: number, pollMs: number): number {
  return Math.min(pollMs * 2 ** attempt, MAX_NOT_STARTED_RETRY_MS);
}
```

`candidate-memory.ts`:
```ts
const key = (sessionId: string) => `swint.candidate.${sessionId}`;

/** Remembers that this browser joined `sessionId` as the candidate (copy only; no security meaning). */
export function rememberCandidate(sessionId: string): void {
  try {
    localStorage.setItem(key(sessionId), '1');
  } catch {
    // Storage unavailable (private mode, blocked): the generic sign-in copy is shown instead.
  }
}

export function wasCandidate(sessionId: string): boolean {
  try {
    return localStorage.getItem(key(sessionId)) === '1';
  } catch {
    return false;
  }
}
```

`session-room-page.tsx`:
- add the imports `useEffect`, `{ rememberCandidate, wasCandidate } from './candidate-memory.js'`, `{ notStartedRetryDelay } from './retry.js'`, `{ WAITING_POLL_MS } from './use-room.js'` (merged with the existing import) and `LinkInvalidScreen` (from `./screens.js`)
- after `const err = …`:
```tsx
  const role = room.data?.role;
  useEffect(() => {
    if (role === 'candidate') rememberCandidate(sessionId);
  }, [role, sessionId]);
```
- the UNAUTHORIZED line becomes:
```tsx
  if (err?.code === 'UNAUTHORIZED') return wasCandidate(sessionId) ? <LinkInvalidScreen reason={null} /> : <SignInRequiredScreen sessionId={sessionId} />;
```
- the LiveRoom line becomes:
```tsx
    return <LiveRoom key={attempt} view={view} onRetry={retry} pollMs={pollMs} retryDelayMs={notStartedRetryDelay(attempt, pollMs ?? WAITING_POLL_MS)} />;
```

`live-room.tsx`:
- the signature becomes `export function LiveRoom({ view, onRetry, pollMs = WAITING_POLL_MS, retryDelayMs }: { view: RoomView; onRetry?: () => void; pollMs?: number; retryDelayMs?: number })`
- in the not_started effect, use `const delay = retryDelayMs ?? pollMs;`, call `setTimeout(onRetry, delay)`, and add `retryDelayMs` to the dependency array

`templates-section.tsx`: after the `templates.isError` line add
```tsx
      {archive.isError ? <p role="alert" className="text-sm text-red-700">Could not archive the template. Please try again.</p> : null}
```

`timer-bar.tsx`:
```ts
export function useNow(intervalMs = 500, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
  return now;
}
```
and in `TimerBar`: `const now = useNow(500, !isFinished(status));`

`notes-editor.tsx`: add after the `setEditable` effect:
```tsx
  // The editor is not recreated for a new user (that would drop the undo history); update the caret instead.
  useEffect(() => {
    editor?.commands.updateUser({ name: user.name, color: user.color });
  }, [editor, user.name, user.color]);
```

- [ ] **Step 4: Remove generator leftovers**

```bash
git rm libs/web/data-access-api/.babelrc libs/web/data-access-collab/.babelrc libs/web/feature-dashboard/.babelrc libs/web/ui-primitives/.babelrc libs/web/ui-session-panels/.babelrc
grep -l "This library was generated with \[Nx\]" libs/web/*/README.md
```
For each README listed, replace the whole file with a heading and one sentence naming the library's job. Take the wording from its `src/index.ts` exports. For example `libs/web/ui-primitives/README.md`:
```md
# web-ui-primitives

Shared presentational components (Button, Badge, Card, Dialog, Screen, CopyField, Spinner) and the `cn` class helper.
```
In `nx.json`, delete the `"babel": true,` line under `generators.@nx/react.application`.

- [ ] **Step 5: Run the tests**

Run: `pnpm nx run-many -t test lint typecheck -p web-feature-session-room web-feature-dashboard web-ui-session-panels web-data-access-api web-data-access-collab web-ui-primitives`. Expected: PASS.

- [ ] **Step 6: Full verification and commit**

```bash
pnpm nx run-many -t lint test typecheck build && pnpm nx format:check --all
pnpm nx format:write --uncommitted
git add -A libs/web nx.json
git commit -m "fix(web): archive errors, not_started backoff, timer stops after end, notes caret user, revoked-candidate copy; drop generator leftovers"
```

---

### Task 9: API container image

**Files:**
- Create: `.dockerignore`
- Create: `Dockerfile` (stages `workspace`, `api-build`, `api-deps`, `api`; Task 10 adds `web-build` and `web`)

**Interfaces:**
- Produces: `docker build --target api -t swint-api:local .` builds an image that:
  - runs `node main.js` as user `node` with `NODE_ENV=production`;
  - listens on 3000;
  - has a `HEALTHCHECK` on `/healthz`;
  - contains no `testcontainers` or `vitest`.
- Consumes: `nx run api:prune` (Global Constraints) and Task 3's `OIDC_INTERNAL_URL`.

- [ ] **Step 1: Write the image check (failing first)**

Run: `docker build --target api -t swint-api:local .`
Expected: FAIL (there's no Dockerfile).

- [ ] **Step 2: Add `.dockerignore`**

```
**/node_modules
**/dist
**/out-tsc
**/test-output
**/coverage
**/*.tsbuildinfo
.nx
.git
.superpowers
.openidea
.vscode
.claude
docs
.env
.env.*
```

- [ ] **Step 3: Add the `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7
# One build for both images: `--target api` and `--target web` share the workspace stage (one pnpm install).
ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS workspace
ENV NX_DAEMON=false NX_NO_CLOUD=true NX_SKIP_NX_CACHE=true NX_TUI=false CI=true
RUN npm install -g pnpm@12.18.0
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=swint-pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --store-dir=/pnpm/store

# Pruned API: dist/main.js + package.json/pnpm-lock.yaml/workspace_modules for a production-only install.
FROM workspace AS api-build
RUN pnpm nx run api:prune

FROM ${NODE_IMAGE} AS api-deps
RUN npm install -g pnpm@12.18.0
WORKDIR /app
COPY --from=api-build /repo/apps/api/dist/ ./
RUN --mount=type=cache,id=swint-pnpm-store,target=/pnpm/store pnpm install --prod --frozen-lockfile --store-dir=/pnpm/store

FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=api-deps --chown=node:node /app ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "main.js"]
```

- [ ] **Step 4: Build and inspect the image**

```bash
docker build --target api -t swint-api:local .
docker run --rm --entrypoint sh swint-api:local -c 'ls node_modules/.pnpm | grep -cE "^(testcontainers|vitest)@" ; true'
docker run --rm --entrypoint sh swint-api:local -c 'ls node_modules/.pnpm | grep -E "^(@hocuspocus\+server|ws|yjs)@" | wc -l'
docker run --rm --entrypoint id swint-api:local -u
```
Expected:
- `0`, so no test-only packages;
- `3` or more, so collab's runtime dependencies are present (the Plan 3 carry-forward);
- a non-zero uid.

- [ ] **Step 5: Smoke-run it against the compose infra**

The compose infra must be up (`docker compose up -d`), and the network `swint_default` must exist.
```bash
docker run -d --rm --name swint-api-smoke --network swint_default -p 127.0.0.1:3300:3000 \
  -e PUBLIC_BASE_URL=http://localhost:8088 -e OIDC_ISSUER=http://localhost:8080/realms/swint \
  -e OIDC_INTERNAL_URL=http://keycloak:8080 -e OIDC_CLIENT_SECRET=swint-dev-secret \
  -e COOKIE_SECRET=smoke-test-cookie-secret-0123456789abcdef \
  -e DYNAMODB_ENDPOINT=http://dynamodb:8000 -e S3_ENDPOINT=http://s3:9090 -e ENSURE_INFRA=true \
  swint-api:local
curl -fsS --retry 30 --retry-connrefused --retry-delay 1 http://127.0.0.1:3300/healthz
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' 'http://127.0.0.1:3300/auth/login?returnTo=%2F'
docker stop swint-api-smoke
```
Expected:
- `/healthz` succeeds;
- `/auth/login` gives `302 http://localhost:8080/realms/swint/protocol/openid-connect/auth?…`, which proves discovery worked through `OIDC_INTERNAL_URL` and the browser-facing URL kept the public origin.

If the container exits early, include `docker logs swint-api-smoke` in the report.

- [ ] **Step 6: Commit**

```bash
git add .dockerignore Dockerfile
git commit -m "build: API production image (pruned install, non-root, healthcheck)"
```

---

### Task 10: Web image, nginx, compose `app` profile and compose hardening

**Files:**
- Modify: `Dockerfile` (add `web-build` and `web` stages)
- Create: `apps/web/nginx.conf`
- Modify: `docker-compose.yml`
- Modify: `docker/keycloak/swint-realm.json`
- Modify: `README.md` (full-stack section, compose ports)

**Interfaces:**
- Produces: `docker compose --profile app up -d --build --wait` serves the app at `http://localhost:8088`, with `/api`, `/auth`, `/join` and `/collab` (WebSocket) proxied to the `api` service.
- Consumes: Task 9's `api` stage and Task 7's `/fonts`.

- [ ] **Step 1: Write the failing smoke check**

Run: `docker compose --profile app config --services`. Expected: no `web` or `api` in the output, which counts as the failing check.

- [ ] **Step 2: Add the web stages to `Dockerfile`**

Append:
```dockerfile
FROM workspace AS web-build
RUN pnpm nx run web:build

FROM nginx:1.29-alpine AS web
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
```

- [ ] **Step 3: Add `apps/web/nginx.conf`**

```nginx
# Same-origin setup (spec §10): the browser only talks to this server; nginx forwards API paths to the api service.
map $http_upgrade $connection_upgrade {
  default upgrade;
  ''      close;
}

server {
  listen 8080;
  server_tokens off;
  root /usr/share/nginx/html;
  # The API accepts JSON bodies up to 2 MB.
  client_max_body_size 3m;

  location ~ ^/(api|auth|join)/ {
    proxy_pass http://api:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location = /collab {
    proxy_pass http://api:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    # Interviews last hours; the server pings every 25 s.
    proxy_read_timeout 1h;
    proxy_send_timeout 1h;
  }

  location /assets/ {
    add_header Cache-Control "public, max-age=31536000, immutable";
    try_files $uri =404;
  }

  location /fonts/ {
    add_header Cache-Control "public, max-age=604800";
    try_files $uri =404;
  }

  # SPA: /s/:id, /templates/…, /link-invalid are client routes.
  location / {
    add_header Cache-Control "no-cache";
    try_files $uri /index.html;
  }
}
```

- [ ] **Step 4: Compose — hardening plus the `app` profile**

Edit `docker-compose.yml`:
- change the infra ports to `'127.0.0.1:8080:8080'`, `'127.0.0.1:8000:8000'` and `'127.0.0.1:9090:9090'`;
- put a comment above `user: root` on `dynamodb`:
  `# The image's default user cannot write to a fresh named volume (owned by root); DynamoDB Local must create its db file there.`
- put a comment above `user: root` on `s3`:
  `# S3Mock's default user cannot write to the root-owned named volume mounted at /data.`
- add the app services under `services:`:
```yaml
  # Full stack (spec §10): docker compose --profile app up --build
  # Exactly ONE api replica: live collab documents are in-process (see README "Deployment notes").
  api:
    profiles: ['app']
    build: { context: ., target: api }
    image: swint-api:local
    environment:
      PUBLIC_BASE_URL: http://localhost:8088
      OIDC_ISSUER: http://localhost:8080/realms/swint
      OIDC_INTERNAL_URL: http://keycloak:8080
      OIDC_CLIENT_SECRET: swint-dev-secret
      COOKIE_SECRET: compose-only-cookie-secret-not-for-production-01
      DYNAMODB_ENDPOINT: http://dynamodb:8000
      S3_ENDPOINT: http://s3:9090
      ENSURE_INFRA: 'true'
      SEED_DEV_DATA: 'true'
    depends_on: [keycloak, dynamodb, s3]
    restart: unless-stopped

  web:
    profiles: ['app']
    build: { context: ., target: web }
    image: swint-web:local
    ports:
      - '127.0.0.1:8088:8080'
    depends_on:
      api: { condition: service_healthy }
    restart: unless-stopped
```

- [ ] **Step 5: Keycloak realm — allow the full-stack origin**

In `docker/keycloak/swint-realm.json`, client `swint-api`:
- `redirectUris`: add `"http://localhost:8088/auth/callback"`
- `webOrigins`: add `"http://localhost:8088"`
- `attributes["post.logout.redirect.uris"]`: append `##http://localhost:8088/*`

Re-import the realm. It is only imported into a fresh container:
```bash
docker compose up -d --force-recreate keycloak
curl -fsS --retry 60 --retry-connrefused --retry-delay 2 http://localhost:8080/realms/swint/.well-known/openid-configuration >/dev/null
```

- [ ] **Step 6: Bring up the full stack and smoke it**

```bash
docker compose --profile app up -d --build --wait
curl -fsS http://localhost:8088/ | grep -c 'id="root"'                                       # 1
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8088/s/anything                      # 200 (SPA)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8088/api/openapi.json                # 200
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8088/fonts/Excalifont/Excalifont-Regular-349fac6ca4700ffec595a7150a0d1e1d.woff2  # 200
curl -s -o /dev/null -w '%{http_code}\n' -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' http://localhost:8088/collab   # 401 (reached the API's upgrade handler)
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' 'http://localhost:8088/auth/login?returnTo=%2F'      # 302 http://localhost:8080/realms/swint/…
```
All of the expected values must match. Leave the stack running for Task 12, or stop it with `docker compose --profile app stop api web`.

- [ ] **Step 7: README**

Replace the README's local-development command block's compose comment with the bound-ports note, and add a section after "Local development":
```md
## Full stack in containers

```bash
docker compose --profile app up -d --build --wait   # web (nginx) on http://localhost:8088, API behind it
```

Sign in as `interviewer1` / `password`. nginx serves the built SPA and proxies `/api`, `/auth`, `/join` and `/collab`
(WebSocket) to the `api` container. The API runs with `NODE_ENV=production`, seeds the demo template and reaches
Keycloak through `OIDC_INTERNAL_URL=http://keycloak:8080` while browsers keep using `http://localhost:8080`.
Infra ports are bound to 127.0.0.1 only.

If you changed `docker/keycloak/swint-realm.json`, re-import it with `docker compose up -d --force-recreate keycloak`.
```

- [ ] **Step 8: Verify and commit**

```bash
pnpm nx run-many -t lint test typecheck build && pnpm nx format:check --all
pnpm nx format:write --uncommitted
git add Dockerfile apps/web/nginx.conf docker-compose.yml docker/keycloak/swint-realm.json README.md
git commit -m "build: web image (nginx same-origin proxy) and compose app profile; bind infra ports to localhost"
```

---

### Task 11: Playwright project and the full interview flow

**Files:**
- Modify: `package.json` (`@playwright/test@1.65.0`, `@nx/playwright@24.0.4`), `nx.json` (plugin)
- Create: `apps/web-e2e/package.json`, `tsconfig.json`, `tsconfig.e2e.json`, `eslint.config.mjs`, `playwright.config.ts`
- Create: `apps/web-e2e/src/support/{env,auth,sessions,board}.ts`
- Create: `apps/web-e2e/src/interview.spec.ts`

**Interfaces:**
- Produces:
  - `pnpm nx e2e web-e2e` (inferred by `@nx/playwright/plugin`, target name `e2e`)
  - `signInAsInterviewer(page: Page): Promise<void>`
  - `createSession(page: Page, candidateName: string): Promise<{ roomPath: string; candidateUrl: string; interviewerUrl: string }>`
  - `drawRectangle(page: Page): Promise<void>`
  - `KEYCLOAK_ORIGIN`, `SEED_TEMPLATE`, `INTERVIEWER`
- Consumes:
  - Task 6's `data-element-count`
  - Task 7's `/fonts`
  - the dev seed template "Design a URL shortener"
  - Keycloak user `interviewer1` / `password` ("Ada Interviewer")
- Runs against `E2E_BASE_URL` (default `http://localhost:4200`).
  - With no `E2E_BASE_URL`, Playwright starts `pnpm nx run-many -t serve -p api web`, or reuses dev servers that are already running.
  - Compose infra must be up.

- [ ] **Step 1: Install**

```bash
pnpm nx add @nx/playwright@24.0.4
pnpm add -D -w @playwright/test@1.65.0
pnpm exec playwright install chromium
```
Make sure `nx.json` `plugins` contains `{ "plugin": "@nx/playwright/plugin", "options": { "targetName": "e2e" } }`, and add it if `nx add` did not.

- [ ] **Step 2: Project files**

`apps/web-e2e/package.json`:
```json
{
  "name": "web-e2e",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "nx": {
    "tags": ["scope:web", "type:e2e"],
    "implicitDependencies": ["web", "api"]
  }
}
```

`apps/web-e2e/tsconfig.json`:
```json
{
  "files": [],
  "references": [{ "path": "./tsconfig.e2e.json" }]
}
```

`apps/web-e2e/tsconfig.e2e.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "out-tsc/e2e",
    "tsBuildInfoFile": "out-tsc/e2e/tsconfig.e2e.tsbuildinfo",
    "rootDir": ".",
    "lib": ["es2022", "dom"],
    "types": ["node"]
  },
  "include": ["playwright.config.ts", "src/**/*.ts"]
}
```

`apps/web-e2e/eslint.config.mjs`:
```js
import baseConfig from '../../eslint.config.mjs';

export default [...baseConfig, { ignores: ['**/out-tsc'] }];
```

Run `pnpm nx sync`, which adds `apps/web-e2e` to the root `tsconfig.json` references.

`apps/web-e2e/playwright.config.ts`:
```ts
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));
const baseURL = process.env['E2E_BASE_URL'] ?? 'http://localhost:4200';

export default defineConfig({
  testDir: './src',
  outputDir: '../../dist/.playwright/apps/web-e2e/test-output',
  // One shared Keycloak and dev stack: run serially.
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['html', { outputFolder: '../../dist/.playwright/apps/web-e2e/report', open: 'never' }]],
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: process.env['E2E_BASE_URL']
    ? undefined
    : {
        command: 'pnpm nx run-many -t serve -p api web --output-style=stream',
        // Through the Vite proxy, so it is ready only when both the web and API servers are.
        url: 'http://localhost:4200/api/openapi.json',
        reuseExistingServer: true,
        timeout: 180_000,
        cwd: workspaceRoot,
        // Applies only when Playwright starts the servers itself; tests tolerate the 60 s default.
        env: { COLLAB_REVALIDATE_MS: '2000' },
        stdout: 'ignore',
        stderr: 'pipe',
      },
});
```

- [ ] **Step 3: Support helpers**

`src/support/env.ts`:
```ts
export const KEYCLOAK_ORIGIN = process.env['E2E_KEYCLOAK_ORIGIN'] ?? 'http://localhost:8080';
export const INTERVIEWER = { username: 'interviewer1', password: 'password' } as const;
/** Seeded by the API in development and by the compose `api` service (SEED_DEV_DATA=true). */
export const SEED_TEMPLATE = 'Design a URL shortener';
```

`src/support/auth.ts`:
```ts
import { expect, type Page } from '@playwright/test';
import { INTERVIEWER, KEYCLOAK_ORIGIN } from './env.js';

/** Signs in through the real Keycloak login form (spec §8: real Keycloak, no auth stub) and lands on the dashboard. */
export async function signInAsInterviewer(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForURL((url) => url.origin === KEYCLOAK_ORIGIN);
  await page.locator('#username').fill(INTERVIEWER.username);
  await page.locator('#password').fill(INTERVIEWER.password);
  await page.locator('#kc-login').click();
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
}
```

`src/support/sessions.ts`:
```ts
import type { Page } from '@playwright/test';
import { SEED_TEMPLATE } from './env.js';

export interface CreatedSession {
  roomPath: string;
  candidateUrl: string;
  interviewerUrl: string;
}

/** Creates a session from the dashboard dialog and reads both links from it. */
export async function createSession(page: Page, candidateName: string): Promise<CreatedSession> {
  await page.getByRole('button', { name: 'New session' }).click();
  const dialog = page.getByRole('dialog', { name: 'New session' });
  await dialog.getByLabel('Template').selectOption({ label: SEED_TEMPLATE });
  await dialog.getByLabel('Candidate name').fill(candidateName);
  await dialog.getByRole('button', { name: 'Create session' }).click();
  const candidateUrl = await dialog.getByLabel('Candidate link').inputValue();
  const interviewerUrl = await dialog.getByLabel('Interviewer link').inputValue();
  return { candidateUrl, interviewerUrl, roomPath: new URL(interviewerUrl).pathname };
}

export const uniqueCandidate = () => `Candidate ${Date.now().toString(36)}`;
```

`src/support/board.ts`:
```ts
import type { Page } from '@playwright/test';

/** Draws one rectangle in the middle of the board with Excalidraw's rectangle tool. */
export async function drawRectangle(page: Page): Promise<void> {
  await page.getByTestId('toolbar-rectangle').click();
  const box = await page.getByTestId('board').boundingBox();
  if (!box) throw new Error('board is not visible');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x - 80, y - 50);
  await page.mouse.down();
  await page.mouse.move(x + 80, y + 50, { steps: 8 });
  await page.mouse.up();
}
```

- [ ] **Step 4: The interview spec (spec §8 e2e row)**

`src/interview.spec.ts`:
```ts
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { signInAsInterviewer } from './support/auth.js';
import { drawRectangle } from './support/board.js';
import { KEYCLOAK_ORIGIN } from './support/env.js';
import { createSession, uniqueCandidate } from './support/sessions.js';

const FONT = '/fonts/Excalifont/Excalifont-Regular-349fac6ca4700ffec595a7150a0d1e1d.woff2';

test('interviewer and candidate run a whole interview', async ({ page, browser, baseURL }) => {
  // Everything must come from the app origin or Keycloak: no CDN (fonts are self-hosted).
  const allowed = new Set([new URL(baseURL ?? '').origin, KEYCLOAK_ORIGIN]);
  const foreign: string[] = [];
  const track = (p: Page) =>
    p.on('request', (r) => {
      const u = new URL(r.url());
      if ((u.protocol === 'http:' || u.protocol === 'https:') && !allowed.has(u.origin)) foreign.push(r.url());
    });
  track(page);

  await signInAsInterviewer(page);
  const candidateName = uniqueCandidate();
  const session = await createSession(page, candidateName);

  const candidateContext = await browser.newContext();
  const candidate = await candidateContext.newPage();
  track(candidate);
  await candidate.goto(session.candidateUrl);
  await expect(candidate.getByRole('heading', { name: 'Waiting for your interviewer to start' })).toBeVisible();

  await page.goto(session.roomPath);
  await expect(page.getByRole('tab', { name: 'Rubric' })).toBeVisible();
  await page.getByRole('button', { name: 'Start interview' }).click();

  // The waiting room polls REST and moves into the live room once started.
  await expect(candidate.getByTestId('board')).toBeVisible();
  await expect(candidate.getByRole('tab', { name: 'Rubric' })).toHaveCount(0);
  await expect(candidate.getByRole('tab', { name: 'Notes' })).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Participants' })).toContainText(candidateName);
  await expect(candidate.getByRole('list', { name: 'Participants' })).toContainText('Interviewer');

  // Candidate draws; the interviewer's board receives it live.
  await drawRectangle(candidate);
  await expect(candidate.getByTestId('board')).toHaveAttribute('data-element-count', '1');
  await expect(page.getByTestId('board')).toHaveAttribute('data-element-count', '1');

  // Extend by 10 minutes.
  const minutesLeft = async () => Number(/(\d+):\d{2} left/.exec((await page.getByRole('timer').textContent()) ?? '')?.[1] ?? NaN);
  await expect.poll(minutesLeft).toBeLessThanOrEqual(45);
  const before = await minutesLeft();
  await page.getByRole('button', { name: '+10 min' }).click();
  await expect.poll(minutesLeft).toBeGreaterThanOrEqual(before + 9);

  // End: the candidate's socket is closed with 4403 session_ended.
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'End interview' }).click();
  await expect(candidate.getByRole('heading', { name: 'The interview has ended' })).toBeVisible();
  await expect(page.getByRole('timer')).toHaveText('Interview ended');

  // Export the board and check the candidate's rectangle is in it.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .excalidraw' }).click();
  const file = await (await download).path();
  const scene = JSON.parse(await readFile(file, 'utf8')) as { elements: { type: string; isDeleted?: boolean }[] };
  expect(scene.elements.filter((e) => e.type === 'rectangle' && !e.isDeleted)).toHaveLength(1);

  // Revisit later: read-only room with export, no controls.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Export PNG' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start interview' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'End interview' })).toHaveCount(0);

  expect((await page.request.get(FONT)).status()).toBe(200);
  expect(foreign).toEqual([]);
  await candidateContext.close();
});
```

- [ ] **Step 5: Run it**

Run: `pnpm nx e2e web-e2e`. The infra must be up (`docker compose up -d`). Dev servers already running is fine; otherwise Playwright starts them.
Expected: 1 passed.

If something fails, read the trace in `dist/.playwright/apps/web-e2e/test-output` before changing anything. Selectors must follow the app's accessible names (above), not CSS classes.

- [ ] **Step 6: Lint, typecheck and commit**

```bash
pnpm nx run-many -t lint typecheck -p web-e2e
pnpm nx run-many -t lint test typecheck build && pnpm nx format:check --all
pnpm nx format:write --uncommitted
git add apps/web-e2e nx.json package.json pnpm-lock.yaml tsconfig.json
git commit -m "test(web-e2e): Playwright with real Keycloak — full interview flow"
```

---

### Task 12: E2E connection-contract paths, the container run, and the docs

**Files:**
- Create: `apps/web-e2e/src/connection-contract.spec.ts`
- Modify: `README.md` (e2e and "Deployment notes" sections)

**Interfaces:**
- Consumes:
  - Tasks 4 and 11 (revalidation `1008`, helpers)
  - Task 8 (invalid-link copy)
  - Task 10 (stack at `:8088`)
- Covers, end to end through the real collab server and proxy (Vite in dev, nginx in containers):
  - 4403 `invite_revoked`
  - 4403 `session_ended` after cancel
  - `/join` rejection of a replaced link
  - the 401-at-upgrade → `unreachable` → REST-probe path, driven by sign-out elsewhere
  - (4403 `session_ended` after end, and the waiting room → live transition, are in Task 11.)

- [ ] **Step 1: Write the spec**

`src/connection-contract.spec.ts`:
```ts
import { expect, test, type Page } from '@playwright/test';
import { signInAsInterviewer } from './support/auth.js';
import { KEYCLOAK_ORIGIN } from './support/env.js';
import { createSession, uniqueCandidate, type CreatedSession } from './support/sessions.js';

async function startLiveSession(page: Page): Promise<CreatedSession> {
  await signInAsInterviewer(page);
  const session = await createSession(page, uniqueCandidate());
  await page.goto(session.roomPath);
  await page.getByRole('button', { name: 'Start interview' }).click();
  await expect(page.getByRole('button', { name: 'End interview' })).toBeVisible();
  return session;
}

test('a candidate whose link is replaced is shown the invalid-link screen; only the new link works', async ({ page, browser }) => {
  const session = await startLiveSession(page);
  const candidateContext = await browser.newContext();
  const candidate = await candidateContext.newPage();
  await candidate.goto(session.candidateUrl);
  await expect(candidate.getByTestId('board')).toBeVisible();

  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'New candidate link' }).click();
  const newLink = await page.getByRole('dialog', { name: 'New candidate link' }).getByLabel('Candidate link').inputValue();

  // The open socket is closed with 4403 invite_revoked.
  await expect(candidate.getByRole('heading', { name: 'This link is no longer valid' })).toBeVisible();
  await expect(candidate.getByText('A newer invitation link was issued')).toBeVisible();

  const freshContext = await browser.newContext();
  const fresh = await freshContext.newPage();
  await fresh.goto(session.candidateUrl);
  await expect(fresh).toHaveURL(/\/link-invalid\?reason=invite_revoked$/);
  await fresh.goto(newLink);
  await expect(fresh.getByTestId('board')).toBeVisible();

  await candidateContext.close();
  await freshContext.close();
});

test('cancelling ends the interview for the candidate (4403 session_ended)', async ({ page, browser }) => {
  const session = await startLiveSession(page);
  const candidateContext = await browser.newContext();
  const candidate = await candidateContext.newPage();
  await candidate.goto(session.candidateUrl);
  await expect(candidate.getByTestId('board')).toBeVisible();

  await page.getByRole('button', { name: 'Cancel…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cancel interview' });
  await dialog.getByLabel('Reason (optional, private)').fill('e2e: candidate no-show');
  await dialog.getByRole('button', { name: 'Cancel interview' }).click();

  await expect(candidate.getByRole('heading', { name: 'The interview has ended' })).toBeVisible();
  await expect(candidate.getByText('e2e: candidate no-show')).toHaveCount(0);
  await expect(page.getByRole('timer')).toHaveText('Interview ended');
  await candidateContext.close();
});

test('signing out in another tab takes an open room away (revalidation → 401 at upgrade → REST probe)', async ({ page }) => {
  // The server revalidates every COLLAB_REVALIDATE_MS (2 s when Playwright starts the servers, 60 s otherwise).
  test.setTimeout(240_000);
  await startLiveSession(page);
  await expect(page.getByTestId('board')).toBeVisible();

  const other = await page.context().newPage();
  await other.goto('/');
  await other.getByRole('button', { name: 'Sign out' }).click();
  await other.waitForURL((url) => url.origin === KEYCLOAK_ORIGIN);

  await expect(page.getByRole('heading', { name: 'Sign in to join this interview' })).toBeVisible({ timeout: 150_000 });
});
```

- [ ] **Step 2: Run against the dev servers**

Run: `pnpm nx e2e web-e2e`. Expected: 4 passed.

If the sign-out test times out, check that Task 4's revalidation timer runs, and look for `collab: closing a socket that lost access` in the API log. Do not lengthen the timeout past 150 s for the heading.

- [ ] **Step 3: Run the same suite against the containers**

```bash
docker compose --profile app up -d --build --wait
E2E_BASE_URL=http://localhost:8088 pnpm nx e2e web-e2e --skip-nx-cache
```
Expected: 4 passed. This is what proves the nginx WebSocket proxy, production cookies on `http://localhost` and OIDC through `OIDC_INTERNAL_URL`.
- If sign-in fails only in containers, check the cookie flags first (`NODE_ENV=production` sets `Secure`, which Chromium accepts on `http://localhost`).
- Record the outcome in the report.

Then: `docker compose --profile app stop api web`.

- [ ] **Step 4: README — e2e and deployment notes**

Add after "Full stack in containers":
```md
## End-to-end tests

Playwright drives two browser contexts (interviewer and candidate) through the real Keycloak login.

```bash
docker compose up -d                      # infra
pnpm exec playwright install chromium     # once
pnpm nx e2e web-e2e                       # starts (or reuses) the dev servers on :4200
E2E_BASE_URL=http://localhost:8088 pnpm nx e2e web-e2e   # against `docker compose --profile app up`
```

Reports and traces: `dist/.playwright/apps/web-e2e/`.

## Deployment notes

- Run exactly **one** API replica. Live collaboration documents and session events are held in process memory;
  scaling out needs sticky routing per session plus the Hocuspocus Redis extension.
- Required in production: `PUBLIC_BASE_URL`, `OIDC_ISSUER`, `OIDC_CLIENT_SECRET`, `COOKIE_SECRET` (≥ 32 chars).
  Set `OIDC_INTERNAL_URL` when the API reaches the identity provider on a different origin than browsers do.
- WebSocket upgrades are accepted only from `PUBLIC_BASE_URL`'s origin. Open sockets are re-checked every
  `COLLAB_REVALIDATE_MS` (default 60000), so sign-out and role removal reach live rooms.
```

- [ ] **Step 5: Final verification and commit**

```bash
pnpm nx run-many -t lint test typecheck build && pnpm nx format:check --all
pnpm nx format:write --uncommitted
git add apps/web-e2e README.md
git commit -m "test(web-e2e): connection contract (invite revoked, cancel, sign-out revalidation) on dev and container stacks; docs"
```

---

## Spec and carry-forward coverage

| Requirement | Task |
|---|---|
| §8 e2e: create → join → draw → seen live → extend → end → candidate ended, interviewer read-only + export (two contexts, real Keycloak) | 11 |
| §10 `app` profile: api + web, nginx proxies `/api` `/auth` `/join` `/collab` | 9, 10 |
| §10 `docker compose --profile app up --build` | 10, 12 |
| §11 risk 3 / Plan 3: single API replica | Global Constraints, 10 (compose comment), 12 (README) |
| Plan 3: WS ping interval, Origin allowlist, per-document size and rate caps | 4, 5 |
| Plan 3: interviewer revocation on open sockets | 4 (revalidation), 12 (e2e) |
| Plan 3: production image includes `@hocuspocus/server`, `ws`, `yjs` | 9 (Step 4) |
| Plan 3: full Keycloak browser login in Playwright | 11, 12 |
| Plan 3: production image `NODE_ENV=production`; prune `testcontainers`/`vitest` | 2, 9 |
| Plan 3: compose comments on `user: root`; ports on 127.0.0.1 | 10 |
| Plan 3: Prettier tooling | 1 |
| Plan 3: persistence tests (PAY_PER_REQUEST, projection, TTL, queryAll pagination, stale/missing update) and `fromItem<T>` | 2 |
| Plan 3: close dynamo/s3 clients when `createApp` startup throws | 3 |
| Plan 4: Playwright proves 4403 / not_started / 401-probe through the real server and proxy | 11 (waiting room → live, end), 12 (revoked, cancel, 401 probe); WS `not_started` rejection stays unit-covered (R1) |
| Plan 4: route-level code splitting | 7 |
| Plan 4: hide the embeddable tool; filter pasted or dropped images | 6 |
| Plan 4: `ConsistentRead` for session reads that gate access | 2 |
| Plan 4: revoked-candidate wording | 8 (R3) |
| Plan 4: self-hosted Excalidraw fonts | 7 (served), 10 (nginx), 11 (asserted, no foreign requests) |
| Plan 4 polish: archive failure, not_started backoff, generator leftovers (.babelrc, README stubs, nx.json babel, extensionless import), `useNow` after end, NotesEditor `user` changes | 7 (import), 8 |
| Plan 3: orphaned S3 seeds, session-read performance | Deferred (Global Constraints) |
