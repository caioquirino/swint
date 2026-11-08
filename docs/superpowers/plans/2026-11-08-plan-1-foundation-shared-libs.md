# Plan 1 — Workspace Foundation, Shared Libraries and Board Sync Core

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up the Nx workspace tooling and build the three shared libraries plus the Excalidraw↔Yjs sync core, all unit-tested with no infrastructure.

**Architecture:**
- A TypeScript Nx monorepo with lint-enforced scope/type rules between libraries.
- Pure domain logic (lifecycle state machine, timer, document access policy) lives in `libs/shared/domain`.
- Real-time protocol definitions live in `libs/shared/collab-protocol`.
- The oRPC REST contract lives in `libs/shared/api-contract`.
- The framework-agnostic board sync engine (`BoardSync`) lives in `libs/web/ui-whiteboard`. Plan 4 wraps it in a React/Excalidraw adapter.

**Tech Stack:** Nx 24, pnpm, Node 24, TypeScript, Vitest, ESLint (`@nx/enforce-module-boundaries`), zod 4, `@orpc/contract` 1.16, yjs 13.6.

**Spec:** `docs/superpowers/specs/2026-11-08-swint-foundation-design.md`

### Plan series (each plan is written after the previous one lands)

| # | Plan | Delivers |
|---|---|---|
| **1** | **Foundation + shared libraries + board sync core** (this plan) | Workspace tooling, `shared/domain`, `shared/collab-protocol`, `shared/api-contract`, `BoardSync` with convergence tests |
| 2 | Backend API | docker compose (keycloak, dynamodb-local, minio), `apps/api`, `api/data-access-persistence`, `api/feature-auth`, `api/feature-templates`, `api/feature-sessions`, integration tests |
| 3 | Real-time server | `api/collab-server` (Hocuspocus auth/permissions/persistence/checkpoints/broadcasts), real-time integration tests |
| 4 | Web app | `apps/web`, data-access libs, Excalidraw React adapter, panels, dashboard, template editor, session room, revisit + export |
| 5 | End-to-end + full containers | Playwright e2e, Dockerfiles, compose `app` profile, dev seed |

## Global Constraints

- Package manager: **pnpm**. Always run tasks through Nx: `pnpm nx <target> <project>`. Never guess CLI flags; check `--help` first.
- Node 24, pnpm 12 (from `mise.toml`).
- Nx plugins must match the installed `nx` version. Install them with `pnpm nx add <plugin>`, which picks the matching version.
- Library folders and tags follow spec §3.1 exactly:
  - scope tags: `scope:shared|web|api`
  - type tags: `type:contract|util|ui|data-access|feature`
- `scope:shared` libraries must not depend on DOM or Node-only APIs.
- Import names: `@swint/<scope>-<name>` (e.g. `@swint/shared-domain`).
- Times are **epoch milliseconds (`number`)** everywhere: domain, contract and protocol.
- Session statuses: `created | live | ended | cancelled`. Roles: `candidate | interviewer`. Extension minutes: `5 | 10`. Timer warnings at **10 min** and **2 min**; overtime below zero; **no auto-lock**.
- Document names: `session:{id}:board`, `session:{id}:notes`. Board map key `elements`; notes fragment key `content`.
- WebSocket close reasons: `unauthenticated | forbidden | invite_revoked | session_ended | not_started`.
- Element conflict rule (same as Excalidraw's): the higher `version` wins; on equal `version`, the **lower** `versionNonce` wins.
- Commit after every task. Commit message trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## File structure (created by this plan)

```
.gitignore                                   (modify)  ignore node_modules, dist, coverage, .nx cache
pnpm-workspace.yaml                          (modify)  workspace package globs
eslint.config.mjs                            (create by generator, then modify) module boundary rules
libs/shared/domain/src/
  index.ts                                   public exports
  lib/roles.ts                               ParticipantRole, SessionStatus
  lib/lifecycle.ts                           applyCommand state machine + InvalidTransitionError
  lib/lifecycle.spec.ts
  lib/timer.ts                               remainingMs, timerPhase, serverOffsetMs
  lib/timer.spec.ts
  lib/doc-access.ts                          docAccess(role, docKind, status) policy (spec §7.1)
  lib/doc-access.spec.ts
libs/shared/collab-protocol/src/
  index.ts
  lib/doc-names.ts                           docName.board/notes, parseDocName
  lib/doc-names.spec.ts
  lib/documents.ts                           SyncedElement type, getBoardElements, getNotesFragment
  lib/documents.spec.ts
  lib/stateless.ts                           session.state schema, encode/parse
  lib/stateless.spec.ts
  lib/awareness.ts                           awareness user schema
  lib/close-reasons.ts                       CloseReason enum
libs/shared/api-contract/src/
  index.ts
  lib/schemas.ts                             zod schemas (template, session, room view, me)
  lib/schemas.spec.ts
  lib/contract.ts                            oRPC contract router
  lib/contract.spec.ts
libs/web/ui-whiteboard/src/
  index.ts
  lib/binding/element-order.ts               shouldReplace, sortByIndex
  lib/binding/element-order.spec.ts
  lib/binding/board-sync.ts                  BoardSync class
  lib/binding/board-sync.spec.ts
  lib/binding/test-peers.ts                  test helper: linked Y.Docs with controllable delivery
```

---

### Task 1: Workspace tooling and module boundaries

**Files:**
- Modify: `.gitignore`, `pnpm-workspace.yaml`, `nx.json` (by `nx add`), `package.json` (by `nx add`)
- Create (generators): `tsconfig.base.json` / `tsconfig.json`, `eslint.config.mjs`, four library projects

**Interfaces:**
- Produces: projects `shared-domain`, `shared-collab-protocol`, `shared-api-contract`, `web-ui-whiteboard`, each with `test`, `lint` and `typecheck` targets, imported as `@swint/shared-domain`, `@swint/shared-collab-protocol`, `@swint/shared-api-contract`, `@swint/web-ui-whiteboard`.

- [ ] **Step 1: Create a working branch and commit the existing scaffolding**

```bash
git checkout -b feat/foundation design/foundation
```

Replace `.gitignore` with:

```gitignore
node_modules
dist
coverage
tmp
out-tsc
.nx/cache
.nx/workspace-data
.nx/polygraph
.claude/worktrees
.claude/settings.local.json
*.tsbuildinfo
.env
.env.local
```

```bash
git add .gitignore CLAUDE.md mise.toml nx.json package.json pnpm-lock.yaml pnpm-workspace.yaml .claude/settings.json
git commit -m "chore: initial nx workspace scaffolding

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: Declare workspace package globs**

`pnpm-workspace.yaml`:

```yaml
packages:
  - 'apps/*'
  - 'libs/*/*'
allowBuilds:
  nx: true
```

- [ ] **Step 3: Add Nx plugins**

```bash
pnpm nx add @nx/js
pnpm nx add @nx/vitest
pnpm nx add @nx/eslint
pnpm nx add @nx/react
```

Expected: each command installs the plugin at the installed `nx` version and registers it in `nx.json` `plugins`. Afterwards, `pnpm nx --version` shows the same version for every `@nx/*` package.

- [ ] **Step 4: Check generator flags before generating**

```bash
pnpm nx g @nx/js:library --help
pnpm nx g @nx/react:library --help
```

Confirm the flags used below exist: `--directory`, `--name`, `--importPath`, `--bundler`, `--unitTestRunner`, `--linter`, `--tags`. If a flag was renamed, use the new name with the same meaning.

- [ ] **Step 5: Generate the four libraries**

```bash
pnpm nx g @nx/js:library --directory=libs/shared/domain --name=shared-domain --importPath=@swint/shared-domain --bundler=tsc --unitTestRunner=vitest --linter=eslint --tags=scope:shared,type:util --no-interactive
pnpm nx g @nx/js:library --directory=libs/shared/collab-protocol --name=shared-collab-protocol --importPath=@swint/shared-collab-protocol --bundler=tsc --unitTestRunner=vitest --linter=eslint --tags=scope:shared,type:contract --no-interactive
pnpm nx g @nx/js:library --directory=libs/shared/api-contract --name=shared-api-contract --importPath=@swint/shared-api-contract --bundler=tsc --unitTestRunner=vitest --linter=eslint --tags=scope:shared,type:contract --no-interactive
pnpm nx g @nx/react:library --directory=libs/web/ui-whiteboard --name=web-ui-whiteboard --importPath=@swint/web-ui-whiteboard --bundler=none --unitTestRunner=vitest --linter=eslint --tags=scope:web,type:ui --no-interactive
```

Delete the placeholder sources and specs the generators created (e.g. `libs/shared/domain/src/lib/shared-domain.ts` and its `.spec.ts`), and empty each `src/index.ts`.

- [ ] **Step 6: Verify project names and targets**

```bash
pnpm nx show projects
pnpm nx show project shared-domain --json | jq '.targets | keys'
```

Expected: the four projects are listed. Each has `test` and `lint` targets (and `typecheck` when the workspace uses TS project references). **If Nx reports different project names** (e.g. `@swint/shared-domain`), use those names in every `pnpm nx` command for the rest of this plan.

- [ ] **Step 7: Add the module boundary rules**

In `eslint.config.mjs`, replace the `depConstraints` array of the `@nx/enforce-module-boundaries` rule with:

```js
depConstraints: [
  { sourceTag: 'scope:shared', onlyDependOnLibsWithTags: ['scope:shared'] },
  { sourceTag: 'scope:web', onlyDependOnLibsWithTags: ['scope:web', 'scope:shared'] },
  { sourceTag: 'scope:api', onlyDependOnLibsWithTags: ['scope:api', 'scope:shared'] },
  { sourceTag: 'type:contract', onlyDependOnLibsWithTags: ['type:contract', 'type:util'] },
  { sourceTag: 'type:util', onlyDependOnLibsWithTags: ['type:contract', 'type:util'] },
  { sourceTag: 'type:ui', onlyDependOnLibsWithTags: ['type:ui', 'type:contract', 'type:util'] },
  { sourceTag: 'type:data-access', onlyDependOnLibsWithTags: ['type:data-access', 'type:contract', 'type:util'] },
  { sourceTag: 'type:feature', onlyDependOnLibsWithTags: ['type:feature', 'type:ui', 'type:data-access', 'type:contract', 'type:util'] },
],
```

Note: `type:util` → `type:contract` is allowed by these rules, but `shared-domain` must not actually import any contract library. The contracts import the domain, never the reverse.

- [ ] **Step 8: Add the runtime dependencies**

```bash
pnpm add -w zod@^4 yjs@^13.6 @orpc/contract@^1.16
```

- [ ] **Step 9: Verify the workspace is green**

```bash
pnpm nx run-many -t lint test --projects=shared-domain,shared-collab-protocol,shared-api-contract,web-ui-whiteboard --passWithNoTests
```

Expected: all succeed. If the `test` target rejects `--passWithNoTests`, add `passWithNoTests: true` to each library's `vite.config.ts` / `vitest.config.ts` `test` block instead.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: add nx plugins, shared/web libraries and module boundary rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `shared-domain`, session lifecycle state machine

**Files:**
- Create: `libs/shared/domain/src/lib/roles.ts`, `libs/shared/domain/src/lib/lifecycle.ts`
- Test: `libs/shared/domain/src/lib/lifecycle.spec.ts`
- Modify: `libs/shared/domain/src/index.ts`

**Interfaces:**
- Produces:
  - `type ParticipantRole = 'candidate' | 'interviewer'`
  - `type SessionStatus = 'created' | 'live' | 'ended' | 'cancelled'`
  - `const SESSION_STATUSES: readonly SessionStatus[]`
  - `const EXTENSION_MINUTES = [5, 10] as const`; `type ExtensionMinutes = 5 | 10`
  - `interface SessionLifecycleState { status; startedAt: number | null; durationSec: number; extensionSec: number; endedAt: number | null; endedBy: string | null; cancelReason: string | null }`
  - `type SessionCommand = { type: 'start' } | { type: 'extend'; minutes: ExtensionMinutes } | { type: 'end' } | { type: 'cancel'; reason?: string }`
  - `function applyCommand(state: SessionLifecycleState, command: SessionCommand, ctx: { now: number; actorId: string }): SessionLifecycleState`, a pure function that returns a new object
  - `class InvalidTransitionError extends Error { readonly from: SessionStatus; readonly command: SessionCommand['type'] }`
  - `function isFinished(status: SessionStatus): boolean`
  - `function initialLifecycle(durationSec: number): SessionLifecycleState`

- [ ] **Step 1: Write the failing tests**

`libs/shared/domain/src/lib/lifecycle.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  initialLifecycle,
  InvalidTransitionError,
  isFinished,
  type SessionLifecycleState,
} from './lifecycle';

const ctx = { now: 1_000_000, actorId: 'interviewer-1' };
const created = (): SessionLifecycleState => initialLifecycle(45 * 60);
const live = (): SessionLifecycleState => applyCommand(created(), { type: 'start' }, ctx);

describe('initialLifecycle', () => {
  it('starts in created with no timestamps', () => {
    expect(created()).toEqual({
      status: 'created',
      startedAt: null,
      durationSec: 2700,
      extensionSec: 0,
      endedAt: null,
      endedBy: null,
      cancelReason: null,
    });
  });
});

describe('applyCommand', () => {
  it('start: created -> live and records startedAt', () => {
    expect(live()).toMatchObject({ status: 'live', startedAt: 1_000_000 });
  });

  it('extend: adds minutes to extensionSec while live', () => {
    const once = applyCommand(live(), { type: 'extend', minutes: 5 }, ctx);
    const twice = applyCommand(once, { type: 'extend', minutes: 10 }, ctx);
    expect(twice.extensionSec).toBe(900);
  });

  it('end: live -> ended with endedAt and endedBy', () => {
    const ended = applyCommand(live(), { type: 'end' }, { now: 2_000_000, actorId: 'interviewer-2' });
    expect(ended).toMatchObject({ status: 'ended', endedAt: 2_000_000, endedBy: 'interviewer-2' });
  });

  it('cancel: allowed from created and live, keeps the reason', () => {
    const fromCreated = applyCommand(created(), { type: 'cancel', reason: 'no-show' }, ctx);
    const fromLive = applyCommand(live(), { type: 'cancel' }, ctx);
    expect(fromCreated).toMatchObject({ status: 'cancelled', cancelReason: 'no-show', endedBy: 'interviewer-1' });
    expect(fromLive).toMatchObject({ status: 'cancelled', cancelReason: null });
  });

  it('does not mutate the input state', () => {
    const before = created();
    const snapshot = structuredClone(before);
    applyCommand(before, { type: 'start' }, ctx);
    expect(before).toEqual(snapshot);
  });

  it.each([
    ['created', { type: 'extend', minutes: 5 }],
    ['created', { type: 'end' }],
    ['live', { type: 'start' }],
  ] as const)('rejects %s + %o', (status, command) => {
    const state = status === 'created' ? created() : live();
    expect(() => applyCommand(state, command, ctx)).toThrow(InvalidTransitionError);
  });

  it.each(['ended', 'cancelled'] as const)('rejects every command once %s', (finalStatus) => {
    const final = applyCommand(live(), finalStatus === 'ended' ? { type: 'end' } : { type: 'cancel' }, ctx);
    for (const command of [
      { type: 'start' },
      { type: 'extend', minutes: 5 },
      { type: 'end' },
      { type: 'cancel' },
    ] as const) {
      expect(() => applyCommand(final, command, ctx)).toThrow(InvalidTransitionError);
    }
  });

  it('InvalidTransitionError carries from and command', () => {
    try {
      applyCommand(created(), { type: 'end' }, ctx);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidTransitionError);
      expect((e as InvalidTransitionError).from).toBe('created');
      expect((e as InvalidTransitionError).command).toBe('end');
    }
  });
});

describe('isFinished', () => {
  it('is true only for ended and cancelled', () => {
    expect(isFinished('created')).toBe(false);
    expect(isFinished('live')).toBe(false);
    expect(isFinished('ended')).toBe(true);
    expect(isFinished('cancelled')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm nx test shared-domain`
Expected: FAIL, because `./lifecycle` cannot be resolved.

- [ ] **Step 3: Implement**

`libs/shared/domain/src/lib/roles.ts`:

```ts
export type ParticipantRole = 'candidate' | 'interviewer';
export const PARTICIPANT_ROLES: readonly ParticipantRole[] = ['candidate', 'interviewer'];

export type SessionStatus = 'created' | 'live' | 'ended' | 'cancelled';
export const SESSION_STATUSES: readonly SessionStatus[] = ['created', 'live', 'ended', 'cancelled'];

export const EXTENSION_MINUTES = [5, 10] as const;
export type ExtensionMinutes = (typeof EXTENSION_MINUTES)[number];
```

`libs/shared/domain/src/lib/lifecycle.ts`:

```ts
import type { ExtensionMinutes, SessionStatus } from './roles';

export interface SessionLifecycleState {
  status: SessionStatus;
  startedAt: number | null;
  durationSec: number;
  extensionSec: number;
  endedAt: number | null;
  endedBy: string | null;
  cancelReason: string | null;
}

export type SessionCommand =
  | { type: 'start' }
  | { type: 'extend'; minutes: ExtensionMinutes }
  | { type: 'end' }
  | { type: 'cancel'; reason?: string };

export interface CommandContext {
  now: number;
  actorId: string;
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: SessionStatus,
    readonly command: SessionCommand['type'],
  ) {
    super(`Cannot apply "${command}" to a session that is "${from}"`);
    this.name = 'InvalidTransitionError';
  }
}

export function isFinished(status: SessionStatus): boolean {
  return status === 'ended' || status === 'cancelled';
}

export function initialLifecycle(durationSec: number): SessionLifecycleState {
  return {
    status: 'created',
    startedAt: null,
    durationSec,
    extensionSec: 0,
    endedAt: null,
    endedBy: null,
    cancelReason: null,
  };
}

export function applyCommand(
  state: SessionLifecycleState,
  command: SessionCommand,
  ctx: CommandContext,
): SessionLifecycleState {
  const reject = (): never => {
    throw new InvalidTransitionError(state.status, command.type);
  };

  switch (command.type) {
    case 'start':
      if (state.status !== 'created') return reject();
      return { ...state, status: 'live', startedAt: ctx.now };
    case 'extend':
      if (state.status !== 'live') return reject();
      return { ...state, extensionSec: state.extensionSec + command.minutes * 60 };
    case 'end':
      if (state.status !== 'live') return reject();
      return { ...state, status: 'ended', endedAt: ctx.now, endedBy: ctx.actorId };
    case 'cancel':
      if (isFinished(state.status)) return reject();
      return {
        ...state,
        status: 'cancelled',
        endedAt: ctx.now,
        endedBy: ctx.actorId,
        cancelReason: command.reason ?? null,
      };
  }
}
```

`libs/shared/domain/src/index.ts`:

```ts
export * from './lib/roles';
export * from './lib/lifecycle';
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `pnpm nx test shared-domain`
Expected: PASS (all lifecycle tests).

- [ ] **Step 5: Commit**

```bash
git add libs/shared/domain
git commit -m "feat(shared-domain): session lifecycle state machine

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `shared-domain`, timer math and document access policy

**Files:**
- Create: `libs/shared/domain/src/lib/timer.ts`, `libs/shared/domain/src/lib/doc-access.ts`
- Test: `libs/shared/domain/src/lib/timer.spec.ts`, `libs/shared/domain/src/lib/doc-access.spec.ts`
- Modify: `libs/shared/domain/src/index.ts`

**Interfaces:**
- Consumes: `ParticipantRole`, `SessionStatus`, `SessionLifecycleState` (Task 2)
- Produces:
  - `type TimerFields = Pick<SessionLifecycleState, 'startedAt' | 'durationSec' | 'extensionSec'>`
  - `function remainingMs(timer: TimerFields, nowMs: number): number | null` (`null` before start; negative = overtime)
  - `type TimerPhase = 'not-started' | 'normal' | 'warning' | 'critical' | 'overtime'`
  - `const WARNING_MS = 600_000`, `const CRITICAL_MS = 120_000`
  - `function timerPhase(remaining: number | null): TimerPhase`
  - `function serverOffsetMs(serverNow: number, clientNow: number): number`
  - `type DocKind = 'board' | 'notes'`; `type DocAccess = 'none' | 'read' | 'write'`
  - `function docAccess(role: ParticipantRole, kind: DocKind, status: SessionStatus): DocAccess`

- [ ] **Step 1: Write the failing tests**

`libs/shared/domain/src/lib/timer.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CRITICAL_MS, remainingMs, serverOffsetMs, timerPhase, WARNING_MS } from './timer';

const timer = { startedAt: 0, durationSec: 3600, extensionSec: 600 };

describe('remainingMs', () => {
  it('is null before start', () => {
    expect(remainingMs({ ...timer, startedAt: null }, 123)).toBeNull();
  });
  it('includes extensions', () => {
    expect(remainingMs(timer, 0)).toBe(4_200_000);
    expect(remainingMs(timer, 4_200_000)).toBe(0);
  });
  it('goes negative in overtime', () => {
    expect(remainingMs(timer, 4_260_000)).toBe(-60_000);
  });
});

describe('timerPhase', () => {
  it.each([
    [null, 'not-started'],
    [WARNING_MS + 1, 'normal'],
    [WARNING_MS, 'warning'],
    [CRITICAL_MS + 1, 'warning'],
    [CRITICAL_MS, 'critical'],
    [0, 'critical'],
    [-1, 'overtime'],
  ] as const)('%s ms -> %s', (remaining, phase) => {
    expect(timerPhase(remaining)).toBe(phase);
  });
  it('uses the 10 and 2 minute thresholds', () => {
    expect(WARNING_MS).toBe(600_000);
    expect(CRITICAL_MS).toBe(120_000);
  });
});

describe('serverOffsetMs', () => {
  it('is server minus client', () => {
    expect(serverOffsetMs(10_500, 10_000)).toBe(500);
    expect(serverOffsetMs(9_000, 10_000)).toBe(-1_000);
  });
});
```

`libs/shared/domain/src/lib/doc-access.spec.ts` (each case is one row of spec §7.1):

```ts
import { describe, expect, it } from 'vitest';
import { docAccess } from './doc-access';

describe('docAccess (spec §7.1)', () => {
  it.each([
    // role, kind, status, expected
    ['candidate', 'board', 'created', 'none'],
    ['candidate', 'board', 'live', 'write'],
    ['candidate', 'board', 'ended', 'none'],
    ['candidate', 'board', 'cancelled', 'none'],
    ['candidate', 'notes', 'created', 'none'],
    ['candidate', 'notes', 'live', 'none'],
    ['candidate', 'notes', 'ended', 'none'],
    ['interviewer', 'board', 'created', 'write'],
    ['interviewer', 'board', 'live', 'write'],
    ['interviewer', 'board', 'ended', 'read'],
    ['interviewer', 'board', 'cancelled', 'read'],
    ['interviewer', 'notes', 'created', 'write'],
    ['interviewer', 'notes', 'live', 'write'],
    ['interviewer', 'notes', 'ended', 'read'],
    ['interviewer', 'notes', 'cancelled', 'read'],
  ] as const)('%s / %s / %s -> %s', (role, kind, status, expected) => {
    expect(docAccess(role, kind, status)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm nx test shared-domain`
Expected: FAIL, because `./timer` and `./doc-access` cannot be resolved.

- [ ] **Step 3: Implement**

`libs/shared/domain/src/lib/timer.ts`:

```ts
import type { SessionLifecycleState } from './lifecycle';

export type TimerFields = Pick<SessionLifecycleState, 'startedAt' | 'durationSec' | 'extensionSec'>;
export type TimerPhase = 'not-started' | 'normal' | 'warning' | 'critical' | 'overtime';

export const WARNING_MS = 10 * 60 * 1000;
export const CRITICAL_MS = 2 * 60 * 1000;

export function remainingMs(timer: TimerFields, nowMs: number): number | null {
  if (timer.startedAt === null) return null;
  return timer.startedAt + (timer.durationSec + timer.extensionSec) * 1000 - nowMs;
}

export function timerPhase(remaining: number | null): TimerPhase {
  if (remaining === null) return 'not-started';
  if (remaining < 0) return 'overtime';
  if (remaining <= CRITICAL_MS) return 'critical';
  if (remaining <= WARNING_MS) return 'warning';
  return 'normal';
}

export function serverOffsetMs(serverNow: number, clientNow: number): number {
  return serverNow - clientNow;
}
```

`libs/shared/domain/src/lib/doc-access.ts`:

```ts
import { isFinished } from './lifecycle';
import type { ParticipantRole, SessionStatus } from './roles';

export type DocKind = 'board' | 'notes';
export type DocAccess = 'none' | 'read' | 'write';

export function docAccess(role: ParticipantRole, kind: DocKind, status: SessionStatus): DocAccess {
  if (role === 'interviewer') {
    return isFinished(status) ? 'read' : 'write';
  }
  // candidate
  if (kind === 'notes') return 'none';
  return status === 'live' ? 'write' : 'none';
}
```

`libs/shared/domain/src/index.ts`:

```ts
export * from './lib/roles';
export * from './lib/lifecycle';
export * from './lib/timer';
export * from './lib/doc-access';
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `pnpm nx test shared-domain && pnpm nx lint shared-domain`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/shared/domain
git commit -m "feat(shared-domain): timer math and document access policy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `shared-collab-protocol`

**Files:**
- Create: `libs/shared/collab-protocol/src/lib/doc-names.ts`, `documents.ts`, `stateless.ts`, `awareness.ts`, `close-reasons.ts`
- Test: `libs/shared/collab-protocol/src/lib/doc-names.spec.ts`, `documents.spec.ts`, `stateless.spec.ts`
- Modify: `libs/shared/collab-protocol/src/index.ts`, `libs/shared/collab-protocol/package.json` (dependencies)

**Interfaces:**
- Consumes: `SessionStatus`, `ParticipantRole`, `DocKind`, `SESSION_STATUSES`, `PARTICIPANT_ROLES` from `@swint/shared-domain`
- Produces:
  - `docName.board(sessionId: string): string`, `docName.notes(sessionId: string): string`
  - `function parseDocName(name: string): { sessionId: string; kind: DocKind } | null`
  - `interface SyncedElement { id: string; version: number; versionNonce: number; index: string | null; isDeleted: boolean; [key: string]: unknown }`
  - `const BOARD_ELEMENTS_KEY = 'elements'`, `const NOTES_FRAGMENT_KEY = 'content'`
  - `function getBoardElements(doc: Y.Doc): Y.Map<SyncedElement>`, `function getNotesFragment(doc: Y.Doc): Y.XmlFragment`
  - `sessionStateMessageSchema` (zod); `type SessionStateMessage = { type: 'session.state'; status; startedAt: number | null; durationSec; extensionSec; serverNow: number }`
  - `type ServerMessage = SessionStateMessage`; `function encodeServerMessage(msg: ServerMessage): string`; `function parseServerMessage(payload: string): ServerMessage | null`
  - `awarenessUserSchema` (zod); `type AwarenessUser = { userId; name; role: ParticipantRole; color; pointer?: { x: number; y: number; tool: 'pointer' | 'laser' }; selectedElementIds: Record<string, true> }`; `const AWARENESS_USER_FIELD = 'user'`
  - `const CLOSE_REASONS = ['unauthenticated','forbidden','invite_revoked','session_ended','not_started'] as const`; `type CloseReason`; `function isCloseReason(value: unknown): value is CloseReason`

- [ ] **Step 1: Declare the library's dependencies**

Add `"@swint/shared-domain": "workspace:*"`, `"yjs": "^13.6.0"` and `"zod": "^4.0.0"` to `dependencies` in `libs/shared/collab-protocol/package.json`. Then run `pnpm install`.

- [ ] **Step 2: Write the failing tests**

`libs/shared/collab-protocol/src/lib/doc-names.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { docName, parseDocName } from './doc-names';

describe('doc names', () => {
  it('builds names', () => {
    expect(docName.board('01J0ABC')).toBe('session:01J0ABC:board');
    expect(docName.notes('01J0ABC')).toBe('session:01J0ABC:notes');
  });
  it('round-trips', () => {
    expect(parseDocName(docName.notes('s1'))).toEqual({ sessionId: 's1', kind: 'notes' });
  });
  it.each(['', 'session::board', 'session:s1:code', 'room:s1:board', 'session:s1:board:x', 'session:a:b:board'])(
    'rejects %j',
    (name) => {
      expect(parseDocName(name)).toBeNull();
    },
  );
});
```

`libs/shared/collab-protocol/src/lib/documents.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { BOARD_ELEMENTS_KEY, getBoardElements, getNotesFragment, NOTES_FRAGMENT_KEY } from './documents';

describe('typed document accessors', () => {
  it('returns the same shared types as raw access', () => {
    const doc = new Y.Doc();
    expect(getBoardElements(doc)).toBe(doc.getMap(BOARD_ELEMENTS_KEY));
    expect(getNotesFragment(doc)).toBe(doc.getXmlFragment(NOTES_FRAGMENT_KEY));
  });
  it('uses the agreed keys', () => {
    expect(BOARD_ELEMENTS_KEY).toBe('elements');
    expect(NOTES_FRAGMENT_KEY).toBe('content');
  });
});
```

`libs/shared/collab-protocol/src/lib/stateless.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { encodeServerMessage, parseServerMessage, type SessionStateMessage } from './stateless';
import { isCloseReason } from './close-reasons';
import { awarenessUserSchema } from './awareness';

const msg: SessionStateMessage = {
  type: 'session.state',
  status: 'live',
  startedAt: 1000,
  durationSec: 2700,
  extensionSec: 300,
  serverNow: 5000,
};

describe('server messages', () => {
  it('round-trips a session.state message', () => {
    expect(parseServerMessage(encodeServerMessage(msg))).toEqual(msg);
  });
  it('returns null for malformed JSON', () => {
    expect(parseServerMessage('{nope')).toBeNull();
  });
  it('returns null for unknown types or bad fields', () => {
    expect(parseServerMessage(JSON.stringify({ ...msg, type: 'session.hack' }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ ...msg, status: 'paused' }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ ...msg, durationSec: -1 }))).toBeNull();
  });
  it('refuses to encode an invalid message', () => {
    expect(() => encodeServerMessage({ ...msg, extensionSec: -5 })).toThrow();
  });
});

describe('close reasons', () => {
  it('recognises known reasons only', () => {
    expect(isCloseReason('session_ended')).toBe(true);
    expect(isCloseReason('whatever')).toBe(false);
    expect(isCloseReason(42)).toBe(false);
  });
});

describe('awareness user', () => {
  it('accepts a valid user and rejects an unknown role', () => {
    const user = { userId: 'u1', name: 'Ada', role: 'candidate', color: '#ff0000', selectedElementIds: { e1: true } };
    expect(awarenessUserSchema.parse(user)).toEqual(user);
    expect(awarenessUserSchema.safeParse({ ...user, role: 'admin' }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `pnpm nx test shared-collab-protocol`
Expected: FAIL, because the modules cannot be resolved.

- [ ] **Step 4: Implement**

`libs/shared/collab-protocol/src/lib/doc-names.ts`:

```ts
import type { DocKind } from '@swint/shared-domain';

const DOC_NAME_PATTERN = /^session:([^:]+):(board|notes)$/;

export const docName = {
  board: (sessionId: string) => `session:${sessionId}:board`,
  notes: (sessionId: string) => `session:${sessionId}:notes`,
} as const;

export function parseDocName(name: string): { sessionId: string; kind: DocKind } | null {
  const match = DOC_NAME_PATTERN.exec(name);
  if (!match) return null;
  return { sessionId: match[1], kind: match[2] as DocKind };
}
```

`libs/shared/collab-protocol/src/lib/documents.ts`:

```ts
import type * as Y from 'yjs';

/** Minimal shape of an Excalidraw element that the sync layer relies on. */
export interface SyncedElement {
  id: string;
  version: number;
  versionNonce: number;
  index: string | null;
  isDeleted: boolean;
  [key: string]: unknown;
}

export const BOARD_ELEMENTS_KEY = 'elements';
export const NOTES_FRAGMENT_KEY = 'content';

export function getBoardElements(doc: Y.Doc): Y.Map<SyncedElement> {
  return doc.getMap<SyncedElement>(BOARD_ELEMENTS_KEY);
}

export function getNotesFragment(doc: Y.Doc): Y.XmlFragment {
  return doc.getXmlFragment(NOTES_FRAGMENT_KEY);
}
```

`libs/shared/collab-protocol/src/lib/stateless.ts`:

```ts
import { z } from 'zod';
import { SESSION_STATUSES, type SessionStatus } from '@swint/shared-domain';

const epochMs = z.number().int().nonnegative();

export const sessionStateMessageSchema = z.object({
  type: z.literal('session.state'),
  status: z.enum(SESSION_STATUSES as [SessionStatus, ...SessionStatus[]]),
  startedAt: epochMs.nullable(),
  durationSec: z.number().int().nonnegative(),
  extensionSec: z.number().int().nonnegative(),
  serverNow: epochMs,
});

export type SessionStateMessage = z.infer<typeof sessionStateMessageSchema>;

export const serverMessageSchema = z.discriminatedUnion('type', [sessionStateMessageSchema]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

export function encodeServerMessage(message: ServerMessage): string {
  return JSON.stringify(serverMessageSchema.parse(message));
}

export function parseServerMessage(payload: string): ServerMessage | null {
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return null;
  }
  const result = serverMessageSchema.safeParse(raw);
  return result.success ? result.data : null;
}
```

`libs/shared/collab-protocol/src/lib/awareness.ts`:

```ts
import { z } from 'zod';
import { PARTICIPANT_ROLES, type ParticipantRole } from '@swint/shared-domain';

export const AWARENESS_USER_FIELD = 'user';

export const awarenessUserSchema = z.object({
  userId: z.string().min(1),
  name: z.string().min(1).max(100),
  role: z.enum(PARTICIPANT_ROLES as [ParticipantRole, ...ParticipantRole[]]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  pointer: z
    .object({ x: z.number(), y: z.number(), tool: z.enum(['pointer', 'laser']) })
    .optional(),
  selectedElementIds: z.record(z.string(), z.literal(true)),
});

export type AwarenessUser = z.infer<typeof awarenessUserSchema>;
```

`libs/shared/collab-protocol/src/lib/close-reasons.ts`:

```ts
export const CLOSE_REASONS = [
  'unauthenticated',
  'forbidden',
  'invite_revoked',
  'session_ended',
  'not_started',
] as const;

export type CloseReason = (typeof CLOSE_REASONS)[number];

export function isCloseReason(value: unknown): value is CloseReason {
  return typeof value === 'string' && (CLOSE_REASONS as readonly string[]).includes(value);
}
```

`libs/shared/collab-protocol/src/index.ts`:

```ts
export * from './lib/doc-names';
export * from './lib/documents';
export * from './lib/stateless';
export * from './lib/awareness';
export * from './lib/close-reasons';
```

- [ ] **Step 5: Run the tests, typecheck and lint**

Run: `pnpm nx run-many -t test lint typecheck -p shared-collab-protocol`
Expected: PASS. Lint must not report module-boundary violations (`shared-collab-protocol` → `shared-domain` is contract → util, which is allowed).

- [ ] **Step 6: Commit**

```bash
git add libs/shared/collab-protocol pnpm-lock.yaml
git commit -m "feat(shared-collab-protocol): doc names, typed accessors, server messages, awareness

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `shared-api-contract`, zod schemas and oRPC contract

**Files:**
- Create: `libs/shared/api-contract/src/lib/schemas.ts`, `libs/shared/api-contract/src/lib/contract.ts`
- Test: `libs/shared/api-contract/src/lib/schemas.spec.ts`, `libs/shared/api-contract/src/lib/contract.spec.ts`
- Modify: `libs/shared/api-contract/src/index.ts`, `libs/shared/api-contract/package.json`

**Interfaces:**
- Consumes: `SESSION_STATUSES`, `EXTENSION_MINUTES`, `SessionStatus`, `ExtensionMinutes` from `@swint/shared-domain`
- Produces (Plans 2 and 4 rely on these exact names):
  - Schemas: `idSchema`, `meSchema`, `templateSchema`, `templateSummarySchema`, `templateInputSchema`, `boardSeedSchema`, `sessionSchema`, `sessionSummarySchema`, `createSessionInputSchema`, `createSessionOutputSchema`, `roomViewSchema` (a discriminated union on `role`)
  - Types: `Me`, `Template`, `TemplateSummary`, `TemplateInput`, `BoardSeed`, `Session`, `SessionSummary`, `CreateSessionInput`, `CreateSessionOutput`, `RoomView`
  - `contract` (oRPC contract router):

| Procedure | Method + path | Input | Output |
|---|---|---|---|
| `me.get` | GET `/me` | — | `Me` |
| `templates.list` | GET `/templates` | `{ includeArchived?: boolean }` | `TemplateSummary[]` |
| `templates.get` | GET `/templates/{id}` | `{ id }` | `Template` |
| `templates.getSeed` | GET `/templates/{id}/seed` | `{ id }` | `BoardSeed` |
| `templates.create` | POST `/templates` | `TemplateInput` | `Template` |
| `templates.update` | PUT `/templates/{id}` | `{ id } & TemplateInput` | `Template` |
| `templates.archive` | POST `/templates/{id}/archive` | `{ id }` | `Template` |
| `sessions.list` | GET `/sessions` | `{ status?: SessionStatus }` | `SessionSummary[]` |
| `sessions.get` | GET `/sessions/{id}` | `{ id }` | `Session` |
| `sessions.create` | POST `/sessions` | `CreateSessionInput` | `CreateSessionOutput` |
| `sessions.start` | POST `/sessions/{id}/start` | `{ id }` | `Session` |
| `sessions.extend` | POST `/sessions/{id}/extend` | `{ id, minutes: 5\|10 }` | `Session` |
| `sessions.end` | POST `/sessions/{id}/end` | `{ id }` | `Session` |
| `sessions.cancel` | POST `/sessions/{id}/cancel` | `{ id, reason?: string }` | `Session` |
| `sessions.regenerateInvite` | POST `/sessions/{id}/invite` | `{ id }` | `{ candidateUrl: string }` |
| `room.get` | GET `/room/{sessionId}` | `{ sessionId }` | `RoomView` |

  - `type AppContract = typeof contract`

- [ ] **Step 1: Declare the library's dependencies**

Add `"@swint/shared-domain": "workspace:*"`, `"@orpc/contract": "^1.16.0"` and `"zod": "^4.0.0"` to `dependencies` in `libs/shared/api-contract/package.json`, then run `pnpm install`.

- [ ] **Step 2: Write the failing tests**

`libs/shared/api-contract/src/lib/schemas.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  boardSeedSchema,
  createSessionInputSchema,
  roomViewSchema,
  sessionSchema,
  templateInputSchema,
} from './schemas';

const session = {
  id: '01JABCDEF0000000000000000',
  title: 'Design a URL shortener',
  candidateName: 'Ada',
  status: 'live',
  startedAt: 1000,
  durationSec: 2700,
  extensionSec: 0,
  endedAt: null,
  endedBy: null,
  cancelReason: null,
  instructionsMd: '# Task',
  rubricMd: '- scalability',
  createdBy: 'sub-1',
  createdAt: 500,
};

describe('templateInputSchema', () => {
  it('accepts a valid template', () => {
    const input = { title: 'URL shortener', instructionsMd: '# Go', rubricMd: '- x', durationMin: 45, boardSeed: null };
    expect(templateInputSchema.parse(input)).toEqual(input);
  });
  it.each([
    { title: '', instructionsMd: '', rubricMd: '', durationMin: 45, boardSeed: null },
    { title: 'x', instructionsMd: '', rubricMd: '', durationMin: 4, boardSeed: null },
    { title: 'x', instructionsMd: '', rubricMd: '', durationMin: 241, boardSeed: null },
  ])('rejects %o', (input) => {
    expect(templateInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('boardSeedSchema', () => {
  it('keeps unknown Excalidraw element fields', () => {
    const seed = { elements: [{ id: 'e1', type: 'rectangle', x: 1, y: 2, version: 1, versionNonce: 7, index: 'a0', isDeleted: false }] };
    expect(boardSeedSchema.parse(seed)).toEqual(seed);
  });
  it('requires an id on each element', () => {
    expect(boardSeedSchema.safeParse({ elements: [{ type: 'rectangle' }] }).success).toBe(false);
  });
});

describe('createSessionInputSchema', () => {
  it('trims and requires a candidate name', () => {
    expect(createSessionInputSchema.parse({ templateId: 't1', candidateName: '  Ada  ' }).candidateName).toBe('Ada');
    expect(createSessionInputSchema.safeParse({ templateId: 't1', candidateName: '   ' }).success).toBe(false);
  });
});

describe('sessionSchema', () => {
  it('accepts a valid session and rejects an unknown status', () => {
    expect(sessionSchema.parse(session)).toEqual(session);
    expect(sessionSchema.safeParse({ ...session, status: 'paused' }).success).toBe(false);
  });
});

describe('roomViewSchema', () => {
  const candidateView = {
    role: 'candidate',
    sessionId: session.id,
    title: session.title,
    status: 'live',
    timer: { startedAt: 1000, durationSec: 2700, extensionSec: 0 },
    instructionsMd: '# Task',
    me: { name: 'Ada' },
  };

  it('accepts a candidate view', () => {
    expect(roomViewSchema.parse(candidateView)).toEqual(candidateView);
  });

  it('strips rubric and other private fields from candidate views', () => {
    const parsed = roomViewSchema.parse({ ...candidateView, rubricMd: 'SECRET', cancelReason: 'SECRET' });
    expect(parsed).not.toHaveProperty('rubricMd');
    expect(parsed).not.toHaveProperty('cancelReason');
  });

  it('allows instructions to be null for a candidate in the waiting room', () => {
    expect(roomViewSchema.parse({ ...candidateView, status: 'created', instructionsMd: null }).role).toBe('candidate');
  });

  it('interviewer view includes rubric', () => {
    const view = {
      ...candidateView,
      role: 'interviewer',
      rubricMd: '- x',
      candidateName: 'Ada',
      me: { name: 'Grace', sub: 'sub-1' },
    };
    expect(roomViewSchema.parse(view)).toMatchObject({ role: 'interviewer', rubricMd: '- x' });
  });
});
```

`libs/shared/api-contract/src/lib/contract.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { contract } from './contract';

type Routed = { '~orpc': { route: { method?: string; path?: string } } };
const route = (p: unknown) => (p as Routed)['~orpc'].route;

describe('contract', () => {
  it('exposes the expected procedures with REST routes', () => {
    expect(route(contract.me.get)).toMatchObject({ method: 'GET', path: '/me' });
    expect(route(contract.templates.update)).toMatchObject({ method: 'PUT', path: '/templates/{id}' });
    expect(route(contract.sessions.extend)).toMatchObject({ method: 'POST', path: '/sessions/{id}/extend' });
    expect(route(contract.sessions.regenerateInvite)).toMatchObject({ method: 'POST', path: '/sessions/{id}/invite' });
    expect(route(contract.room.get)).toMatchObject({ method: 'GET', path: '/room/{sessionId}' });
  });

  it('has exactly the agreed procedure set', () => {
    const names = Object.entries(contract).flatMap(([group, procs]) =>
      Object.keys(procs as object).map((p) => `${group}.${p}`),
    );
    expect(names.sort()).toEqual(
      [
        'me.get',
        'room.get',
        'sessions.cancel',
        'sessions.create',
        'sessions.end',
        'sessions.extend',
        'sessions.get',
        'sessions.list',
        'sessions.regenerateInvite',
        'sessions.start',
        'templates.archive',
        'templates.create',
        'templates.get',
        'templates.getSeed',
        'templates.list',
        'templates.update',
      ].sort(),
    );
  });
});
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `pnpm nx test shared-api-contract`
Expected: FAIL, because the modules cannot be resolved.

- [ ] **Step 4: Implement the schemas**

`libs/shared/api-contract/src/lib/schemas.ts`:

```ts
import { z } from 'zod';
import {
  SESSION_STATUSES,
  type ExtensionMinutes,
  type SessionStatus,
} from '@swint/shared-domain';

const epochMs = z.number().int().nonnegative();
const sessionStatusSchema = z.enum(SESSION_STATUSES as [SessionStatus, ...SessionStatus[]]);

export const idSchema = z.string().min(1).max(64);
/** Must stay in sync with EXTENSION_MINUTES in shared-domain (5 | 10). */
export const extensionMinutesSchema = z.union([z.literal(5), z.literal(10)]) satisfies z.ZodType<ExtensionMinutes>;

export const meSchema = z.object({
  sub: z.string(),
  name: z.string(),
  email: z.string().email().nullable(),
  orgId: z.string(),
  roles: z.array(z.string()),
});

export const boardSeedSchema = z.object({
  elements: z.array(z.looseObject({ id: z.string().min(1) })),
});

export const templateInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  instructionsMd: z.string().max(50_000),
  rubricMd: z.string().max(50_000),
  durationMin: z.number().int().min(5).max(240),
  /** null = keep the current starting board (on update) / no starting board (on create). */
  boardSeed: boardSeedSchema.nullable(),
});

export const templateSchema = z.object({
  id: idSchema,
  title: z.string(),
  instructionsMd: z.string(),
  rubricMd: z.string(),
  durationMin: z.number().int(),
  hasBoardSeed: z.boolean(),
  archived: z.boolean(),
  createdBy: z.string(),
  createdAt: epochMs,
  updatedAt: epochMs,
});

export const templateSummarySchema = templateSchema.pick({
  id: true,
  title: true,
  durationMin: true,
  archived: true,
  updatedAt: true,
});

const timerSchema = z.object({
  startedAt: epochMs.nullable(),
  durationSec: z.number().int().nonnegative(),
  extensionSec: z.number().int().nonnegative(),
});

export const sessionSchema = z.object({
  id: idSchema,
  title: z.string(),
  candidateName: z.string(),
  status: sessionStatusSchema,
  ...timerSchema.shape,
  endedAt: epochMs.nullable(),
  endedBy: z.string().nullable(),
  cancelReason: z.string().nullable(),
  instructionsMd: z.string(),
  rubricMd: z.string(),
  createdBy: z.string(),
  createdAt: epochMs,
});

export const sessionSummarySchema = sessionSchema.pick({
  id: true,
  title: true,
  candidateName: true,
  status: true,
  startedAt: true,
  createdAt: true,
});

export const createSessionInputSchema = z.object({
  templateId: idSchema,
  candidateName: z.string().trim().min(1).max(100),
});

export const createSessionOutputSchema = z.object({
  session: sessionSchema,
  candidateUrl: z.string().url(),
  interviewerUrl: z.string().url(),
});

const roomBase = {
  sessionId: idSchema,
  title: z.string(),
  status: sessionStatusSchema,
  timer: timerSchema,
};

/** z.object strips unknown keys, so private fields never survive parsing a candidate view. */
export const candidateRoomViewSchema = z.object({
  ...roomBase,
  role: z.literal('candidate'),
  /** null while the session is in the waiting room (status = created). */
  instructionsMd: z.string().nullable(),
  me: z.object({ name: z.string() }),
});

export const interviewerRoomViewSchema = z.object({
  ...roomBase,
  role: z.literal('interviewer'),
  instructionsMd: z.string(),
  rubricMd: z.string(),
  candidateName: z.string(),
  me: z.object({ name: z.string(), sub: z.string() }),
});

export const roomViewSchema = z.discriminatedUnion('role', [candidateRoomViewSchema, interviewerRoomViewSchema]);

export type Me = z.infer<typeof meSchema>;
export type BoardSeed = z.infer<typeof boardSeedSchema>;
export type TemplateInput = z.infer<typeof templateInputSchema>;
export type Template = z.infer<typeof templateSchema>;
export type TemplateSummary = z.infer<typeof templateSummarySchema>;
export type Session = z.infer<typeof sessionSchema>;
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type CreateSessionInput = z.infer<typeof createSessionInputSchema>;
export type CreateSessionOutput = z.infer<typeof createSessionOutputSchema>;
export type RoomView = z.infer<typeof roomViewSchema>;
```

- [ ] **Step 5: Implement the contract**

`libs/shared/api-contract/src/lib/contract.ts`:

```ts
import { oc } from '@orpc/contract';
import { z } from 'zod';
import { SESSION_STATUSES, type SessionStatus } from '@swint/shared-domain';
import {
  boardSeedSchema,
  createSessionInputSchema,
  createSessionOutputSchema,
  extensionMinutesSchema,
  idSchema,
  meSchema,
  roomViewSchema,
  sessionSchema,
  sessionSummarySchema,
  templateInputSchema,
  templateSchema,
  templateSummarySchema,
} from './schemas';

const byId = z.object({ id: idSchema });

export const contract = {
  me: {
    get: oc.route({ method: 'GET', path: '/me' }).output(meSchema),
  },
  templates: {
    list: oc
      .route({ method: 'GET', path: '/templates' })
      .input(z.object({ includeArchived: z.coerce.boolean().optional() }))
      .output(z.array(templateSummarySchema)),
    get: oc.route({ method: 'GET', path: '/templates/{id}' }).input(byId).output(templateSchema),
    getSeed: oc.route({ method: 'GET', path: '/templates/{id}/seed' }).input(byId).output(boardSeedSchema),
    create: oc.route({ method: 'POST', path: '/templates' }).input(templateInputSchema).output(templateSchema),
    update: oc
      .route({ method: 'PUT', path: '/templates/{id}' })
      .input(byId.extend(templateInputSchema.shape))
      .output(templateSchema),
    archive: oc.route({ method: 'POST', path: '/templates/{id}/archive' }).input(byId).output(templateSchema),
  },
  sessions: {
    list: oc
      .route({ method: 'GET', path: '/sessions' })
      .input(z.object({ status: z.enum(SESSION_STATUSES as [SessionStatus, ...SessionStatus[]]).optional() }))
      .output(z.array(sessionSummarySchema)),
    get: oc.route({ method: 'GET', path: '/sessions/{id}' }).input(byId).output(sessionSchema),
    create: oc
      .route({ method: 'POST', path: '/sessions' })
      .input(createSessionInputSchema)
      .output(createSessionOutputSchema),
    start: oc.route({ method: 'POST', path: '/sessions/{id}/start' }).input(byId).output(sessionSchema),
    extend: oc
      .route({ method: 'POST', path: '/sessions/{id}/extend' })
      .input(byId.extend({ minutes: extensionMinutesSchema }))
      .output(sessionSchema),
    end: oc.route({ method: 'POST', path: '/sessions/{id}/end' }).input(byId).output(sessionSchema),
    cancel: oc
      .route({ method: 'POST', path: '/sessions/{id}/cancel' })
      .input(byId.extend({ reason: z.string().trim().max(500).optional() }))
      .output(sessionSchema),
    regenerateInvite: oc
      .route({ method: 'POST', path: '/sessions/{id}/invite' })
      .input(byId)
      .output(z.object({ candidateUrl: z.string().url() })),
  },
  room: {
    get: oc
      .route({ method: 'GET', path: '/room/{sessionId}' })
      .input(z.object({ sessionId: idSchema }))
      .output(roomViewSchema),
  },
};

export type AppContract = typeof contract;
```

`libs/shared/api-contract/src/index.ts`:

```ts
export * from './lib/schemas';
export * from './lib/contract';
```

- [ ] **Step 6: Run the tests, typecheck and lint**

Run: `pnpm nx run-many -t test lint typecheck -p shared-api-contract`
Expected: PASS.

If `contract.spec.ts` fails only because the route metadata is not at `['~orpc'].route`, inspect a procedure with `console.log(Object.keys(contract.me.get))` and in `@orpc/contract`'s `ContractProcedure` type, then fix the `route()` helper in the test. Do not change the contract.

- [ ] **Step 7: Commit**

```bash
git add libs/shared/api-contract pnpm-lock.yaml
git commit -m "feat(shared-api-contract): zod schemas and oRPC contract

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Board sync core: element ordering and conflict rule

**Files:**
- Create: `libs/web/ui-whiteboard/src/lib/binding/element-order.ts`
- Test: `libs/web/ui-whiteboard/src/lib/binding/element-order.spec.ts`
- Modify: `libs/web/ui-whiteboard/package.json` (dependencies)

**Interfaces:**
- Consumes: `SyncedElement` from `@swint/shared-collab-protocol`
- Produces:
  - `function shouldReplace(existing: SyncedElement | undefined, incoming: SyncedElement): boolean`, true when `incoming` should overwrite `existing` (higher version, or same version with a lower `versionNonce`)
  - `function isSameRevision(a: SyncedElement | undefined, b: SyncedElement): boolean`, same `version` and `versionNonce`
  - `function sortByIndex(elements: Iterable<SyncedElement>): SyncedElement[]`, ordered by `index` (string compare, `null` last), ties broken by `id`

- [ ] **Step 1: Declare the library's dependencies**

Add `"@swint/shared-collab-protocol": "workspace:*"` and `"yjs": "^13.6.0"` to `dependencies` in `libs/web/ui-whiteboard/package.json` (create a `dependencies` block if the generator didn't), then run `pnpm install`.

- [ ] **Step 2: Write the failing tests**

`libs/web/ui-whiteboard/src/lib/binding/element-order.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { SyncedElement } from '@swint/shared-collab-protocol';
import { isSameRevision, shouldReplace, sortByIndex } from './element-order';

const el = (id: string, version: number, versionNonce: number, index: string | null = 'a0'): SyncedElement => ({
  id,
  version,
  versionNonce,
  index,
  isDeleted: false,
});

describe('shouldReplace', () => {
  it('replaces when nothing exists', () => {
    expect(shouldReplace(undefined, el('a', 1, 5))).toBe(true);
  });
  it('prefers the higher version', () => {
    expect(shouldReplace(el('a', 2, 5), el('a', 3, 9))).toBe(true);
    expect(shouldReplace(el('a', 3, 9), el('a', 2, 5))).toBe(false);
  });
  it('on equal version, the lower versionNonce wins', () => {
    expect(shouldReplace(el('a', 2, 9), el('a', 2, 5))).toBe(true);
    expect(shouldReplace(el('a', 2, 5), el('a', 2, 9))).toBe(false);
  });
  it('does not replace an identical revision', () => {
    expect(shouldReplace(el('a', 2, 5), el('a', 2, 5))).toBe(false);
  });
});

describe('isSameRevision', () => {
  it('compares version and nonce', () => {
    expect(isSameRevision(el('a', 2, 5), el('a', 2, 5))).toBe(true);
    expect(isSameRevision(el('a', 2, 5), el('a', 2, 6))).toBe(false);
    expect(isSameRevision(undefined, el('a', 2, 5))).toBe(false);
  });
});

describe('sortByIndex', () => {
  it('orders by fractional index, nulls last, id as tie-breaker', () => {
    const sorted = sortByIndex([el('c', 1, 1, null), el('b', 1, 1, 'a1'), el('a', 1, 1, 'a0'), el('d', 1, 1, 'a1')]);
    expect(sorted.map((e) => e.id)).toEqual(['a', 'b', 'd', 'c']);
  });
});
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `pnpm nx test web-ui-whiteboard`
Expected: FAIL, because `./element-order` cannot be resolved.

- [ ] **Step 4: Implement**

`libs/web/ui-whiteboard/src/lib/binding/element-order.ts`:

```ts
import type { SyncedElement } from '@swint/shared-collab-protocol';

/** Same rule as Excalidraw's reconcile: the higher version wins; on a tie, the lower versionNonce wins. */
export function shouldReplace(existing: SyncedElement | undefined, incoming: SyncedElement): boolean {
  if (!existing) return true;
  if (incoming.version !== existing.version) return incoming.version > existing.version;
  return incoming.versionNonce < existing.versionNonce;
}

export function isSameRevision(a: SyncedElement | undefined, b: SyncedElement): boolean {
  return !!a && a.version === b.version && a.versionNonce === b.versionNonce;
}

export function sortByIndex(elements: Iterable<SyncedElement>): SyncedElement[] {
  return [...elements].sort((a, b) => {
    if (a.index !== b.index) {
      if (a.index === null) return 1;
      if (b.index === null) return -1;
      return a.index < b.index ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `pnpm nx test web-ui-whiteboard`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libs/web/ui-whiteboard pnpm-lock.yaml
git commit -m "feat(web-ui-whiteboard): element conflict rule and index ordering

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Board sync core: `BoardSync` with convergence tests

**Files:**
- Create: `libs/web/ui-whiteboard/src/lib/binding/board-sync.ts`, `libs/web/ui-whiteboard/src/lib/binding/test-peers.ts`
- Test: `libs/web/ui-whiteboard/src/lib/binding/board-sync.spec.ts`
- Modify: `libs/web/ui-whiteboard/src/index.ts`

**Interfaces:**
- Consumes: `SyncedElement`, `getBoardElements` from `@swint/shared-collab-protocol`; `shouldReplace`, `isSameRevision`, `sortByIndex` (Task 6)
- Produces (Plan 4's React adapter uses these exact names):

```ts
export interface BoardSyncOptions {
  doc: Y.Doc;
  /** Called with the full ordered element list whenever remote changes were accepted. */
  onRemoteChange: (elements: SyncedElement[]) => void;
}
export class BoardSync {
  constructor(options: BoardSyncOptions);
  /** Push the current local scene. Only elements that are new or newer than what we know are written, in one transaction. */
  pushLocal(sceneElements: readonly SyncedElement[]): void;
  /** Current ordered elements (including isDeleted tombstones). */
  getElements(): SyncedElement[];
  destroy(): void;
}
```

**Design notes for the implementer:**
- Elements are stored as whole JSON values in `Y.Map<SyncedElement>`, keyed by `id`. Deletions are `isDeleted: true` tombstones, never `map.delete`. That is how Excalidraw represents deletes, and it stops a concurrent edit from bringing a deleted element back.
- A Yjs `Y.Map` resolves concurrent writes to the same key by Yjs client ID, **not** by our version rule. So after applying a remote change, if our known copy should win by `shouldReplace`, `BoardSync` **writes its copy back** (`reassert`). Because every peer applies the same deterministic rule, all peers end up with the version that rule picks, and the extra writes stop once they agree.
- `onRemoteChange` must not fire for our own writes (`transaction.origin === this`).

- [ ] **Step 1: Write the test helper**

`libs/web/ui-whiteboard/src/lib/binding/test-peers.ts`:

```ts
import * as Y from 'yjs';

/**
 * Two Y.Docs whose updates are queued and only delivered on flush(),
 * so tests can create true concurrent edits.
 */
export function createPeers() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  const toB: Uint8Array[] = [];
  const toA: Uint8Array[] = [];
  a.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'remote') toB.push(update);
  });
  b.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'remote') toA.push(update);
  });

  /** Deliver queued updates in both directions until nothing is left. */
  function flush(maxRounds = 10) {
    for (let round = 0; round < maxRounds; round++) {
      if (toA.length === 0 && toB.length === 0) return;
      for (const u of toB.splice(0)) Y.applyUpdate(b, u, 'remote');
      for (const u of toA.splice(0)) Y.applyUpdate(a, u, 'remote');
    }
    throw new Error('peers did not converge within maxRounds');
  }

  return { a, b, flush };
}
```

- [ ] **Step 2: Write the failing tests**

`libs/web/ui-whiteboard/src/lib/binding/board-sync.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { SyncedElement } from '@swint/shared-collab-protocol';
import { getBoardElements } from '@swint/shared-collab-protocol';
import { BoardSync } from './board-sync';
import { createPeers } from './test-peers';

const el = (
  id: string,
  version: number,
  versionNonce: number,
  extra: Partial<SyncedElement> = {},
): SyncedElement => ({ id, version, versionNonce, index: 'a0', isDeleted: false, x: 0, ...extra });

function setup() {
  const { a, b, flush } = createPeers();
  const onA = vi.fn();
  const onB = vi.fn();
  const syncA = new BoardSync({ doc: a, onRemoteChange: onA });
  const syncB = new BoardSync({ doc: b, onRemoteChange: onB });
  return { a, b, flush, syncA, syncB, onA, onB };
}

const snapshot = (s: BoardSync) => s.getElements().map((e) => [e.id, e.version, e.versionNonce, e['x'], e.isDeleted]);

describe('BoardSync', () => {
  it('propagates a new element to the other peer', () => {
    const { flush, syncA, syncB, onB } = setup();
    syncA.pushLocal([el('r1', 1, 10, { x: 5 })]);
    flush();
    expect(snapshot(syncB)).toEqual([['r1', 1, 10, 5, false]]);
    expect(onB).toHaveBeenCalledTimes(1);
    expect(onB.mock.calls[0][0]).toEqual(syncB.getElements());
  });

  it('does not notify for its own local writes', () => {
    const { flush, syncA, onA } = setup();
    syncA.pushLocal([el('r1', 1, 10)]);
    flush();
    expect(onA).not.toHaveBeenCalled();
  });

  it('only writes elements that changed', () => {
    const { a, syncA } = setup();
    const updates = vi.fn();
    a.on('update', updates);
    syncA.pushLocal([el('r1', 1, 10), el('r2', 1, 11)]);
    syncA.pushLocal([el('r1', 1, 10), el('r2', 1, 11)]); // unchanged scene
    expect(updates).toHaveBeenCalledTimes(1);
    syncA.pushLocal([el('r1', 2, 12), el('r2', 1, 11)]);
    expect(updates).toHaveBeenCalledTimes(2);
    expect(getBoardElements(a).get('r1')?.version).toBe(2);
  });

  it('ignores stale local pushes (older version than known)', () => {
    const { flush, syncA, syncB } = setup();
    syncA.pushLocal([el('r1', 5, 10, { x: 50 })]);
    flush();
    syncB.pushLocal([el('r1', 3, 1, { x: 30 })]);
    flush();
    expect(snapshot(syncA)).toEqual([['r1', 5, 10, 50, false]]);
    expect(snapshot(syncB)).toEqual([['r1', 5, 10, 50, false]]);
  });

  it('concurrent edits to different elements both survive', () => {
    const { flush, syncA, syncB } = setup();
    syncA.pushLocal([el('r1', 1, 10)]);
    syncB.pushLocal([el('r2', 1, 20)]);
    flush();
    expect(snapshot(syncA)).toEqual(snapshot(syncB));
    expect(syncA.getElements().map((e) => e.id).sort()).toEqual(['r1', 'r2']);
  });

  it('concurrent edits to the same element converge to the higher version on both peers', () => {
    const { flush, syncA, syncB } = setup();
    syncA.pushLocal([el('r1', 1, 10)]);
    flush();
    // concurrent: A moves it once (v2), B moves it twice (v3)
    syncA.pushLocal([el('r1', 2, 30, { x: 100 })]);
    syncB.pushLocal([el('r1', 3, 40, { x: 200 })]);
    flush();
    expect(snapshot(syncA)).toEqual([['r1', 3, 40, 200, false]]);
    expect(snapshot(syncB)).toEqual([['r1', 3, 40, 200, false]]);
  });

  it('equal-version conflicts converge to the lower versionNonce, whichever Yjs picked', () => {
    // Run both orientations so the result does not depend on Yjs client-id ordering.
    for (const [nonceA, nonceB] of [
      [5, 9],
      [9, 5],
    ]) {
      const { flush, syncA, syncB } = setup();
      syncA.pushLocal([el('r1', 1, 1)]);
      flush();
      syncA.pushLocal([el('r1', 2, nonceA, { x: nonceA })]);
      syncB.pushLocal([el('r1', 2, nonceB, { x: nonceB })]);
      flush();
      expect(snapshot(syncA)).toEqual([['r1', 2, 5, 5, false]]);
      expect(snapshot(syncB)).toEqual([['r1', 2, 5, 5, false]]);
    }
  });

  it('delete vs concurrent older edit: the delete (higher version) wins', () => {
    const { flush, syncA, syncB } = setup();
    syncA.pushLocal([el('r1', 1, 10)]);
    flush();
    syncA.pushLocal([el('r1', 3, 11, { isDeleted: true })]);
    syncB.pushLocal([el('r1', 2, 12, { x: 99 })]);
    flush();
    expect(syncA.getElements()[0].isDeleted).toBe(true);
    expect(syncB.getElements()[0].isDeleted).toBe(true);
  });

  it('returns elements ordered by fractional index', () => {
    const { flush, syncA, syncB } = setup();
    syncA.pushLocal([el('top', 1, 1, { index: 'a2' }), el('bottom', 1, 2, { index: 'a0' })]);
    syncB.pushLocal([el('middle', 1, 3, { index: 'a1' })]);
    flush();
    expect(syncA.getElements().map((e) => e.id)).toEqual(['bottom', 'middle', 'top']);
    expect(syncB.getElements().map((e) => e.id)).toEqual(['bottom', 'middle', 'top']);
  });

  it('loads elements already present in the doc (late joiner)', () => {
    const { b, flush, syncA } = setup();
    syncA.pushLocal([el('r1', 1, 10)]);
    flush();
    const late = new BoardSync({ doc: b, onRemoteChange: vi.fn() });
    expect(late.getElements().map((e) => e.id)).toEqual(['r1']);
  });

  it('stops observing after destroy', () => {
    const { flush, syncA, syncB, onB } = setup();
    syncB.destroy();
    syncA.pushLocal([el('r1', 1, 10)]);
    flush();
    expect(onB).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `pnpm nx test web-ui-whiteboard`
Expected: FAIL, because `./board-sync` cannot be resolved.

- [ ] **Step 4: Implement**

`libs/web/ui-whiteboard/src/lib/binding/board-sync.ts`:

```ts
import type * as Y from 'yjs';
import { getBoardElements, type SyncedElement } from '@swint/shared-collab-protocol';
import { isSameRevision, shouldReplace, sortByIndex } from './element-order';

export interface BoardSyncOptions {
  doc: Y.Doc;
  onRemoteChange: (elements: SyncedElement[]) => void;
}

export class BoardSync {
  private readonly doc: Y.Doc;
  private readonly elements: Y.Map<SyncedElement>;
  private readonly onRemoteChange: (elements: SyncedElement[]) => void;
  /** Best-known revision per element id (from local pushes and accepted remote changes). */
  private readonly known = new Map<string, SyncedElement>();

  constructor(options: BoardSyncOptions) {
    this.doc = options.doc;
    this.onRemoteChange = options.onRemoteChange;
    this.elements = getBoardElements(this.doc);
    this.elements.forEach((value, key) => this.known.set(key, value));
    this.elements.observe(this.handleChange);
  }

  pushLocal(sceneElements: readonly SyncedElement[]): void {
    const changed: SyncedElement[] = [];
    for (const element of sceneElements) {
      if (shouldReplace(this.known.get(element.id), element)) {
        changed.push(element);
        this.known.set(element.id, element);
      }
    }
    if (changed.length === 0) return;
    this.doc.transact(() => {
      for (const element of changed) this.elements.set(element.id, element);
    }, this);
  }

  getElements(): SyncedElement[] {
    return sortByIndex(this.known.values());
  }

  destroy(): void {
    this.elements.unobserve(this.handleChange);
  }

  private readonly handleChange = (event: Y.YMapEvent<SyncedElement>, transaction: Y.Transaction): void => {
    if (transaction.origin === this) return;

    let accepted = false;
    const reassert: SyncedElement[] = [];

    for (const key of event.keysChanged) {
      const incoming = this.elements.get(key);
      if (!incoming) continue; // keys are never deleted; tombstones use isDeleted
      const local = this.known.get(key);
      if (isSameRevision(local, incoming)) continue;
      if (shouldReplace(local, incoming)) {
        this.known.set(key, incoming);
        accepted = true;
      } else if (local) {
        // Yjs kept a revision our rule says should lose: write ours back so every peer converges.
        reassert.push(local);
      }
    }

    if (reassert.length > 0) {
      this.doc.transact(() => {
        for (const element of reassert) this.elements.set(element.id, element);
      }, this);
    }
    if (accepted) this.onRemoteChange(this.getElements());
  };
}
```

`libs/web/ui-whiteboard/src/index.ts`:

```ts
export * from './lib/binding/element-order';
export * from './lib/binding/board-sync';
```

(`test-peers.ts` is a test helper and is deliberately **not** exported.)

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `pnpm nx test web-ui-whiteboard`
Expected: PASS, all `BoardSync` tests.

If the equal-version test fails for one orientation, check that `handleChange` re-asserts when `local` should win (`!shouldReplace(local, incoming)` and the revisions differ) and that `flush()` delivers the re-asserted update. Do not loosen the test.

- [ ] **Step 6: Run the full verification for this plan**

```bash
pnpm nx run-many -t lint test typecheck --projects=shared-domain,shared-collab-protocol,shared-api-contract,web-ui-whiteboard
```

Expected: everything passes, with no module-boundary lint errors.

- [ ] **Step 7: Commit**

```bash
git add libs/web/ui-whiteboard
git commit -m "feat(web-ui-whiteboard): BoardSync engine with convergence tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Done criteria for Plan 1

- `pnpm nx run-many -t lint test typecheck` passes for all four libraries.
- Module boundary rules are active. Quick manual check: temporarily importing `@swint/web-ui-whiteboard` from `shared-domain` makes `pnpm nx lint shared-domain` fail. Revert the import afterwards.
- Decision recorded: the community `y-excalidraw` package (last published 2024, peer `@excalidraw/excalidraw ^0.17`) is **not** used. Our `BoardSync` meets the spec §7.2 binding requirements. Plan 4 adds the Excalidraw adapter: requestAnimationFrame throttling, `reconcileElements`, `CaptureUpdateAction.NEVER`.
