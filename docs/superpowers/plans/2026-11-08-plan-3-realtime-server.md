# Plan 3: Real-time Server (Hocuspocus on the API process)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Yjs real-time collaboration to the API process, so interviewers and the candidate can co-edit the board (and interviewers can share notes). It covers:
- authentication on the WebSocket connection request
- per-document access rules
- S3 persistence and periodic checkpoints
- server-authoritative `session.state` broadcasts
- read-only mode and candidate disconnection when a session ends

**Architecture:**
- A new library, `api/collab-server`, owns a Hocuspocus instance with no HTTP listener of its own.
- `createApp` creates it and attaches it to Fastify's underlying Node `http.Server`. A `ws` `WebSocketServer({ noServer: true })` handles `upgrade` requests on `/collab`.
- The connecting user's identity comes from the Cookie header via `resolveIdentityFromCookieHeader` (Plan 2), and is passed to Hocuspocus as the connection's default context.
- The Hocuspocus hooks do the following:
  - `onAuthenticate` enforces spec §7.1 per document.
  - `onLoadDocument` and `onStoreDocument` read and write `latest.bin` in S3.
  - `connected` sends the current `session.state` to the new connection.
- The `SessionEvents.sessionChanged` hook from Plan 2 broadcasts state changes. When a session ends it makes interviewer connections read-only, closes candidate connections, and writes a final checkpoint.

**Tech Stack:** `@hocuspocus/server` 4.8, `@hocuspocus/provider` 4.8 (tests only), `ws` 8.22, yjs 13.6, Fastify 5, Vitest + Testcontainers.

**Spec:** `docs/superpowers/specs/2026-11-08-swint-foundation-design.md`. The binding sections are §6 (lifecycle, timer), §7.1 (documents and access), §7.3 (presence) and §8 (errors, logging, shutdown).

**Depends on (already on `main`):**
- `@swint/shared-domain`: `docAccess`, `isFinished`, `SessionStatus`
- `@swint/shared-collab-protocol`: `docName`, `parseDocName`, `encodeServerMessage`, `parseServerMessage`, `CLOSE_REASONS`, `getBoardElements`
- `@swint/api-util-rpc`: `Identity`, `Clock`
- `@swint/api-data-access-persistence`: `SessionsRepo`, `BlobStore`, `blobKeys`, `SessionRecord`, and the `./testing` helpers
- `@swint/api-feature-auth`: `CookieHeaderIdentityResolver`, `createCookieIdentityResolver`, `COOKIE`
- `@swint/api-feature-sessions`: `SessionEvents`, `noopSessionEvents`
- `apps/api`: `createApp` returns `{ server, repos, resolveIdentityFromCookieHeader, close }`, and `main.ts` handles graceful shutdown

Read the `src/index.ts` exports of each of these before starting a task that uses it.

## Global Constraints

**Carried over**
- Run tasks through Nx (`pnpm nx <target> <project>`). Never guess CLI flags. Add plugins with `pnpm nx add`.
- Relative TypeScript imports use `.js` extensions. Nx project names have no `@swint/` prefix; import paths are `@swint/<project-name>`.
- Never commit `.superpowers/`. Stage files by explicit path (never `git add -A`). Commit after every task with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Zero lint warnings. `@nx/dependency-checks` is on, so every library declares exactly the packages its non-spec code imports. Run `pnpm install && pnpm nx sync` after changing dependencies.
- **Test-only code must never be compiled into a library's `dist`.** Put helpers under `src/testing/` and exclude `src/testing/**` in `tsconfig.lib.json`. Include it in `tsconfig.spec.json`, and add it to dependency-checks `ignoredFiles`.
- Integration tests use Testcontainers via `@swint/api-data-access-persistence/testing`. That means `createTestStores()` plus the vitest `globalSetup` at `libs/api/data-access-persistence/src/testing/global-setup.ts`, with `hookTimeout: 120_000` and `testTimeout: 30_000`. Leave no containers or server processes running.
- Times are epoch ms everywhere.

**Library**

| Project | Path | Tags |
|---|---|---|
| `api-collab-server` | `libs/api/collab-server` | `scope:api,type:feature` |

**Fixed values (spec §7.1)**
- WebSocket path: `/collab`. Plan 4's Vite dev proxy forwards `/collab` with `ws: true`.
- Document names: `session:{id}:board` and `session:{id}:notes` (via `docName` / `parseDocName`).
- Access comes from `docAccess(role, kind, status)`:
  - `'none'` rejects the connection.
  - `'read'` opens it with `readOnly: true`.
  - `'write'` opens it with `readOnly: false`.
- Rejection reasons, from `CLOSE_REASONS` (`unauthenticated | forbidden | invite_revoked | session_ended | not_started`):
  - no identity at upgrade → HTTP `401` on the upgrade response (socket destroyed)
  - unknown or malformed document name, session not found, other org, or a candidate on another session → `forbidden`
  - a candidate on notes → `forbidden`
  - a candidate on the board while `created` → `not_started`
  - a candidate on the board while `ended`/`cancelled` → `session_ended`
- Persistence keys (`blobKeys`):
  - board: `sessionBoardLatest(orgId, id)`
  - notes: `sessionNotesLatest(orgId, id)`
  - checkpoints: `sessionBoardCheckpoint(orgId, id, ts)`
- Saving: Hocuspocus `debounce: 2000`, `maxDebounce: 10000`. Both are configurable through deps so tests can use small values.
- `onStoreDocument` retries S3 writes up to 3 times with backoff (100 ms, 400 ms, 1600 ms) and logs each failure. The live document stays in memory.
- Checkpoints: every 5 minutes (`checkpointIntervalMs`, configurable) while a board document is loaded and its session is `live`. Also exactly once when the session reaches `ended`/`cancelled`.
- `session.state` messages: `{ type: 'session.state', status, startedAt, durationSec, extensionSec, serverNow }`. Always built from the stored `SessionRecord` with `encodeServerMessage`.
  - Sent to each new board connection in the `connected` hook.
  - Broadcast to every board connection after each `sessionChanged`.
- When a session finishes (`ended` or `cancelled`):
  - every interviewer connection on both documents gets `readOnly = true`
  - every candidate connection is closed with `{ code: 4403, reason: 'session_ended' }`
- Clients never send stateless messages. The server ignores any it receives: it logs at debug and doesn't broadcast them.
- `SessionEvents.sessionChanged` implementations must never throw. The collab implementation catches and logs everything (carry-forward from Plan 2).
- Logs include `sessionId` (and `requestId` where one exists). They never include document content, notes, rubric, cookies or tokens.

**Hocuspocus integration facts** (verified in `@hocuspocus/server@4.8.0` type declarations, `dist/index.d.ts`)
- `new Hocuspocus({ ...hooks, debounce, maxDebounce, quiet: true })` gives an instance with no listener.
- `hocuspocus.handleConnection(webSocket, request: Request, defaultContext)` returns a `ClientConnection`. The integration must call `client.handleMessage(new Uint8Array(data))` for each binary message, `client.handleClose({ code, reason })` on close, and `client.touch()` on pong.
  - `request` is a **WHATWG `Request`**, so build one from the Node `IncomingMessage` with `new Request(url, { headers })`.
- Hooks used: `onAuthenticate({ context, documentName, connectionConfig })`, `connected({ connection, documentName, context })`, `onLoadDocument({ document, documentName, context })`, `onStoreDocument({ document, documentName, lastContext })`, `onStateless({ connection, documentName, payload })` and `afterUnloadDocument({ documentName })`.
- Throwing in `onAuthenticate` rejects that document. The provider receives `onAuthenticationFailed({ reason })`, where `reason` is the thrown error's message. **Task 3 verifies this exact behaviour.** If the reason is passed differently, adapt the server, never the reason strings.
- `hocuspocus.documents: Map<string, Document>`. `Document.getConnections(): Connection[]` and `Document.broadcastStateless(payload)`. `Connection.readOnly` (mutable), `connection.context`, `connection.sendStateless(payload)` and `connection.close({ code, reason })`.
- `hocuspocus.flushPendingStores()` and `hocuspocus.closeConnections()` are used for shutdown.
- **Provider in Node tests:** `new HocuspocusProvider({ url, name, token: 'cookie', document, WebSocketPolyfill, onAuthenticationFailed, onStateless, onSynced })`.
  - The `token` value is ignored by the server, but it must be non-empty so the provider sends its auth message.
  - Pass a `ws` subclass as `WebSocketPolyfill` so a `Cookie` header can be set. The exact option name and location (on `HocuspocusProvider` or `HocuspocusProviderWebsocket`) must be checked in `@hocuspocus/provider@4.8.0`'s `.d.ts` in Task 3. Keep the test helper's own interface stable.

**Carry-forwards into this plan** (from Plan 1 and Plan 2 reviews)
- `session.state` is sent immediately on connect. It is the only source of the clock offset, because `room.get` has no `serverNow`.
- Stateless messages are built only from domain state. The schema also gets a `superRefine`: `status === 'live'` ⇒ `startedAt !== null`.
- `docAccess === 'none'` maps to the right close reason (see the table above).
- `sessionChanged` never throws.
- `requestId` is added to the oRPC `onError` log (Task 6).
- Shutdown gets a 10 s timeout and a second signal force-quits. SIGTERM flushes Hocuspocus stores before exiting (Task 6).
- Seeds: tests cover loading the board seeded at session creation (Plan 2 writes `latest.bin`), and an empty/missing `latest.bin`.
- The tampered-signature and precedence resolver tests already exist from the Plan 2 fix wave. Task 6 adds only the WebSocket-level ones.
- **Deliberately out of scope:**
  - server-side validation of board element shapes (spec says "optionally"; deferred to Plan 4's client-side validation)
  - the Redis extension for multiple instances

---

## File structure (created or modified by this plan)

```
libs/shared/collab-protocol/src/lib/stateless.ts           (modify) superRefine: live ⇒ startedAt
libs/shared/collab-protocol/src/lib/stateless.spec.ts      (modify)
libs/api/collab-server/
  package.json, project config, tsconfig.lib.json (exclude src/testing/**), tsconfig.spec.json, eslint.config.mjs, vitest config
  src/index.ts
  src/lib/access.ts                    authorizeDocument() → { readOnly } | throws CollabAccessError(reason)
  src/lib/access.spec.ts
  src/lib/session-state.ts             sessionStateMessage(rec, now) → string
  src/lib/session-state.spec.ts
  src/lib/doc-store.ts                 createDocStore(): load/store/checkpoint with retry
  src/lib/doc-store.spec.ts
  src/lib/collab-server.ts             createCollabServer(deps) → CollabServer
  src/lib/upgrade.ts                   attachUpgradeHandler(httpServer, …) (ws + WHATWG Request bridge)
  src/lib/collab-server.spec.ts        real-time integration tests (auth, sync, state, persistence, stateless)
  src/lib/session-events.spec.ts       sessionChanged broadcasts / end-of-session behaviour / checkpoints
  src/testing/collab-test-kit.ts       test-only: start http server + collab, provider factory with cookie header
apps/api/src/app/create-app.ts         (modify) build + attach collab; compose events; close ordering
apps/api/src/app/server.ts             (modify) requestId in onError log
apps/api/src/main.ts                   (modify) shutdown timeout + force-quit on second signal
apps/api/src/app/collab.integration.spec.ts   end-to-end over a real listening createApp server
README.md                              (modify) collab endpoint note
```

---

### Task 1: Stateless schema invariant and the `api-collab-server` scaffold

**Files:**
- Modify: `libs/shared/collab-protocol/src/lib/stateless.ts`, `stateless.spec.ts`
- Create (generator): `libs/api/collab-server`
- Create: `libs/api/collab-server/src/lib/session-state.ts`, `session-state.spec.ts`

**Interfaces:**
- Produces:
  - project `api-collab-server`, imported as `@swint/api-collab-server`
  - `function sessionStateMessage(rec: Pick<SessionRecord, 'status' | 'startedAt' | 'durationSec' | 'extensionSec'>, nowMs: number): string`

- [ ] **Step 1: Branch**

```bash
git checkout -b feat/realtime-server main
```

(If this plan's document lives on another branch, e.g. `docs/plan-3`, branch from that branch instead.)

- [ ] **Step 2: Write the failing schema test**

Append to `libs/shared/collab-protocol/src/lib/stateless.spec.ts`:

```ts
describe('session.state invariants', () => {
  it('rejects live without startedAt', () => {
    expect(() => encodeServerMessage({ ...msg, status: 'live', startedAt: null })).toThrow();
    expect(parseServerMessage(JSON.stringify({ ...msg, status: 'live', startedAt: null }))).toBeNull();
  });
  it('allows created/cancelled without startedAt', () => {
    expect(parseServerMessage(JSON.stringify({ ...msg, status: 'created', startedAt: null }))).not.toBeNull();
    expect(parseServerMessage(JSON.stringify({ ...msg, status: 'cancelled', startedAt: null }))).not.toBeNull();
  });
});
```

Run `pnpm nx test shared-collab-protocol` and confirm the first test FAILS.

- [ ] **Step 3: Implement the invariant**

In `stateless.ts`, refine `sessionStateMessageSchema`. Keep the exported name, and keep it usable inside `z.discriminatedUnion` (zod 4 supports refinements on union members). If it doesn't, move the refine onto `serverMessageSchema`.

```ts
export const sessionStateMessageSchema = z
  .object({
    type: z.literal('session.state'),
    status: z.enum(SESSION_STATUSES as [SessionStatus, ...SessionStatus[]]),
    startedAt: epochMs.nullable(),
    durationSec: z.number().int().nonnegative(),
    extensionSec: z.number().int().nonnegative(),
    serverNow: epochMs,
  })
  .refine((m) => m.status !== 'live' || m.startedAt !== null, {
    message: 'live sessions must have startedAt',
    path: ['startedAt'],
  });
```

Run `pnpm nx run-many -t test lint typecheck -p shared-collab-protocol` and confirm it PASSES.

- [ ] **Step 4: Generate the library**

```bash
pnpm nx g @nx/js:library --help    # confirm flags
pnpm nx g @nx/js:library --directory=libs/api/collab-server --name=api-collab-server --importPath=@swint/api-collab-server --bundler=tsc --unitTestRunner=vitest --linter=eslint --tags=scope:api,type:feature --no-interactive
```

- Delete the placeholder sources and specs, and empty `src/index.ts`.
- Set `"types": ["node"]` in `tsconfig.lib.json`.
- Add `"src/testing/**"` to `tsconfig.lib.json` `exclude`.
- Make sure `tsconfig.spec.json` `include` covers `src/testing/**/*.ts`.
- In the library's `eslint.config.mjs`, add `'{projectRoot}/src/testing/**'` to the `@nx/dependency-checks` `ignoredFiles`. Copy the shape from `libs/api/feature-sessions/eslint.config.mjs`.
- In the vitest config `test` block, add the persistence `globalSetup` (path `../data-access-persistence/src/testing/global-setup.ts`), `hookTimeout: 120_000`, `testTimeout: 30_000` and `passWithNoTests: true`.

- [ ] **Step 5: Install dependencies**

```bash
pnpm add -w @hocuspocus/server@^4.8.0 @hocuspocus/provider@^4.8.0 ws@^8.22.1
pnpm add -w -D @types/ws@^8.18.2
```

In `libs/api/collab-server/package.json` `dependencies`, add:
- `@swint/shared-domain`, `@swint/shared-collab-protocol`, `@swint/api-util-rpc`, `@swint/api-data-access-persistence`, `@swint/api-feature-auth`, `@swint/api-feature-sessions` (all `workspace:*`)
- `@hocuspocus/server`, `ws`, `yjs`

Only keep the ones the non-spec code imports by the end of Task 5. Remove unused ones then, so dependency-checks passes. Run `pnpm install && pnpm nx sync`.

- [ ] **Step 6: Write the failing test for `sessionStateMessage`**

`libs/api/collab-server/src/lib/session-state.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseServerMessage } from '@swint/shared-collab-protocol';
import { sessionStateMessage } from './session-state.js';

describe('sessionStateMessage', () => {
  it('encodes the record timer fields plus serverNow', () => {
    const payload = sessionStateMessage({ status: 'live', startedAt: 1000, durationSec: 2700, extensionSec: 300 }, 5000);
    expect(parseServerMessage(payload)).toEqual({
      type: 'session.state',
      status: 'live',
      startedAt: 1000,
      durationSec: 2700,
      extensionSec: 300,
      serverNow: 5000,
    });
  });
  it('throws for an impossible record (live without startedAt)', () => {
    expect(() => sessionStateMessage({ status: 'live', startedAt: null, durationSec: 1, extensionSec: 0 }, 1)).toThrow();
  });
});
```

Run `pnpm nx test api-collab-server` and confirm it FAILS (module missing).

- [ ] **Step 7: Implement**

`libs/api/collab-server/src/lib/session-state.ts`:

```ts
import { encodeServerMessage } from '@swint/shared-collab-protocol';
import type { SessionRecord } from '@swint/api-data-access-persistence';

export function sessionStateMessage(
  rec: Pick<SessionRecord, 'status' | 'startedAt' | 'durationSec' | 'extensionSec'>,
  nowMs: number,
): string {
  return encodeServerMessage({
    type: 'session.state',
    status: rec.status,
    startedAt: rec.startedAt,
    durationSec: rec.durationSec,
    extensionSec: rec.extensionSec,
    serverNow: nowMs,
  });
}
```

`src/index.ts`: `export * from './lib/session-state.js';`

- [ ] **Step 8: Verify and commit**

```bash
pnpm nx run-many -t test lint typecheck -p shared-collab-protocol,api-collab-server
git add libs/shared/collab-protocol/src/lib/stateless.ts libs/shared/collab-protocol/src/lib/stateless.spec.ts libs/api/collab-server package.json pnpm-lock.yaml tsconfig.json
git commit -m "feat(api-collab-server): scaffold library; session.state invariant and encoder

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Stage any other files that `nx g` or `nx sync` changed, e.g. root `tsconfig.json` references, by explicit path.)

---

### Task 2: Access policy (`authorizeDocument`)

**Files:**
- Create: `libs/api/collab-server/src/lib/access.ts`
- Test: `libs/api/collab-server/src/lib/access.spec.ts`
- Modify: `libs/api/collab-server/src/index.ts`

**Interfaces:**
- Consumes: `docAccess`, `isFinished` (domain); `parseDocName`, `CloseReason` (collab-protocol); `Identity` (util-rpc); `SessionRecord` (persistence)
- Produces:

```ts
export class CollabAccessError extends Error { constructor(readonly reason: CloseReason) }  // message === reason
export interface DocTarget { sessionId: string; kind: DocKind }
export function targetOf(documentName: string): DocTarget;                 // throws CollabAccessError('forbidden') if malformed
export function authorizeDocument(identity: Identity, target: DocTarget, session: SessionRecord | null): { readOnly: boolean };
```

Rules, in order:
1. `session === null` → `forbidden`.
2. `session.orgId !== identity.orgId` → `forbidden`.
3. If the identity is a candidate and `identity.sessionId !== target.sessionId` → `forbidden`.
4. If the identity is an interviewer without the `interviewer` role → `forbidden`.
5. Look up `docAccess(role, kind, status)`.
   - `'write'` → `{ readOnly: false }`.
   - `'read'` → `{ readOnly: true }`.
   - `'none'`:
     - a candidate on notes → `forbidden`
     - a candidate on the board while `created` → `not_started`
     - a candidate on the board while finished → `session_ended`
     - anything else → `forbidden`

- [ ] **Step 1: Write the failing tests**

`libs/api/collab-server/src/lib/access.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Identity } from '@swint/api-util-rpc';
import type { SessionRecord } from '@swint/api-data-access-persistence';
import type { SessionStatus } from '@swint/shared-domain';
import { authorizeDocument, CollabAccessError, targetOf } from './access.js';

const session = (status: SessionStatus, over: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 's1',
  orgId: 'default',
  templateId: 't1',
  templateSnapshot: { title: 'T', instructionsMd: '', rubricMd: '', durationMin: 45, boardSeedKey: null },
  candidateName: 'Bo',
  status,
  startedAt: status === 'created' ? null : 1,
  durationSec: 2700,
  extensionSec: 0,
  endedAt: null,
  endedBy: null,
  cancelReason: null,
  activeInviteHash: 'h',
  createdBy: 'sub-1',
  createdAt: 1,
  version: 1,
  ...over,
});
const interviewer: Identity = { kind: 'interviewer', sub: 'sub-1', name: 'Ada', email: null, orgId: 'default', roles: ['interviewer'] };
const candidate: Identity = { kind: 'candidate', sessionId: 's1', orgId: 'default', inviteHash: 'h', name: 'Bo' };

const reasonOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(CollabAccessError);
    return (e as CollabAccessError).reason;
  }
  throw new Error('expected CollabAccessError');
};

describe('targetOf', () => {
  it('parses valid names and rejects others as forbidden', () => {
    expect(targetOf('session:s1:board')).toEqual({ sessionId: 's1', kind: 'board' });
    expect(reasonOf(() => targetOf('session:s1:code'))).toBe('forbidden');
    expect(reasonOf(() => targetOf('anything'))).toBe('forbidden');
  });
});

describe('authorizeDocument (spec §7.1)', () => {
  it.each([
    ['created', 'board', false],
    ['live', 'board', false],
    ['ended', 'board', true],
    ['cancelled', 'board', true],
    ['created', 'notes', false],
    ['live', 'notes', false],
    ['ended', 'notes', true],
  ] as const)('interviewer %s/%s → readOnly %s', (status, kind, readOnly) => {
    expect(authorizeDocument(interviewer, { sessionId: 's1', kind }, session(status))).toEqual({ readOnly });
  });

  it('candidate: live board is writable', () => {
    expect(authorizeDocument(candidate, { sessionId: 's1', kind: 'board' }, session('live'))).toEqual({ readOnly: false });
  });

  it.each([
    ['created', 'board', 'not_started'],
    ['ended', 'board', 'session_ended'],
    ['cancelled', 'board', 'session_ended'],
    ['created', 'notes', 'forbidden'],
    ['live', 'notes', 'forbidden'],
    ['ended', 'notes', 'forbidden'],
  ] as const)('candidate %s/%s → %s', (status, kind, reason) => {
    expect(reasonOf(() => authorizeDocument(candidate, { sessionId: 's1', kind }, session(status)))).toBe(reason);
  });

  it('missing session, other org, other session, missing role → forbidden', () => {
    expect(reasonOf(() => authorizeDocument(interviewer, { sessionId: 's1', kind: 'board' }, null))).toBe('forbidden');
    expect(
      reasonOf(() => authorizeDocument(interviewer, { sessionId: 's1', kind: 'board' }, session('live', { orgId: 'other' }))),
    ).toBe('forbidden');
    expect(
      reasonOf(() => authorizeDocument({ ...candidate, sessionId: 's2' }, { sessionId: 's1', kind: 'board' }, session('live'))),
    ).toBe('forbidden');
    expect(
      reasonOf(() => authorizeDocument({ ...interviewer, roles: [] }, { sessionId: 's1', kind: 'board' }, session('live'))),
    ).toBe('forbidden');
  });
});
```

Run `pnpm nx test api-collab-server` and confirm it FAILS.

- [ ] **Step 2: Implement**

`libs/api/collab-server/src/lib/access.ts`:

```ts
import { docAccess, isFinished, type DocKind } from '@swint/shared-domain';
import { parseDocName, type CloseReason } from '@swint/shared-collab-protocol';
import { INTERVIEWER_ROLE, type Identity } from '@swint/api-util-rpc';
import type { SessionRecord } from '@swint/api-data-access-persistence';

export class CollabAccessError extends Error {
  constructor(readonly reason: CloseReason) {
    super(reason);
    this.name = 'CollabAccessError';
  }
}

export interface DocTarget {
  sessionId: string;
  kind: DocKind;
}

export function targetOf(documentName: string): DocTarget {
  const parsed = parseDocName(documentName);
  if (!parsed) throw new CollabAccessError('forbidden');
  return parsed;
}

export function authorizeDocument(
  identity: Identity,
  target: DocTarget,
  session: SessionRecord | null,
): { readOnly: boolean } {
  if (!session || session.orgId !== identity.orgId) throw new CollabAccessError('forbidden');
  if (identity.kind === 'candidate' && identity.sessionId !== target.sessionId) throw new CollabAccessError('forbidden');
  if (identity.kind === 'interviewer' && !identity.roles.includes(INTERVIEWER_ROLE)) {
    throw new CollabAccessError('forbidden');
  }

  const access = docAccess(identity.kind, target.kind, session.status);
  if (access === 'write') return { readOnly: false };
  if (access === 'read') return { readOnly: true };

  if (identity.kind === 'candidate' && target.kind === 'board') {
    if (session.status === 'created') throw new CollabAccessError('not_started');
    if (isFinished(session.status)) throw new CollabAccessError('session_ended');
  }
  throw new CollabAccessError('forbidden');
}
```

Export it from `src/index.ts`. Run `pnpm nx run-many -t test lint typecheck -p api-collab-server` and confirm it PASSES.

- [ ] **Step 3: Commit**

```bash
git add libs/api/collab-server/src/lib/access.ts libs/api/collab-server/src/lib/access.spec.ts libs/api/collab-server/src/index.ts
git commit -m "feat(api-collab-server): per-document access policy with close reasons

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Collab server core: WebSocket upgrade, authentication, sync and state on connect

**Files:**
- Create: `libs/api/collab-server/src/lib/upgrade.ts`, `collab-server.ts`
- Create: `libs/api/collab-server/src/testing/collab-test-kit.ts`
- Test: `libs/api/collab-server/src/lib/collab-server.spec.ts`
- Modify: `libs/api/collab-server/src/index.ts`, `package.json`

**Interfaces:**
- Consumes: Tasks 1–2; `CookieHeaderIdentityResolver`; `SessionsRepo`, `BlobStore`; `Clock`
- Produces:

```ts
export interface CollabLogger { debug(o: object, m?: string): void; info(o: object, m?: string): void; warn(o: object, m?: string): void; error(o: object, m?: string): void }
export interface CollabServerDeps {
  sessions: SessionsRepo;
  blobs: BlobStore;
  resolveIdentity: CookieHeaderIdentityResolver;
  clock: Clock;
  logger: CollabLogger;
  debounceMs?: number;            // default 2000
  maxDebounceMs?: number;         // default 10000
  checkpointIntervalMs?: number;  // default 300000 (used from Task 5)
}
export interface CollabContext { identity: Identity }
export interface CollabServer {
  readonly hocuspocus: Hocuspocus<CollabContext>;
  readonly events: SessionEvents;                 // real implementation lands in Task 5; no-op until then
  attach(httpServer: import('node:http').Server, path?: string): void;   // default '/collab'
  close(): Promise<void>;                          // flush stores, close connections, close ws server
}
export function createCollabServer(deps: CollabServerDeps): CollabServer;
```

The test kit (`src/testing/collab-test-kit.ts`, test-only and excluded from the build) produces:

```ts
export interface CollabTestKit {
  url: string;                                     // ws://127.0.0.1:<port>/collab
  stores: TestStores;                              // from persistence ./testing (sessions, blobs, …)
  collab: CollabServer;
  identities: Map<string, Identity>;               // cookie header value → identity (fake resolver)
  close(): Promise<void>;
}
export async function startCollabTestKit(opts?: Partial<Pick<CollabServerDeps, 'debounceMs' | 'maxDebounceMs' | 'checkpointIntervalMs'>> & { now?: () => number }): Promise<CollabTestKit>;
export interface TestClient {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  stateless: string[];                             // payloads received
  authFailure: Promise<string>;                    // resolves with the rejection reason
  synced: Promise<void>;
  closed: Promise<{ code?: number; reason?: string }>;
  destroy(): void;
}
export function connectClient(kit: CollabTestKit, documentName: string, cookie: string | null): TestClient;
export function seedSession(kit: CollabTestKit, rec: Partial<SessionRecord> & { id: string; status: SessionStatus }): Promise<SessionRecord>;
```

**Design notes**
- **`upgrade.ts`** exports `attachUpgradeHandler(httpServer, { path, hocuspocus, resolveIdentity, logger })`. It:
  - listens to `httpServer.on('upgrade', …)`;
  - ignores upgrades for other paths, leaving them to other handlers (if none exists, destroy the socket);
  - resolves the identity from `req.headers.cookie`. If there is no identity, it writes `HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n` and destroys the socket;
  - otherwise calls `wss.handleUpgrade(...)` and then `hocuspocus.handleConnection(ws, toWebRequest(req), { identity })`;
  - wires `ws.on('message', d => client.handleMessage(new Uint8Array(d as Buffer)))`, `ws.on('close', (code, reason) => client.handleClose({ code, reason: reason.toString() }))` and `ws.on('pong', () => client.touch())`;
  - returns a `close()` that closes the `WebSocketServer`.

  `toWebRequest(req)` builds `new Request(new URL(req.url ?? '/', 'http://localhost'), { headers })`, copying the Node headers. Array values are joined with `, `; the `cookie` header is joined with `; `.
- **`collab-server.ts`** builds `new Hocuspocus<CollabContext>({ quiet: true, debounce, maxDebounce, async onAuthenticate, async connected, async onLoadDocument, async onStoreDocument, async onStateless })`. The `onLoadDocument` and `onStoreDocument` bodies are filled in by Task 4. In this task they just call `docStore` placeholders that do nothing.
  - **`onAuthenticate`:**
    1. `const identity = context.identity`.
    2. `const target = targetOf(documentName)`.
    3. `const session = await deps.sessions.get(identity.orgId, target.sessionId)`.
    4. `const { readOnly } = authorizeDocument(identity, target, session)`, then `connectionConfig.readOnly = readOnly`.
    5. `return { identity }`.
    6. Throw `CollabAccessError` as is; its message is the reason. Log a rejection at info as `{ sessionId: target?.sessionId, reason }`.
  - **`connected`:** if the document is a board, load the session (`deps.sessions.get(...)`) and `connection.sendStateless(sessionStateMessage(rec, deps.clock.now()))`. Wrap this in try/catch and log failures.
  - **`onStateless`:** log at debug `{ documentName }` and do nothing else.
  - **`close()`:** `hocuspocus.flushPendingStores()`, then `hocuspocus.closeConnections()`, then wait until `hocuspocus.getDocumentsCount() === 0` (poll every 50 ms, max 5 s), then close the ws server.

- [ ] **Step 1: Check the provider API**

Read `node_modules/@hocuspocus/provider/dist/*.d.ts` (or the package's types entry). Confirm:
- how to pass a custom WebSocket implementation (`WebSocketPolyfill`) and where it goes;
- the callback names `onAuthenticationFailed`, `onStateless`, `onSynced` / `synced`, `onClose`;
- how to destroy a provider.

Record the findings in your report, and write the test kit to match.

- [ ] **Step 2: Write the test kit**

`libs/api/collab-server/src/testing/collab-test-kit.ts`, implementing the interface above:
- `startCollabTestKit`:
  - `const stores = await createTestStores()`;
  - `identities = new Map()`;
  - `resolveIdentity = async (h) => (h ? identities.get(h) ?? null : null)`;
  - a `logger` that is a no-op (or collects entries);
  - `clock = { now: opts.now ?? Date.now }`;
  - `const collab = createCollabServer({...})`;
  - `const http = createServer()`, then `collab.attach(http)`, then `await new Promise(r => http.listen(0, '127.0.0.1', r))`;
  - `url = ws://127.0.0.1:${port}/collab`;
  - `close()` calls `collab.close()` and then closes `http`.
- `connectClient`:
  - creates a `ws` subclass that passes `{ headers: cookie ? { cookie } : {} }` to the constructor;
  - creates a `new Y.Doc()` and a provider with `token: 'cookie'`;
  - exposes promises that resolve on authentication failure (with the reason), on sync, and on close.
- `seedSession`: writes a full `SessionRecord`, with defaults like the access spec's `session()` helper, via `kit.stores.sessions.create(...)`, and returns it.

- [ ] **Step 3: Write the failing integration tests**

`libs/api/collab-server/src/lib/collab-server.spec.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { getBoardElements, parseServerMessage, docName } from '@swint/shared-collab-protocol';
import type { Identity } from '@swint/api-util-rpc';
import { connectClient, seedSession, startCollabTestKit, type CollabTestKit } from '../testing/collab-test-kit.js';

const ada: Identity = { kind: 'interviewer', sub: 'sub-1', name: 'Ada', email: null, orgId: 'default', roles: ['interviewer'] };
const bo = (sessionId: string): Identity => ({ kind: 'candidate', sessionId, orgId: 'default', inviteHash: 'h', name: 'Bo' });

let kit: CollabTestKit;
afterEach(async () => {
  await kit?.close();
});

async function setup(status: 'created' | 'live' | 'ended' = 'live') {
  kit = await startCollabTestKit({ debounceMs: 50, maxDebounceMs: 200 });
  const s = await seedSession(kit, { id: `s-${Math.random().toString(36).slice(2, 8)}`, status });
  kit.identities.set('ada', ada);
  kit.identities.set('bo', bo(s.id));
  return s;
}

describe('collab server: authentication', () => {
  it('upgrade without a recognised cookie is refused', async () => {
    const s = await setup();
    const c = connectClient(kit, docName.board(s.id), null);
    const closed = await c.closed;
    expect(closed).toBeDefined();
    c.destroy();
  });

  it('candidate cannot open notes (forbidden)', async () => {
    const s = await setup('live');
    const c = connectClient(kit, docName.notes(s.id), 'bo');
    await expect(c.authFailure).resolves.toBe('forbidden');
    c.destroy();
  });

  it('candidate cannot open the board before start (not_started)', async () => {
    const s = await setup('created');
    const c = connectClient(kit, docName.board(s.id), 'bo');
    await expect(c.authFailure).resolves.toBe('not_started');
    c.destroy();
  });

  it('candidate after end gets session_ended', async () => {
    const s = await setup('ended');
    const c = connectClient(kit, docName.board(s.id), 'bo');
    await expect(c.authFailure).resolves.toBe('session_ended');
    c.destroy();
  });

  it('candidate of another session is forbidden', async () => {
    const s = await setup('live');
    kit.identities.set('other', bo('someone-else'));
    const c = connectClient(kit, docName.board(s.id), 'other');
    await expect(c.authFailure).resolves.toBe('forbidden');
    c.destroy();
  });

  it('interviewer of another org is forbidden', async () => {
    const s = await setup('live');
    kit.identities.set('eve', { ...ada, orgId: 'other-org' });
    const c = connectClient(kit, docName.board(s.id), 'eve');
    await expect(c.authFailure).resolves.toBe('forbidden');
    c.destroy();
  });
});

describe('collab server: sync and session.state', () => {
  it('interviewer and candidate see each other’s board edits', async () => {
    const s = await setup('live');
    const a = connectClient(kit, docName.board(s.id), 'ada');
    const b = connectClient(kit, docName.board(s.id), 'bo');
    await Promise.all([a.synced, b.synced]);
    getBoardElements(b.doc).set('e1', { id: 'e1', version: 1, versionNonce: 1, index: 'a0', isDeleted: false });
    await expect.poll(() => getBoardElements(a.doc).get('e1')?.version).toBe(1);
    a.destroy();
    b.destroy();
  });

  it('sends session.state with serverNow on connect to board documents only', async () => {
    const s = await setup('live');
    const a = connectClient(kit, docName.board(s.id), 'ada');
    await a.synced;
    await expect.poll(() => a.stateless.length).toBeGreaterThan(0);
    expect(parseServerMessage(a.stateless[0])).toMatchObject({ type: 'session.state', status: 'live', serverNow: expect.any(Number) });
    const n = connectClient(kit, docName.notes(s.id), 'ada');
    await n.synced;
    await new Promise((r) => setTimeout(r, 200));
    expect(n.stateless).toEqual([]);
    a.destroy();
    n.destroy();
  });

  it('interviewer on an ended session is read-only: their edits do not reach others', async () => {
    const s = await setup('ended');
    const a = connectClient(kit, docName.board(s.id), 'ada');
    kit.identities.set('grace', { ...ada, sub: 'sub-2', name: 'Grace' });
    const g = connectClient(kit, docName.board(s.id), 'grace');
    await Promise.all([a.synced, g.synced]);
    getBoardElements(a.doc).set('x', { id: 'x', version: 1, versionNonce: 1, index: 'a0', isDeleted: false });
    await new Promise((r) => setTimeout(r, 300));
    expect(getBoardElements(g.doc).get('x')).toBeUndefined();
    a.destroy();
    g.destroy();
  });

  it('client stateless messages are ignored (not broadcast)', async () => {
    const s = await setup('live');
    const a = connectClient(kit, docName.board(s.id), 'ada');
    const b = connectClient(kit, docName.board(s.id), 'bo');
    await Promise.all([a.synced, b.synced]);
    const before = a.stateless.length;
    b.provider.sendStateless(JSON.stringify({ type: 'session.state', status: 'ended' }));
    await new Promise((r) => setTimeout(r, 300));
    expect(a.stateless.length).toBe(before);
    a.destroy();
    b.destroy();
  });
});
```

Notes for the implementer:
- `expect.poll` exists in Vitest 5. If a provider API name differs (e.g. `sendStateless`), adapt the **kit** and the calls, keeping the assertions.
- The "upgrade refused" test must assert the connection doesn't stay open. Accept whatever close or error signal the provider gives. If needed, make `connectClient` also resolve `closed` on a WebSocket `error` / `unexpected-response`.

Run `pnpm nx test api-collab-server` and confirm it FAILS.

- [ ] **Step 4: Implement `upgrade.ts` and `collab-server.ts`**

Follow the design notes above. Use `new WebSocketServer({ noServer: true })` from `ws`.
- `CollabServer.events` is `noopSessionEvents` for now; Task 5 replaces it.
- In `onAuthenticate`, if `context.identity` is missing (which should be impossible after the upgrade check), throw `new CollabAccessError('unauthenticated')`.

- [ ] **Step 5: Run the tests until they pass, then verify**

```bash
pnpm nx run-many -t test lint typecheck build -p api-collab-server
```

Confirm `libs/api/collab-server/dist` contains no `testing/` output. Make sure no containers or servers are left running.

- [ ] **Step 6: Commit**

```bash
git add libs/api/collab-server package.json pnpm-lock.yaml
git commit -m "feat(api-collab-server): websocket upgrade with cookie auth, per-document access, sync and session.state on connect

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Document persistence: load and store from S3 with retry

**Files:**
- Create: `libs/api/collab-server/src/lib/doc-store.ts`
- Test: `libs/api/collab-server/src/lib/doc-store.spec.ts`, and extend `collab-server.spec.ts` (persistence round-trip)
- Modify: `libs/api/collab-server/src/lib/collab-server.ts`, `src/index.ts`

**Interfaces:**
- Produces:

```ts
export interface DocStoreDeps { blobs: BlobStore; logger: CollabLogger; sleep?: (ms: number) => Promise<void> }
export interface DocStore {
  load(orgId: string, target: DocTarget): Promise<Uint8Array | null>;
  store(orgId: string, target: DocTarget, state: Uint8Array): Promise<void>;      // retries 3× (100/400/1600 ms), then throws
  checkpoint(orgId: string, sessionId: string, ts: number, state: Uint8Array): Promise<void>;  // same retry policy
}
export function createDocStore(deps: DocStoreDeps): DocStore;
```

Keys:
- board → `blobKeys.sessionBoardLatest`
- notes → `blobKeys.sessionNotesLatest`
- checkpoint → `blobKeys.sessionBoardCheckpoint`

Hook wiring in `collab-server.ts`:
- **`onLoadDocument({ document, documentName, context })`:**
  - `bytes = await docStore.load(context.identity.orgId, targetOf(documentName))`;
  - if `bytes`, `Y.applyUpdate(document, bytes)`;
  - a missing blob gives an empty document.
- **`onStoreDocument({ document, documentName, lastContext })`:**
  - `await docStore.store(lastContext.identity.orgId, targetOf(documentName), Y.encodeStateAsUpdate(document))`;
  - on final failure log at error `{ sessionId, err }` and rethrow, so Hocuspocus keeps the document dirty.
  - If `lastContext` can be missing (check the Hocuspocus behaviour), keep a per-document `orgId` map, filled in `onLoadDocument`, and use it instead.

- [ ] **Step 1: Write the failing `doc-store` unit tests**

`libs/api/collab-server/src/lib/doc-store.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { blobKeys } from '@swint/api-data-access-persistence';
import { createTestStores } from '@swint/api-data-access-persistence/testing';
import { createDocStore } from './doc-store.js';

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe('DocStore', () => {
  it('round-trips board and notes under the spec keys; missing → null', async () => {
    const { blobs } = await createTestStores();
    const store = createDocStore({ blobs, logger });
    await store.store('o1', { sessionId: 's1', kind: 'board' }, new Uint8Array([1, 2]));
    await store.store('o1', { sessionId: 's1', kind: 'notes' }, new Uint8Array([3]));
    await expect(blobs.getBytes(blobKeys.sessionBoardLatest('o1', 's1'))).resolves.toEqual(new Uint8Array([1, 2]));
    await expect(store.load('o1', { sessionId: 's1', kind: 'notes' })).resolves.toEqual(new Uint8Array([3]));
    await expect(store.load('o1', { sessionId: 'nope', kind: 'board' })).resolves.toBeNull();
  });

  it('checkpoint writes under the checkpoint key', async () => {
    const { blobs } = await createTestStores();
    await createDocStore({ blobs, logger }).checkpoint('o1', 's1', 1700000000000, new Uint8Array([9]));
    await expect(blobs.getBytes(blobKeys.sessionBoardCheckpoint('o1', 's1', 1700000000000))).resolves.toEqual(
      new Uint8Array([9]),
    );
  });

  it('retries failed writes with 100/400/1600 ms backoff, then throws', async () => {
    const putBytes = vi.fn().mockRejectedValue(new Error('s3 down'));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const store = createDocStore({ blobs: { putBytes } as never, logger, sleep });
    await expect(store.store('o1', { sessionId: 's1', kind: 'board' }, new Uint8Array([1]))).rejects.toThrow('s3 down');
    expect(putBytes).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([100, 400, 1600]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('succeeds on a retry', async () => {
    const putBytes = vi.fn().mockRejectedValueOnce(new Error('blip')).mockResolvedValue(undefined);
    const store = createDocStore({ blobs: { putBytes } as never, logger, sleep: async () => undefined });
    await expect(store.store('o1', { sessionId: 's1', kind: 'board' }, new Uint8Array([1]))).resolves.toBeUndefined();
    expect(putBytes).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Write the failing persistence round-trip tests**

Append to `collab-server.spec.ts`:

```ts
import * as Y from 'yjs';
import { blobKeys } from '@swint/api-data-access-persistence';

describe('collab server: persistence', () => {
  it('loads the board seeded at session creation (latest.bin)', async () => {
    const s = await setup('live');
    const seed = new Y.Doc();
    getBoardElements(seed).set('seed1', { id: 'seed1', version: 2, versionNonce: 3, index: 'a0', isDeleted: false });
    await kit.stores.blobs.putBytes(blobKeys.sessionBoardLatest('default', s.id), Y.encodeStateAsUpdate(seed));
    const a = connectClient(kit, docName.board(s.id), 'ada');
    await a.synced;
    expect(getBoardElements(a.doc).get('seed1')).toMatchObject({ version: 2 });
    a.destroy();
  });

  it('a session without latest.bin opens as an empty board', async () => {
    const s = await setup('live');
    const a = connectClient(kit, docName.board(s.id), 'ada');
    await a.synced;
    expect(getBoardElements(a.doc).size).toBe(0);
    a.destroy();
  });

  it('edits are stored (debounced) and survive a server restart', async () => {
    const s = await setup('live');
    const a = connectClient(kit, docName.board(s.id), 'ada');
    await a.synced;
    getBoardElements(a.doc).set('e1', { id: 'e1', version: 1, versionNonce: 1, index: 'a0', isDeleted: false });
    await expect
      .poll(async () => {
        const bytes = await kit.stores.blobs.getBytes(blobKeys.sessionBoardLatest('default', s.id));
        if (!bytes) return undefined;
        const d = new Y.Doc();
        Y.applyUpdate(d, bytes);
        return getBoardElements(d).get('e1')?.version;
      }, { timeout: 5000 })
      .toBe(1);
    a.destroy();
  });

  it('notes are persisted under the notes key', async () => {
    const s = await setup('live');
    const n = connectClient(kit, docName.notes(s.id), 'ada');
    await n.synced;
    n.doc.getXmlFragment('content').insert(0, [new Y.XmlText('hello')]);
    await expect
      .poll(() => kit.stores.blobs.getBytes(blobKeys.sessionNotesLatest('default', s.id)), { timeout: 5000 })
      .not.toBeNull();
    n.destroy();
  });
});
```

Run `pnpm nx test api-collab-server` and confirm the new tests FAIL.

- [ ] **Step 3: Implement `doc-store.ts` and wire the hooks**

```ts
import type { BlobStore } from '@swint/api-data-access-persistence';
import { blobKeys } from '@swint/api-data-access-persistence';
import type { DocTarget } from './access.js';
import type { CollabLogger } from './collab-server.js';

const BACKOFF_MS = [100, 400, 1600] as const;

export interface DocStoreDeps {
  blobs: BlobStore;
  logger: CollabLogger;
  sleep?: (ms: number) => Promise<void>;
}

export interface DocStore {
  load(orgId: string, target: DocTarget): Promise<Uint8Array | null>;
  store(orgId: string, target: DocTarget, state: Uint8Array): Promise<void>;
  checkpoint(orgId: string, sessionId: string, ts: number, state: Uint8Array): Promise<void>;
}

const keyFor = (orgId: string, t: DocTarget) =>
  t.kind === 'board' ? blobKeys.sessionBoardLatest(orgId, t.sessionId) : blobKeys.sessionNotesLatest(orgId, t.sessionId);

export function createDocStore(deps: DocStoreDeps): DocStore {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function putWithRetry(key: string, bytes: Uint8Array, sessionId: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await deps.blobs.putBytes(key, bytes);
        return;
      } catch (err) {
        if (attempt >= BACKOFF_MS.length) throw err;
        deps.logger.warn({ sessionId, attempt: attempt + 1, err }, 'collab store failed, retrying');
        await sleep(BACKOFF_MS[attempt]);
      }
    }
  }

  return {
    load: (orgId, target) => deps.blobs.getBytes(keyFor(orgId, target)),
    store: (orgId, target, state) => putWithRetry(keyFor(orgId, target), state, target.sessionId),
    checkpoint: (orgId, sessionId, ts, state) =>
      putWithRetry(blobKeys.sessionBoardCheckpoint(orgId, sessionId, ts), state, sessionId),
  };
}
```

If importing `CollabLogger` from `collab-server.ts` creates a circular import, move `CollabLogger` and `CollabContext` into `src/lib/types.ts` and import them from there in both files. Wire `onLoadDocument` and `onStoreDocument` as described above.

- [ ] **Step 4: Verify and commit**

```bash
pnpm nx run-many -t test lint typecheck build -p api-collab-server
git add libs/api/collab-server
git commit -m "feat(api-collab-server): S3 document persistence with retry; load seeded boards

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Session events: broadcasts, end-of-session enforcement and checkpoints

**Files:**
- Modify: `libs/api/collab-server/src/lib/collab-server.ts`
- Test: `libs/api/collab-server/src/lib/session-events.spec.ts`

**Interfaces:**
- `CollabServer.events: SessionEvents` is now the real implementation. Its `sessionChanged(rec)`:
  1. `const board = hocuspocus.documents.get(docName.board(rec.id))`. If it exists, `board.broadcastStateless(sessionStateMessage(rec, now))`.
  2. If `isFinished(rec.status)`, for each of the board and notes documents (if loaded), for each `connection` of `doc.getConnections()`:
     - if `connection.context.identity.kind === 'candidate'`, call `connection.close({ code: 4403, reason: 'session_ended' })`;
     - otherwise set `connection.readOnly = true`.

     Then, if the board is loaded, write one final checkpoint: `docStore.checkpoint(rec.orgId, rec.id, now, Y.encodeStateAsUpdate(board))`. Also stop that document's periodic checkpoint timer.
  3. If the status is `live` and the board is loaded but has no timer yet, start the periodic checkpoint timer.
  4. Wrap everything in try/catch: log at error `{ sessionId: rec.id, err }` and **never throw**.
- **Periodic checkpoints:**
  - **Start:** in `afterLoadDocument` (or right after `onLoadDocument`) for board documents, look up the session. If it is `live`, start `setInterval(checkpointIntervalMs)`. Each tick writes `docStore.checkpoint(orgId, sessionId, clock.now(), encodeStateAsUpdate(doc))` and catches and logs any failure.
  - **Stop:** clear the timer in `afterUnloadDocument` and in `close()`.
  - Use `timer.unref()` so timers never keep the process alive.
- **Order on end:** broadcast `session.state` (status ended) *before* closing candidate connections, so candidates get the final state first.

- [ ] **Step 1: Write the failing tests**

`libs/api/collab-server/src/lib/session-events.spec.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { docName, getBoardElements, parseServerMessage } from '@swint/shared-collab-protocol';
import { blobKeys } from '@swint/api-data-access-persistence';
import type { Identity } from '@swint/api-util-rpc';
import { connectClient, seedSession, startCollabTestKit, type CollabTestKit } from '../testing/collab-test-kit.js';

const ada: Identity = { kind: 'interviewer', sub: 'sub-1', name: 'Ada', email: null, orgId: 'default', roles: ['interviewer'] };
let kit: CollabTestKit;
afterEach(async () => kit?.close());

async function live(opts: { checkpointIntervalMs?: number } = {}) {
  kit = await startCollabTestKit({ debounceMs: 50, maxDebounceMs: 200, ...opts });
  const s = await seedSession(kit, { id: `s-${Math.random().toString(36).slice(2, 8)}`, status: 'live', startedAt: 1000 });
  kit.identities.set('ada', ada);
  kit.identities.set('grace', { ...ada, sub: 'sub-2', name: 'Grace' });
  kit.identities.set('bo', { kind: 'candidate', sessionId: s.id, orgId: 'default', inviteHash: 'h', name: 'Bo' });
  return s;
}

describe('sessionChanged', () => {
  it('broadcasts session.state to every board connection', async () => {
    const s = await live();
    const a = connectClient(kit, docName.board(s.id), 'ada');
    const b = connectClient(kit, docName.board(s.id), 'bo');
    await Promise.all([a.synced, b.synced]);
    const [na, nb] = [a.stateless.length, b.stateless.length];
    await kit.collab.events.sessionChanged({ ...s, extensionSec: 600, version: 2 });
    await expect.poll(() => a.stateless.length).toBe(na + 1);
    await expect.poll(() => b.stateless.length).toBe(nb + 1);
    expect(parseServerMessage(a.stateless.at(-1)!)).toMatchObject({ status: 'live', extensionSec: 600 });
    a.destroy();
    b.destroy();
  });

  it('on end: candidate gets the final state then is disconnected; interviewers become read-only; final checkpoint written', async () => {
    const s = await live();
    const a = connectClient(kit, docName.board(s.id), 'ada');
    const g = connectClient(kit, docName.board(s.id), 'grace');
    const b = connectClient(kit, docName.board(s.id), 'bo');
    await Promise.all([a.synced, g.synced, b.synced]);

    await kit.collab.events.sessionChanged({ ...s, status: 'ended', endedAt: 5000, endedBy: 'sub-1', version: 3 });

    await expect.poll(() => b.stateless.map((p) => parseServerMessage(p)?.status)).toContain('ended');
    await expect(b.closed).resolves.toBeDefined();

    getBoardElements(a.doc).set('late', { id: 'late', version: 1, versionNonce: 1, index: 'a0', isDeleted: false });
    await new Promise((r) => setTimeout(r, 300));
    expect(getBoardElements(g.doc).get('late')).toBeUndefined();

    await expect.poll(() => kit.checkpointsWritten(s.id)).toBeGreaterThanOrEqual(1);
    a.destroy();
    g.destroy();
    b.destroy();
  });

  it('writes periodic checkpoints while live', async () => {
    const s = await live({ checkpointIntervalMs: 100 });
    const a = connectClient(kit, docName.board(s.id), 'ada');
    await a.synced;
    await expect.poll(() => kit.checkpointsWritten(s.id), { timeout: 3000 }).toBeGreaterThanOrEqual(2);
    a.destroy();
  });

  it('never throws, even if broadcasting fails', async () => {
    const s = await live();
    await expect(
      kit.collab.events.sessionChanged({ ...s, status: 'live', startedAt: null as unknown as number }),
    ).resolves.toBeUndefined();
  });
});
```

**Note on `kit.checkpointsWritten(sessionId)`:** add this method to the test kit. It wraps `stores.blobs` with a recording proxy (`putBytes` calls whose key contains `/board/checkpoints/`) and counts calls per session id. Using a proxy avoids needing a list-objects API. Update the `CollabTestKit` interface accordingly.

The "never throws" test passes an impossible record, so `sessionStateMessage` throws inside and must be caught.

Run `pnpm nx test api-collab-server` and confirm it FAILS.

- [ ] **Step 2: Implement it as described in Interfaces**

- [ ] **Step 3: Verify and commit**

```bash
pnpm nx run-many -t test lint typecheck build -p api-collab-server
git add libs/api/collab-server
git commit -m "feat(api-collab-server): session.state broadcasts, end-of-session read-only/disconnect, checkpoints

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Wire into `apps/api`: attach, events, shutdown, request ids, end-to-end test

**Files:**
- Modify: `apps/api/src/app/create-app.ts`, `apps/api/src/app/server.ts`, `apps/api/src/main.ts`, `apps/api/package.json`, `README.md`
- Test: `apps/api/src/app/collab.integration.spec.ts`; extend `apps/api/src/app/api.integration.spec.ts` only if needed

**Interfaces:**
- Consumes: `createCollabServer`, `CollabServer` (Tasks 3–5)
- `createApp` changes:
  - It builds `collab = createCollabServer({ sessions: repos.sessions, blobs: repos.blobs, resolveIdentity: resolveIdentityFromCookieHeader, clock, logger: <child of the Fastify logger, see below> })`.
  - The router gets `events: composeEvents(collab.events, overrides.events)`. Here `composeEvents(...list)` calls each defined implementation in order, catching and logging each failure. It lives in `create-app.ts`.
  - Because the Fastify logger only exists after `buildServer`, create collab **after** `buildServer`. Pass the router a forwarding `SessionEvents` (`{ sessionChanged: (r) => current.sessionChanged(r) }`) whose target is set once collab exists. Alternatively, restructure so the logger is built first. Either way, the router's events must reach collab.
  - `collab.attach(server.server)` runs before `server.ready()` returns, so the upgrade handler exists before `listen`.
  - `App` gains `collab: CollabServer`.
  - Close order in `close()`: `await collab.close()` (flushes stores while S3 is still available), then `await server.close()`, then destroy the AWS clients.
- `server.ts`: the oRPC `onError` interceptor logs `{ err, requestId }`. Get the request id from the interceptor's `context.requestId`. If the interceptor options don't expose context, use the Fastify request's logger (`request.log`) inside the `/api/*` handler.
- `main.ts`:
  - The first SIGTERM/SIGINT starts the graceful shutdown with a **10 s** timeout. If it doesn't finish in time, log at error and `process.exit(1)`.
  - A **second** signal during shutdown logs a warning and `process.exit(1)` immediately.
  - Exit 0 on a clean close.

- [ ] **Step 1: Write the failing end-to-end test**

First extract the existing `setup()` and `interviewerCookie()` helpers from `apps/api/src/app/api.integration.spec.ts` into `apps/api/src/test/app-test-setup.ts`.
- This file is test-only. Exclude `src/test/**` in `tsconfig.app.json`, and confirm the esbuild build never includes it.
- Make `setup()` accept `{ listen?: boolean }`. When true it calls `await server.listen({ port: 0, host: '127.0.0.1' })` and returns `port`.
- Export `templateBody`.
- Update `api.integration.spec.ts` to import from the new file. It must behave exactly as before.

Then write `apps/api/src/app/collab.integration.spec.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { docName, getBoardElements, parseServerMessage } from '@swint/shared-collab-protocol';
import { blobKeys } from '@swint/api-data-access-persistence';
import { COOKIE } from '@swint/api-feature-auth';
import { setup, templateBody, type TestApp } from '../test/app-test-setup.js';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

/** Provider wired with a Cookie header; adapt option names to @hocuspocus/provider 4.8 (see Task 3 findings). */
function connect(port: number, name: string, cookie: string) {
  const doc = new Y.Doc();
  const stateless: string[] = [];
  let resolveSynced!: () => void;
  let resolveClosed!: (e: unknown) => void;
  const synced = new Promise<void>((r) => (resolveSynced = r));
  const closed = new Promise<unknown>((r) => (resolveClosed = r));
  class CookieWebSocket extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols, { headers: { cookie } });
    }
  }
  const provider = new HocuspocusProvider({
    url: `ws://127.0.0.1:${port}/collab`,
    name,
    document: doc,
    token: 'cookie',
    WebSocketPolyfill: CookieWebSocket,
    onSynced: () => resolveSynced(),
    onStateless: ({ payload }: { payload: string }) => stateless.push(payload),
    onClose: (e: unknown) => resolveClosed(e),
  } as never);
  return { doc, provider, stateless, synced, closed, destroy: () => provider.destroy() };
}

async function liveSession(app: TestApp) {
  const ic = await app.interviewerCookie();
  const tpl = (await app.server.inject({ method: 'POST', url: '/api/templates', cookies: ic, payload: templateBody })).json();
  const created = (
    await app.server.inject({ method: 'POST', url: '/api/sessions', cookies: ic, payload: { templateId: tpl.id, candidateName: 'Bo' } })
  ).json();
  const id: string = created.session.id;
  expect((await app.server.inject({ method: 'POST', url: `/api/sessions/${id}/start`, cookies: ic })).statusCode).toBe(200);
  const token = new URL(created.candidateUrl).pathname.split('/').pop() as string;
  return { id, ic, token };
}

describe('collab over the real API server', () => {
  it('interviewers get session.state on connect, the ended state after POST /end, then become read-only', async () => {
    t = await setup({ listen: true });
    const { id, ic } = await liveSession(t);
    const ic2 = await t.interviewerCookie('sub-2');
    const a = connect(t.port, docName.board(id), cookieHeader(ic));
    const b = connect(t.port, docName.board(id), cookieHeader(ic2));
    await Promise.all([a.synced, b.synced]);
    await expect.poll(() => a.stateless.length).toBeGreaterThan(0);
    expect(parseServerMessage(a.stateless[0])).toMatchObject({ type: 'session.state', status: 'live' });

    expect((await t.server.inject({ method: 'POST', url: `/api/sessions/${id}/end`, cookies: ic })).statusCode).toBe(200);
    await expect.poll(() => a.stateless.map((p) => parseServerMessage(p)?.status)).toContain('ended');
    await expect.poll(() => b.stateless.map((p) => parseServerMessage(p)?.status)).toContain('ended');

    getBoardElements(a.doc).set('late', { id: 'late', version: 1, versionNonce: 1, index: 'a0', isDeleted: false });
    await new Promise((r) => setTimeout(r, 300));
    expect(getBoardElements(b.doc).get('late')).toBeUndefined();
    a.destroy();
    b.destroy();
  });

  it('candidate cookie from /join connects to the live board and is disconnected when the session ends', async () => {
    t = await setup({ listen: true });
    const { id, ic, token } = await liveSession(t);
    const join = await t.server.inject({ method: 'GET', url: `/join/${token}` });
    const cand = join.cookies.find((c) => c.name === COOKIE.candidate);
    expect(cand).toBeDefined();
    const c = connect(t.port, docName.board(id), cookieHeader({ [COOKIE.candidate]: cand?.value ?? '' }));
    await c.synced;
    expect((await t.server.inject({ method: 'POST', url: `/api/sessions/${id}/end`, cookies: ic })).statusCode).toBe(200);
    await expect(c.closed).resolves.toBeDefined();
    c.destroy();
  });

  it('upgrade without cookies is rejected with 401 and the server keeps serving', async () => {
    t = await setup({ listen: true });
    const status = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${t?.port}/collab`);
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('open', () => reject(new Error('unexpectedly opened')));
      ws.on('error', () => undefined);
    });
    expect(status).toBe(401);
    expect((await t.server.inject({ method: 'GET', url: '/healthz' })).json()).toEqual({ ok: true });
  });

  it('app.close() flushes pending board changes to S3', async () => {
    t = await setup({ listen: true });
    const { id, ic } = await liveSession(t);
    const a = connect(t.port, docName.board(id), cookieHeader(ic));
    await a.synced;
    getBoardElements(a.doc).set('flushed', { id: 'flushed', version: 1, versionNonce: 1, index: 'a0', isDeleted: false });
    await new Promise((r) => setTimeout(r, 100)); // let the update reach the server, well below the 2 s debounce
    const blobs = t.repos.blobs;
    const app = t;
    t = undefined;
    a.destroy();
    await app.close();
    const bytes = await blobs.getBytes(blobKeys.sessionBoardLatest('default', id));
    expect(bytes).not.toBeNull();
    const d = new Y.Doc();
    Y.applyUpdate(d, bytes as Uint8Array);
    expect(getBoardElements(d).get('flushed')).toMatchObject({ version: 1 });
  });
});
```

Notes:
- `TestApp` is `{ server, repos, port, interviewerCookie(sub?, orgId?, roles?), close }` from the extracted setup. In the last test, `repos.blobs` must still be usable after `app.close()` destroys the app's S3 client. If it isn't, create a fresh BlobStore with `createBlobStore(createS3(cfg), bucket)` from the setup's config.
- If a provider option name differs in 4.8 (`WebSocketPolyfill`, `onSynced`, `onStateless`, `onClose`), use the names from Task 3's findings. Keep the assertions.

Run `pnpm nx test api` and confirm the new tests FAIL.

- [ ] **Step 2: Implement the `create-app.ts` and `server.ts` changes**

Add `@swint/api-collab-server` (`workspace:*`), `ws`, `@hocuspocus/provider` (test only, which goes in `devDependencies`) and `yjs` to `apps/api/package.json` as needed. Run `pnpm install && pnpm nx sync`.

- [ ] **Step 3: Write the shutdown changes in `main.ts`**

```ts
import { createApp } from './app/create-app.js';
import { loadConfig } from './app/config.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main() {
  const config = loadConfig(process.env);
  const app = await createApp(config);
  await app.server.listen({ port: config.port, host: config.host });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      app.server.log.warn({ signal }, 'second signal received, forcing exit');
      process.exit(1);
    }
    shuttingDown = true;
    app.server.log.info({ signal }, 'shutting down');
    const timer = setTimeout(() => {
      app.server.log.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'shutdown timed out, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    timer.unref();
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

- [ ] **Step 4: Run the full verification**

```bash
pnpm nx run-many -t lint test typecheck build
```

Everything must pass with 0 warnings.

- [ ] **Step 5: Smoke test against Docker Compose**

```bash
docker compose up -d
until curl -sf http://localhost:8080/realms/swint/.well-known/openid-configuration >/dev/null; do sleep 2; done
pnpm nx serve api &   # or second terminal
until curl -sf http://localhost:3000/healthz >/dev/null; do sleep 1; done
node -e "const W=require('ws');const w=new W('ws://localhost:3000/collab');w.on('unexpected-response',(q,r)=>{console.log('upgrade status',r.statusCode);process.exit(0)});w.on('open',()=>{console.log('UNEXPECTED open');process.exit(1)})"
```

Expected: `upgrade status 401`. Then stop the API with SIGTERM. Check that it logs `shutting down` and exits 0 within 10 s. Then run `docker compose down` (keep the volumes).

- [ ] **Step 6: README**

Under "Useful endpoints", add:

```markdown
- `ws://localhost:3000/collab` — real-time collaboration (Hocuspocus/Yjs). Requires the session cookie (interviewer) or candidate cookie; documents `session:<id>:board` and `session:<id>:notes`.
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src apps/api/package.json README.md package.json pnpm-lock.yaml
git commit -m "feat(api): attach real-time collaboration server; graceful shutdown timeout; request ids in rpc error logs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Stage only the files you changed, by explicit path, including any `tsconfig` updates from `nx sync`.)

---

## Done criteria for Plan 3

- `pnpm nx run-many -t lint test typecheck build` passes for all projects, with 0 lint warnings.
- The real-time integration tests prove each of these:

| Behaviour | Expected |
|---|---|
| Upgrade with no cookie | 401 |
| Candidate opens notes | `forbidden` |
| Candidate opens the board before start | `not_started` |
| Candidate opens the board after end | `session_ended` |
| Candidate of another session, or interviewer of another org | `forbidden` |
| Two clients on the same board | each sees the other's edits |
| New board connection | gets `session.state` immediately, including `serverNow` |
| Client stateless messages | ignored |
| Board seeded at session creation | loads |
| Session without `latest.bin` | opens as an empty board |
| Board and notes edits | persisted to S3 |
| Persistence | survives restart, and `close()` flushes pending changes |
| Session update | `session.state` broadcast to every board connection |
| Session end | candidate gets the final state and is then disconnected; interviewers become read-only; final checkpoint written |
| Live session | periodic checkpoints written |
| `sessionChanged` | never throws |

- `apps/api` serves `/collab` on the same port as the REST API. Its `close()` flushes collab before shutting down HTTP. `main.ts` enforces the 10 s shutdown timeout, and a second signal forces exit.
- Hand-off to Plan 4:
  - The web client connects to `/collab` (proxied with `ws: true`), using `token: 'cookie'`.
  - It listens for `session.state` via `onStateless` and `parseServerMessage`.
  - It handles `onAuthenticationFailed({ reason })` for `not_started`, `session_ended` and `forbidden`.
  - It treats a close with code `4403` / reason `session_ended` as "the interview has ended".
