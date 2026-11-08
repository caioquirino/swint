# Plan 4: Web App (React + Vite, real-time room, dashboard, template editor)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the browser app for v1. Interviewers sign in, author templates, create sessions and share links. Candidate and interviewers meet in a session room with instructions, a timer controlled by the server, live presence, a shared Excalidraw board and private interviewer notes. After the session, interviewers get a read-only room with export.

**Architecture:**
- `apps/web` is a Vite + React 19 SPA served on port 4200. Its dev server proxies `/api/`, `/auth/`, `/join/` and `/collab` (WebSocket) to the API, so the browser sees one origin and the API's httpOnly cookies just work.
- Spec §3.1 libraries, all `scope:web`:
  - `data-access-api`: typed oRPC client (`OpenAPILink`) plus TanStack Query utils
  - `data-access-collab`: one Hocuspocus socket per room, multiplexing the board and notes documents, with a connection state machine that implements the real-time contract
  - `ui-whiteboard`: Excalidraw ↔ Yjs binding and board components
  - `ui-session-panels`: markdown, timer, presence, notes (TipTap)
  - `ui-primitives`: small Tailwind/Radix building blocks
  - three feature libs: dashboard, template editor, session room
- Two server-side additions: the collab server stamps awareness with the connection's identity, and a dev seed template is created on startup. `apps/api` also gets a watch-mode `serve`.

**Tech Stack:**
- React 19, Vite 8, React Router 7 (declarative `BrowserRouter`/`Routes`), TanStack Query 5
- oRPC 1.16 (`@orpc/client`, `@orpc/openapi-client`, `@orpc/tanstack-query`)
- Tailwind CSS 4 (`@tailwindcss/vite`), Radix Dialog
- `@excalidraw/excalidraw` **0.18.1 (exact pin)**
- TipTap 3.33 (`@tiptap/react`, `starter-kit`, `extension-collaboration`, `extension-collaboration-caret`)
- `@hocuspocus/provider` 4.8, `yjs` 13.6, `y-protocols` 1.0
- `react-markdown` 10
- Vitest 5 + jsdom + Testing Library

**Spec:** `docs/superpowers/specs/2026-11-08-swint-foundation-design.md`. Binding sections: §1 goals, §3.1 layout and boundaries, §5 links and auth, §6 lifecycle, roles and timer, §7.2 binding, §7.3 presence, §8 errors and testing, §10 local dev. The real-time client contract is `libs/shared/collab-protocol/README.md`, and it binds as tightly as the spec.

**Depends on (already on `main`):**
- `@swint/shared-domain`: `SessionStatus`, `ParticipantRole`, `isFinished`, `remainingMs`, `timerPhase`, `serverOffsetMs`, `TimerFields`, `EXTENSION_MINUTES`
- `@swint/shared-collab-protocol`:
  - documents and names: `docName`, `getBoardElements`, `getNotesFragment`, `NOTES_FRAGMENT_KEY`, `SyncedElement`
  - messages: `parseServerMessage`, `SessionStateMessage`
  - close reasons: `CLOSE_REASONS`, `isCloseReason`, `CloseReason`, `POLICY_CLOSE_CODE`
  - awareness: `awarenessUserSchema`, `AwarenessUser`, `AWARENESS_USER_FIELD`
- `@swint/shared-api-contract`: `contract`, `RoomView`, `Me`, `Template`, `TemplateInput`, `templateInputSchema`, `SessionSummary`, `TemplateSummary`, `CreateSessionOutput`
- `@swint/web-ui-whiteboard`: `BoardSync`, `shouldReplace`, `isSameRevision`, `sortByIndex`, and test helper `src/lib/binding/test-peers.ts` (`createPeers`)
- `@swint/api-collab-server`: `createCollabServer` (hooks in `src/lib/collab-server.ts`), test kit `src/testing/collab-test-kit.ts` (`startCollabTestKit`, `connectClient`, `seedSession`)
- `apps/api`: `createApp`, `config.ts`, and the `src/test/app-test-setup.ts` (`setup`, `templateBody`)

Read the `src/index.ts` exports of each before starting a task that uses it.

## Global Constraints

**Carried over**
- Run tasks through Nx (`pnpm nx <target> <project>`). Never guess CLI flags; run `--help` first. Add Nx plugins with `pnpm nx add <plugin>`.
- Relative TypeScript imports use `.js` extensions (they resolve to `.ts`/`.tsx`). Nx project names have no `@swint/` prefix; import paths are `@swint/<project-name>`.
- Never commit `.superpowers/`. Stage files by explicit path (never `git add -A`). Commit after every task with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Zero lint warnings. `@nx/dependency-checks`: every library declares exactly the packages its non-spec code imports. Run `pnpm install && pnpm nx sync` after changing dependencies.
- **Test-only code is never compiled into a library.** Put it under `src/testing/`, exclude `src/testing/**` in `tsconfig.lib.json`, include it in `tsconfig.spec.json`, and add `{projectRoot}/src/testing/**` to dependency-checks `ignoredFiles`. A `./testing` export subpath is allowed (as in `api-data-access-persistence`).
- Integration tests that need DynamoDB/S3 use Testcontainers via `@swint/api-data-access-persistence/testing`. Leave no containers or server processes running.
- Times are epoch ms everywhere.
- Never kill a process you didn't start. Port 3000 may already be taken by someone else's API. If so, run your API on `PORT=3100` and point the web dev proxy at it with `SWINT_API_URL=http://localhost:3100`.

**Libraries**

| Project | Path | Tags |
|---|---|---|
| `web` (app) | `apps/web` | `scope:web` |
| `web-ui-primitives` | `libs/web/ui-primitives` | `scope:web,type:ui` |
| `web-ui-whiteboard` (exists) | `libs/web/ui-whiteboard` | `scope:web,type:ui` |
| `web-ui-session-panels` | `libs/web/ui-session-panels` | `scope:web,type:ui` |
| `web-data-access-api` | `libs/web/data-access-api` | `scope:web,type:data-access` |
| `web-data-access-collab` | `libs/web/data-access-collab` | `scope:web,type:data-access` |
| `web-feature-dashboard` | `libs/web/feature-dashboard` | `scope:web,type:feature` |
| `web-feature-template-editor` | `libs/web/feature-template-editor` | `scope:web,type:feature` |
| `web-feature-session-room` | `libs/web/feature-session-room` | `scope:web,type:feature` |

`ui-primitives` is not in spec §3.1. **Ruling:** the spec's shadcn/ui choice needs a home for shared primitives, and §3.1's rules allow a `type:ui` lib. A few hand-written shadcn-style components replace the shadcn CLI, which doesn't target Nx libs.

**Web library conventions** (generated libs are normalised to these, matching `web-ui-whiteboard`):
- **Generator:** `pnpm nx g @nx/react:library --directory=libs/web/<dir> --name=web-<dir> --importPath=@swint/web-<dir> --bundler=none --unitTestRunner=vitest --linter=eslint --tags=<tags> --component=false --no-interactive`. Check `--help` first.
- **`package.json`:**
  - `"type": "module"`, `"private": true`
  - `exports["."]` maps `types`/`import`/`default` to `./src/index.ts`
  - `dependencies` lists exactly the runtime imports; `workspace:*` for `@swint/*`
- **`vite.config.mts` test block:**
  - `environment: 'jsdom'`, `globals: true`, `passWithNoTests: true`
  - `setupFiles: ['./src/test-setup.ts']`, where `src/test-setup.ts` contains `import '@testing-library/jest-dom/vitest';`
  - exclude `src/test-setup.ts` from `tsconfig.lib.json`
- **Lint:** `eslint.config.mjs` adds the `@nx/dependency-checks` block (copy it from `libs/api/collab-server/eslint.config.mjs`). Its `ignoredFiles` add `{projectRoot}/vite.config.{js,ts,mjs,mts}` and `{projectRoot}/src/test-setup.ts`. Task 2 establishes how to make the rule run for a lib without a `build` target, and every later lib copies that.

**Fixed values**
- Dev server:
  - `http://localhost:4200`, `strictPort: true`
  - proxy target `process.env.SWINT_API_URL ?? 'http://localhost:3000'`
  - proxied paths (regex keys): `^/api/`, `^/auth/`, `^/join/`, `^/collab` (`ws: true`)
  - `/link-invalid` and `/s/...` are **not** proxied: the SPA renders them
- Vite `resolve.conditions: ['swint', ...defaultClientConditions]`.
- **Web routes:**
  - `/` dashboard
  - `/templates/new`, `/templates/:templateId` template editor
  - `/s/:sessionId` room
  - `/link-invalid?reason=invite_revoked|session_ended`
  - `*` not found
- **Login:**
  - Login is a full-page navigation to `/auth/login?returnTo=<encodeURIComponent(path+search)>`.
  - Logout is `fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' })`, **with no body and no `content-type`**. It returns `{ redirectUrl }`, which the app navigates to.
- **API body rule:** `/api/*` accepts only `application/json` (2 MB). An empty body sent with `content-type: application/json` gets 400. Task 6 proves the oRPC client never does this.
- **Collab URL:** `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/collab`, with `token: 'cookie'`.
- **Provider retry:** `delay: 1000`, `minDelay: 1000`, `maxDelay: 10_000`. `delay` must be ≥ `minDelay`. Tests pass smaller values.
- **Failed opens before REST probe:** `3`.
- **Candidate waiting room:** polls `room.get` every `3000` ms.
- **Presence:**
  - pointer awareness updates at most every `33` ms (leading and trailing)
  - board pushes at most once per `requestAnimationFrame`
- **Presence identity:**
  - interviewer `userId` = OIDC `sub`
  - candidate `userId` = `candidate:<sessionId>`
  - colour = `colorForUser(userId)` (Task 1)
  - The server overwrites `userId`, `name`, `role` and `color` (Task 3)
- **Excalidraw:**
  - `UIOptions={{ tools: { image: false } }}`
  - pasting image files is refused
  - remote scene updates use `captureUpdate: CaptureUpdateAction.NEVER`
- **Exports:** `png` (`exportToBlob`), `svg` (`exportToSvg`), `excalidraw` (`serializeAsJSON(..., 'local')`). File name `<slug(title)>.<ext>`.
- **Dev seed template:**
  - title `Design a URL shortener`
  - `durationMin: 45`
  - created only when absent (archived ones count), with `createdBy: 'system'`
  - `SEED_DEV_DATA` defaults to true only when `NODE_ENV=development`

**Carry-forwards (from Plans 1–3 reviews; each one maps to a task)**

| Carry-forward | Task |
|---|---|
| Awareness stamped from server identity (`beforeHandleAwareness`) | 3 |
| BoardSync: deep copies (nested `points`, `boundElements`); receiver-Y.Map assertion; `destroy()` guards `pushLocal`; incoming values validated | 1, 2 |
| `web-ui-whiteboard`: `@nx/dependency-checks` + `"type": "module"` | 2 |
| Undo isolation (`CaptureUpdateAction.NEVER`) and rAF throttling tests | 8 |
| Vite conditions and proxy; `/link-invalid` not proxied | 5 |
| `api` `serve` watch mode | 4 |
| Empty-body JSON POST → 400: prove the oRPC client is safe | 6 |
| Provider: `token: 'cookie'`, `WebSocketPolyfill` on `HocuspocusProviderWebsocket`, `delay ≥ minDelay` | 7 |
| 401 at upgrade → infinite retry: detect after N failed opens, probe REST | 7, 13 |
| `onAuthenticationFailed` reasons; `not_started` waiting room polls REST | 7, 12, 13 |
| 4403 `session_ended`/`invite_revoked` → `provider.destroy()` | 7, 13 |
| `session.state` may arrive before or after `synced` | 7, 12 |
| Timer frozen when ended (`remainingMs` ignores `endedAt`) | 9 |
| Candidate FORBIDDEN `data.reason === 'session_ended'` → ended screen | 12 |
| Templates are last-write-wins → warn on concurrent edit | 11 |

**Deliberately out of scope (Plan 5):** Playwright e2e, Docker images and nginx, self-hosting Excalidraw fonts (Excalidraw 0.18 loads them from its CDN by default), and the WebSocket Origin allowlist and ping.

---

## File structure

```
libs/shared/collab-protocol/src/lib/presence.ts (+spec)          colorForUser, candidateUserId, stampAwarenessState, readAwarenessUser
libs/shared/collab-protocol/src/lib/board-validation.ts (+spec)  boardElementSchema, isValidBoardElement
libs/web/ui-whiteboard/src/lib/binding/board-sync.ts (modify)    deep copies, validation, destroy guard
libs/web/ui-whiteboard/src/lib/binding/excalidraw-binding.ts      ExcalidrawBinding (rAF push, remote apply, presence)
libs/web/ui-whiteboard/src/lib/components/collaborative-board.tsx CollaborativeBoard, excalidrawFns
libs/web/ui-whiteboard/src/lib/components/seed-board-editor.tsx   SeedBoardEditor
libs/web/ui-whiteboard/src/lib/export.ts                          exportBoard, downloadBlob, EXPORT_FORMATS
libs/api/collab-server/src/lib/presence.ts (+ hook in collab-server.ts)
apps/api/src/app/dev-seed.ts (+spec), config.ts, create-app.ts, package.json (serve targets)
apps/web/                                                         Vite app, dev-proxy.ts, routes
libs/web/ui-primitives/src/lib/*                                  cn, Button, Badge, Card, Dialog, Screen, CopyField, Spinner
libs/web/data-access-api/src/lib/*                                client, errors, auth, react (ApiProvider/useOrpc), query-client
libs/web/data-access-api/src/testing/*                            fakeApi, orpcError, renderWithApi
libs/web/data-access-collab/src/lib/*                             conn-state, collab-session, presence, react hooks
libs/web/data-access-collab/src/testing/*                         createFakeCollabSession
libs/web/ui-session-panels/src/lib/*                              Markdown, panels, TimerBar, ParticipantList, ConnectionBanner, PanelBoundary, NotesEditor
libs/web/feature-dashboard/src/lib/*                              RequireInterviewer, InterviewerLayout, AppHeader, DashboardPage, CreateSessionDialog
libs/web/feature-template-editor/src/lib/*                        TemplateEditorPage, MarkdownField
libs/web/feature-session-room/src/lib/*                           SessionRoomPage, screens, session-state, SessionControls, LiveRoom, ExportMenu
README.md
```

---

### Task 1: Shared presence helpers and board element validation

**Files:**
- Create: `libs/shared/collab-protocol/src/lib/presence.ts`, `presence.spec.ts`, `board-validation.ts`, `board-validation.spec.ts`
- Modify: `libs/shared/collab-protocol/src/index.ts`

**Interfaces:**
- Consumes: `awarenessUserSchema`, `AWARENESS_USER_FIELD`, `AwarenessUser` (`awareness.ts`), `SyncedElement` (`documents.ts`), `ParticipantRole` (`@swint/shared-domain`)
- Produces:
  - `PRESENCE_COLORS: readonly string[]`
  - `colorForUser(userId: string): string`
  - `candidateUserId(sessionId: string): string`
  - `interface PresenceIdentity { userId: string; name: string; role: ParticipantRole }`
  - `stampAwarenessState(state: Record<string, unknown>, who: PresenceIdentity): Record<string, unknown>`
  - `readAwarenessUser(state: Record<string, unknown> | undefined): AwarenessUser | null`
  - `BOARD_ELEMENT_TYPES`, `boardElementSchema`, `isValidBoardElement(value: unknown): value is SyncedElement`

- [ ] **Step 1: Write the failing tests**

`libs/shared/collab-protocol/src/lib/presence.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AWARENESS_USER_FIELD, awarenessUserSchema } from './awareness.js';
import { PRESENCE_COLORS, candidateUserId, colorForUser, readAwarenessUser, stampAwarenessState } from './presence.js';

const who = { userId: 'sub-1', name: 'Ada', role: 'interviewer' as const };

describe('colorForUser', () => {
  it('is deterministic and picks from the palette', () => {
    expect(colorForUser('sub-1')).toBe(colorForUser('sub-1'));
    expect(PRESENCE_COLORS).toContain(colorForUser('sub-1'));
    expect(PRESENCE_COLORS).toContain(colorForUser(''));
  });
  it('spreads different users over several colours', () => {
    const colors = new Set(Array.from({ length: 50 }, (_, i) => colorForUser(`user-${i}`)));
    expect(colors.size).toBeGreaterThan(3);
  });
});

describe('candidateUserId', () => {
  it('namespaces the session id', () => {
    expect(candidateUserId('s1')).toBe('candidate:s1');
  });
});

describe('stampAwarenessState', () => {
  it('overwrites identity fields claimed by the client', () => {
    const state = { [AWARENESS_USER_FIELD]: { userId: 'evil', name: 'Mallory', role: 'interviewer', color: '#000000', selectedElementIds: {} } };
    const out = stampAwarenessState(state, { userId: 'candidate:s1', name: 'Bo', role: 'candidate' });
    expect(out[AWARENESS_USER_FIELD]).toEqual({
      userId: 'candidate:s1',
      name: 'Bo',
      role: 'candidate',
      color: colorForUser('candidate:s1'),
      selectedElementIds: {},
    });
  });
  it('keeps a valid pointer and selection, drops invalid ones and unknown user keys', () => {
    const ok = stampAwarenessState(
      { [AWARENESS_USER_FIELD]: { pointer: { x: 1, y: 2, tool: 'laser' }, selectedElementIds: { a: true }, isAdmin: true } },
      who,
    );
    expect(ok[AWARENESS_USER_FIELD]).toMatchObject({ pointer: { x: 1, y: 2, tool: 'laser' }, selectedElementIds: { a: true } });
    expect(ok[AWARENESS_USER_FIELD]).not.toHaveProperty('isAdmin');
    const bad = stampAwarenessState({ [AWARENESS_USER_FIELD]: { pointer: { x: 'no' }, selectedElementIds: { a: 'yes' } } }, who);
    expect(bad[AWARENESS_USER_FIELD]).not.toHaveProperty('pointer');
    expect((bad[AWARENESS_USER_FIELD] as { selectedElementIds: object }).selectedElementIds).toEqual({});
  });
  it('drops oversized selections', () => {
    const huge = Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`e${i}`, true]));
    const out = stampAwarenessState({ [AWARENESS_USER_FIELD]: { selectedElementIds: huge } }, who);
    expect((out[AWARENESS_USER_FIELD] as { selectedElementIds: object }).selectedElementIds).toEqual({});
  });
  it('preserves other awareness fields (e.g. the TipTap cursor) and adds a user when none was sent', () => {
    const out = stampAwarenessState({ cursor: { anchor: 1 } }, who);
    expect(out['cursor']).toEqual({ anchor: 1 });
    expect(awarenessUserSchema.safeParse(out[AWARENESS_USER_FIELD]).success).toBe(true);
  });
  it('truncates long names and never produces an empty one', () => {
    const long = stampAwarenessState({}, { ...who, name: 'x'.repeat(150) });
    expect((long[AWARENESS_USER_FIELD] as { name: string }).name).toHaveLength(100);
    const empty = stampAwarenessState({}, { ...who, name: '' });
    expect((empty[AWARENESS_USER_FIELD] as { name: string }).name).toBe('Unknown');
  });
});

describe('readAwarenessUser', () => {
  it('returns the parsed user or null', () => {
    const stamped = stampAwarenessState({}, who);
    expect(readAwarenessUser(stamped)?.name).toBe('Ada');
    expect(readAwarenessUser({ [AWARENESS_USER_FIELD]: { name: 'x' } })).toBeNull();
    expect(readAwarenessUser(undefined)).toBeNull();
  });
});
```

`libs/shared/collab-protocol/src/lib/board-validation.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isValidBoardElement } from './board-validation.js';

const rect = {
  id: 'r1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, angle: 0,
  version: 1, versionNonce: 5, index: 'a0', isDeleted: false, groupIds: [], boundElements: null, strokeColor: '#000',
};

describe('isValidBoardElement', () => {
  it('accepts well-formed elements and keeps unknown fields', () => {
    expect(isValidBoardElement(rect)).toBe(true);
    expect(isValidBoardElement({ ...rect, type: 'arrow', points: [[0, 0], [5, 5]], boundElements: [{ id: 't', type: 'text' }] })).toBe(true);
    expect(isValidBoardElement({ ...rect, isDeleted: true, index: null })).toBe(true);
  });
  it.each([
    ['missing id', { ...rect, id: '' }],
    ['image (disabled in v1)', { ...rect, type: 'image' }],
    ['unknown type', { ...rect, type: 'iframe-of-doom' }],
    ['NaN coordinate', { ...rect, x: Number.NaN }],
    ['infinite size', { ...rect, width: Number.POSITIVE_INFINITY }],
    ['string version', { ...rect, version: '2' }],
    ['zero version', { ...rect, version: 0 }],
    ['bad points', { ...rect, type: 'line', points: [[0, 'a']] }],
    ['bad boundElements', { ...rect, boundElements: [{ id: 1 }] }],
    ['not an object', 'rectangle'],
    ['null', null],
  ])('rejects %s', (_label, value) => {
    expect(isValidBoardElement(value)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm nx test shared-collab-protocol`
Expected: FAIL, because `./presence.js` and `./board-validation.js` cannot be resolved.

- [ ] **Step 3: Implement**

`libs/shared/collab-protocol/src/lib/presence.ts`:

```ts
import type { ParticipantRole } from '@swint/shared-domain';
import { AWARENESS_USER_FIELD, awarenessUserSchema, type AwarenessUser } from './awareness.js';

/** Cursor colours that read well on a white canvas. */
export const PRESENCE_COLORS: readonly string[] = [
  '#e03131', '#2f9e44', '#1971c2', '#f08c00', '#9c36b5', '#0c8599', '#e8590c', '#5c940d',
];

const MAX_SELECTED = 1000;

/** Stable colour per user (FNV-1a hash over the id). */
export function colorForUser(userId: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return PRESENCE_COLORS[hash % PRESENCE_COLORS.length] as string;
}

export function candidateUserId(sessionId: string): string {
  return `candidate:${sessionId}`;
}

export interface PresenceIdentity {
  userId: string;
  name: string;
  role: ParticipantRole;
}

const pointerSchema = awarenessUserSchema.shape.pointer;
const selectionSchema = awarenessUserSchema.shape.selectedElementIds;

/**
 * Rewrites the awareness `user` field so identity comes from the server, not the client.
 * Keeps a valid pointer and selection, drops every other client-claimed user key, and leaves
 * other top-level fields (e.g. TipTap's `cursor`) untouched.
 */
export function stampAwarenessState(state: Record<string, unknown>, who: PresenceIdentity): Record<string, unknown> {
  const raw = state[AWARENESS_USER_FIELD];
  const claimed = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const pointer = pointerSchema.safeParse(claimed['pointer']);
  const selection = selectionSchema.safeParse(claimed['selectedElementIds']);
  const selectedElementIds =
    selection.success && Object.keys(selection.data).length <= MAX_SELECTED ? selection.data : {};
  const user: AwarenessUser = {
    userId: who.userId,
    name: who.name.slice(0, 100) || 'Unknown',
    role: who.role,
    color: colorForUser(who.userId),
    selectedElementIds,
    ...(pointer.success && pointer.data ? { pointer: pointer.data } : {}),
  };
  return { ...state, [AWARENESS_USER_FIELD]: user };
}

export function readAwarenessUser(state: Record<string, unknown> | undefined): AwarenessUser | null {
  const parsed = awarenessUserSchema.safeParse(state?.[AWARENESS_USER_FIELD]);
  return parsed.success ? parsed.data : null;
}
```

`libs/shared/collab-protocol/src/lib/board-validation.ts`:

```ts
import { z } from 'zod';
import type { SyncedElement } from './documents.js';

/** Element types allowed on the board. Images are disabled in v1 (spec §7.2). */
export const BOARD_ELEMENT_TYPES = ['rectangle', 'diamond', 'ellipse', 'arrow', 'line', 'freedraw', 'text', 'frame'] as const;

const point = z.tuple([z.number(), z.number()]);

/**
 * Minimal structural check on a board element before it reaches Excalidraw. Candidates can write
 * to the board, so a malformed value must never crash interviewer clients. Unknown fields pass through.
 */
export const boardElementSchema = z.looseObject({
  id: z.string().min(1).max(128),
  type: z.enum(BOARD_ELEMENT_TYPES),
  version: z.number().int().min(1),
  versionNonce: z.number().int(),
  index: z.string().max(256).nullable(),
  isDeleted: z.boolean(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  angle: z.number().optional(),
  points: z.array(point).max(20_000).optional(),
  text: z.string().max(50_000).optional(),
  groupIds: z.array(z.string()).max(100).optional(),
  boundElements: z
    .array(z.object({ id: z.string(), type: z.enum(['arrow', 'text']) }))
    .max(1000)
    .nullable()
    .optional(),
});

export function isValidBoardElement(value: unknown): value is SyncedElement {
  return boardElementSchema.safeParse(value).success;
}
```

Append to `libs/shared/collab-protocol/src/index.ts`:

```ts
export * from './lib/presence.js';
export * from './lib/board-validation.js';
```

Zod 4's `z.number()` already rejects `NaN` and `±Infinity`. If the infinite-size test fails, add `.refine(Number.isFinite)` to the four geometry fields.

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `pnpm nx run-many -t test lint typecheck -p shared-collab-protocol`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/shared/collab-protocol/src/lib/presence.ts libs/shared/collab-protocol/src/lib/presence.spec.ts \
  libs/shared/collab-protocol/src/lib/board-validation.ts libs/shared/collab-protocol/src/lib/board-validation.spec.ts \
  libs/shared/collab-protocol/src/index.ts
git commit -m "feat(collab-protocol): presence stamping helpers and board element validation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: BoardSync hardening and `web-ui-whiteboard` lib hygiene

**Files:**
- Modify: `libs/web/ui-whiteboard/src/lib/binding/board-sync.ts`, `board-sync.spec.ts`
- Modify: `libs/web/ui-whiteboard/package.json` (`"type": "module"`), `libs/web/ui-whiteboard/eslint.config.mjs` (dependency-checks)
- Create: `libs/web/ui-whiteboard/README.md` section "Dependency checks" (only if a workaround is needed, see Step 6)

**Interfaces:**
- Consumes: `isValidBoardElement` (Task 1)
- Produces: the same `BoardSync` API, with these behaviours:
  - `pushLocal` ignores invalid elements and is a no-op after `destroy()`
  - remote invalid values are ignored, and healed when we hold a valid revision
  - values are deep-copied (`structuredClone`) both ways

- [ ] **Step 1: Update the test helper and write failing tests**

In `board-sync.spec.ts`, every element must now be a valid board element. Change the `el` helper to:

```ts
const el = (
  id: string,
  version: number,
  versionNonce: number,
  extra: Partial<SyncedElement> = {},
): SyncedElement => ({
  id, type: 'rectangle', version, versionNonce, index: 'a0', isDeleted: false, x: 0, y: 0, width: 10, height: 10, ...extra,
});
```

Find the existing test about not exposing internal state (search for `does not expose`). Replace its assertions so they check the **receiver's** Y.Map, not just `getElements()`:

```ts
  it('does not expose internal state: mutating delivered elements changes neither BoardSync nor the receiver Y.Map', () => {
    const { b, flush, syncA, syncB, onB } = setup();
    syncA.pushLocal([el('r1', 1, 10, { x: 5 })]);
    flush();
    const delivered = onB.mock.calls[0][0] as SyncedElement[];
    delivered[0]['x'] = 999;
    syncB.getElements()[0]['x'] = 777;
    expect(getBoardElements(b).get('r1')?.['x']).toBe(5);
    expect(syncB.getElements()[0]['x']).toBe(5);
  });
```

Add these tests:

```ts
  it('deep-copies pushed elements: in-place nested mutation (points, boundElements) does not leak', () => {
    const { a, b, flush, syncA, syncB } = setup();
    const arrow = el('r1', 1, 10, {
      type: 'arrow',
      points: [[0, 0], [10, 10]],
      boundElements: [{ id: 't1', type: 'text' }],
    });
    syncA.pushLocal([arrow]);
    // Excalidraw mutates elements in place
    (arrow['points'] as number[][])[1][0] = 99;
    (arrow['boundElements'] as unknown[]).push({ id: 't2', type: 'text' });
    flush();
    expect(getBoardElements(a).get('r1')?.['points']).toEqual([[0, 0], [10, 10]]);
    expect(syncA.getElements()[0]['boundElements']).toEqual([{ id: 't1', type: 'text' }]);
    expect(getBoardElements(b).get('r1')?.['points']).toEqual([[0, 0], [10, 10]]);
    expect(syncB.getElements()[0]['points']).toEqual([[0, 0], [10, 10]]);
  });

  it('ignores invalid local elements', () => {
    const { a, syncA } = setup();
    syncA.pushLocal([el('img', 1, 1, { type: 'image' }), el('r1', 1, 1)]);
    expect([...getBoardElements(a).keys()]).toEqual(['r1']);
  });

  it('ignores an invalid remote value for a new key', () => {
    const { b, flush, syncA, onA } = setup();
    getBoardElements(b).set('bad', { id: 'bad' } as unknown as SyncedElement);
    flush();
    expect(onA).not.toHaveBeenCalled();
    expect(syncA.getElements()).toEqual([]);
  });

  it('heals an invalid remote overwrite of a known element', () => {
    const { a, b, flush, syncA, syncB, onA } = setup();
    syncA.pushLocal([el('r1', 1, 10, { x: 5 })]);
    flush();
    getBoardElements(b).set('r1', el('r1', 99, 1, { type: 'image' }));
    flush();
    expect(onA).not.toHaveBeenCalled();
    expect(getBoardElements(a).get('r1')?.version).toBe(1);
    expect(getBoardElements(b).get('r1')?.version).toBe(1);
    expect(snapshot(syncB)).toEqual([['r1', 1, 10, 5, false]]);
  });

  it('after destroy, pushLocal writes nothing and remote changes are not delivered', () => {
    const { a, flush, syncA, syncB, onA } = setup();
    syncA.destroy();
    syncA.pushLocal([el('r1', 1, 1)]);
    expect(getBoardElements(a).size).toBe(0);
    syncB.pushLocal([el('r2', 1, 1)]);
    flush();
    expect(onA).not.toHaveBeenCalled();
    syncA.destroy(); // idempotent
  });
```

Note: the "heals" test replaces `syncB`'s known `r1` (v1) with an invalid v99. `syncB` itself wrote that value directly to its own map, not through `pushLocal`, so `syncB`'s observer sees a local transaction with origin `null`, not `syncB`. That makes `syncB` heal it too. That is intended: an invalid value is never accepted by any peer.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm nx test web-ui-whiteboard`
Expected: the new tests FAIL (nested mutation leaks, image written, invalid accepted, destroy not guarded). Older tests still pass with the new `el` helper.

- [ ] **Step 3: Implement**

Replace `libs/web/ui-whiteboard/src/lib/binding/board-sync.ts` with:

```ts
import type * as Y from 'yjs';
import { getBoardElements, isValidBoardElement, type SyncedElement } from '@swint/shared-collab-protocol';
import { isSameRevision, shouldReplace, sortByIndex } from './element-order.js';

export interface BoardSyncOptions {
  doc: Y.Doc;
  /**
   * Called with the full ordered element list whenever remote changes were accepted.
   * Invoked synchronously inside the Yjs observer; callers may call `pushLocal` from it
   * (Yjs queues the nested transaction). The passed elements are deep copies.
   */
  onRemoteChange: (elements: SyncedElement[]) => void;
}

/** Deep copy: Excalidraw mutates elements (and nested arrays like `points`) in place. */
const copy = (element: SyncedElement): SyncedElement => structuredClone(element);

export class BoardSync {
  private readonly doc: Y.Doc;
  private readonly elements: Y.Map<SyncedElement>;
  private readonly onRemoteChange: (elements: SyncedElement[]) => void;
  /** Best-known valid revision per element id (from local pushes and accepted remote changes). */
  private readonly known = new Map<string, SyncedElement>();
  private destroyed = false;

  constructor(options: BoardSyncOptions) {
    this.doc = options.doc;
    this.onRemoteChange = options.onRemoteChange;
    this.elements = getBoardElements(this.doc);
    this.elements.forEach((value, key) => {
      if (isValidBoardElement(value)) this.known.set(key, copy(value));
    });
    this.elements.observe(this.handleChange);
  }

  /** Push the current local scene. Only valid elements that are new or newer than what we know are written, in one transaction. */
  pushLocal(sceneElements: readonly SyncedElement[]): void {
    if (this.destroyed) return;
    const changed: SyncedElement[] = [];
    for (const element of sceneElements) {
      if (!isValidBoardElement(element)) continue;
      if (shouldReplace(this.known.get(element.id), element)) {
        const snap = copy(element);
        changed.push(snap);
        this.known.set(snap.id, snap);
      }
    }
    if (changed.length === 0) return;
    this.doc.transact(() => {
      for (const element of changed) this.elements.set(element.id, copy(element));
    }, this);
  }

  /** Current ordered elements (including isDeleted tombstones), as deep copies. */
  getElements(): SyncedElement[] {
    return sortByIndex(this.known.values()).map(copy);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.elements.unobserve(this.handleChange);
  }

  private readonly handleChange = (event: Y.YMapEvent<SyncedElement>, transaction: Y.Transaction): void => {
    if (this.destroyed || transaction.origin === this) return;

    let accepted = false;
    const reassert: SyncedElement[] = [];

    for (const key of event.keysChanged) {
      const incoming = this.elements.get(key);
      if (incoming === undefined) continue; // keys are never deleted; tombstones use isDeleted
      const local = this.known.get(key);
      if (!isValidBoardElement(incoming)) {
        // Never accept a malformed value; restore ours if we have one so every peer converges.
        if (local) reassert.push(local);
        continue;
      }
      if (isSameRevision(local, incoming)) continue;
      if (shouldReplace(local, incoming)) {
        this.known.set(key, copy(incoming));
        accepted = true;
      } else if (local) {
        // Yjs kept a revision our rule says should lose: write ours back so every peer converges.
        reassert.push(local);
      }
    }

    if (reassert.length > 0) {
      this.doc.transact(() => {
        for (const element of reassert) this.elements.set(element.id, copy(element));
      }, this);
    }
    if (accepted) this.onRemoteChange(this.getElements());
  };
}
```

If `element-order.ts` exports differ from `isSameRevision`, `shouldReplace` and `sortByIndex`, keep its real names. Don't change `element-order.ts`.

- [ ] **Step 4: Run tests**

Run: `pnpm nx test web-ui-whiteboard`
Expected: PASS, both the new tests and all existing convergence tests.

- [ ] **Step 5: Lib hygiene**

1. In `libs/web/ui-whiteboard/package.json`, add `"type": "module"` after `"private": true`.
2. Make sure `src/test-setup.ts` exists with `import '@testing-library/jest-dom/vitest';`. Add `setupFiles: ['./src/test-setup.ts']` to the test block in `vite.config.mts`, and exclude `src/test-setup.ts` in `tsconfig.lib.json`. Install the matchers first: `pnpm add -Dw @testing-library/jest-dom @testing-library/user-event`.
3. In `libs/web/ui-whiteboard/eslint.config.mjs`, append a JSON block like the one in `libs/api/collab-server/eslint.config.mjs`:

```js
    {
        files: ["**/*.json"],
        rules: {
            "@nx/dependency-checks": [
                "error",
                {
                    ignoredFiles: [
                        "{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}",
                        "{projectRoot}/vite.config.{js,ts,mjs,mts}",
                        "{projectRoot}/src/test-setup.ts",
                        "{projectRoot}/src/testing/**",
                        "{projectRoot}/src/**/test-peers.ts"
                    ]
                }
            ]
        },
        languageOptions: { parser: await import("jsonc-eslint-parser") }
    },
```

- [ ] **Step 6: Prove the dependency rule actually runs**

This lib has no `build` target. `@nx/dependency-checks` reads a build target's inputs by default and may silently do nothing without one.

1. Temporarily remove `"yjs"` from `libs/web/ui-whiteboard/package.json` and run `pnpm nx lint web-ui-whiteboard --skip-nx-cache`.
   - If lint now FAILS with a missing-dependency error, the rule works. Restore `yjs`.
2. If lint still passes, set the rule option `buildTargets: ["typecheck"]` and repeat step 1.
   - Spec files are typecheck inputs. If that makes spec-only imports (vitest, `@testing-library/*`) show up as missing, add `checkMissingDependencies` exclusions via `ignoredDependencies: ["vitest", "@testing-library/react", "@testing-library/jest-dom", "@testing-library/user-event"]`.
3. If neither works, record the limitation in `libs/web/ui-whiteboard/README.md` under "Dependency checks", keep the block, and move on.

**Every later web lib copies whichever variant worked here.** Write the final variant into the task report.

- [ ] **Step 7: Verify and commit**

Run: `pnpm install && pnpm nx sync && pnpm nx run-many -t test lint typecheck -p web-ui-whiteboard`
Expected: PASS.

```bash
git add libs/web/ui-whiteboard package.json pnpm-lock.yaml
git commit -m "fix(web-ui-whiteboard): deep-copy, validate and guard BoardSync; dependency checks; ESM package

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(`git add libs/web/ui-whiteboard` stages only that lib's tracked and new files. Check `git status` first, and make sure nothing under `out-tsc/` or `test-output/` is staged.)

---

### Task 3: Server-stamped awareness in the collab server

**Files:**
- Create: `libs/api/collab-server/src/lib/presence.ts`
- Modify: `libs/api/collab-server/src/lib/collab-server.ts` (add the `beforeHandleAwareness` hook)
- Modify: `libs/api/collab-server/src/lib/collab-server.spec.ts` (new `describe('presence')`)

**Interfaces:**
- Consumes:
  - `stampAwarenessState`, `candidateUserId`, `colorForUser`, `AWARENESS_USER_FIELD`, `PresenceIdentity` (Task 1)
  - `Identity` (`@swint/api-util-rpc`), `CollabContext` (`./types.js`)
- Produces: `presenceIdentity(identity: Identity): PresenceIdentity`. The hook rewrites every inbound awareness state from a connection.

**Verified API** (`@hocuspocus/server@4.8.0` `dist/index.d.ts`): `beforeHandleAwareness?(data: { context: Context | undefined; states: Map<number, Record<string, any>>; removedClients: Set<number>; connection?: Connection; ... }): Promise<any>`. You mutate `states` in place, and peers receive the result.

- [ ] **Step 1: Write the failing test**

Add to `collab-server.spec.ts` (reuse its `setup`, `ada`, `bo` and `kit`):

```ts
import { AWARENESS_USER_FIELD, candidateUserId, colorForUser } from '@swint/shared-collab-protocol';

async function until(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('collab server: presence', () => {
  it('stamps awareness with the connection identity, so names and roles cannot be spoofed', async () => {
    const s = await setup('live');
    const interviewer = connectClient(kit, docName.board(s.id), 'ada');
    const candidate = connectClient(kit, docName.board(s.id), 'bo');
    await Promise.all([interviewer.synced, candidate.synced]);

    candidate.provider.awareness?.setLocalStateField(AWARENESS_USER_FIELD, {
      userId: 'sub-1', name: 'Mallory', role: 'interviewer', color: '#000000',
      selectedElementIds: {}, pointer: { x: 3, y: 4, tool: 'pointer' },
    });
    const candidateClientId = candidate.provider.awareness?.clientID as number;

    const seen = () => interviewer.provider.awareness?.getStates().get(candidateClientId)?.[AWARENESS_USER_FIELD];
    await until(() => seen() !== undefined);
    expect(seen()).toEqual({
      userId: candidateUserId(s.id),
      name: 'Bo',
      role: 'candidate',
      color: colorForUser(candidateUserId(s.id)),
      selectedElementIds: {},
      pointer: { x: 3, y: 4, tool: 'pointer' },
    });

    interviewer.provider.awareness?.setLocalStateField(AWARENESS_USER_FIELD, { name: 'Someone else' });
    const interviewerClientId = interviewer.provider.awareness?.clientID as number;
    const seenByCandidate = () =>
      candidate.provider.awareness?.getStates().get(interviewerClientId)?.[AWARENESS_USER_FIELD] as { name?: string; role?: string } | undefined;
    await until(() => seenByCandidate()?.name === 'Ada');
    expect(seenByCandidate()).toMatchObject({ userId: 'sub-1', name: 'Ada', role: 'interviewer' });

    interviewer.destroy();
    candidate.destroy();
  });
});
```

If `TestClient` doesn't expose `provider` with `awareness` the way this test expects, use the kit's real field names. Don't change the kit's interface.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx test api-collab-server -- -t presence`
Expected: FAIL, because the interviewer sees `name: 'Mallory'`.

- [ ] **Step 3: Implement**

`libs/api/collab-server/src/lib/presence.ts`:

```ts
import { candidateUserId, type PresenceIdentity } from '@swint/shared-collab-protocol';
import type { Identity } from '@swint/api-util-rpc';

export function presenceIdentity(identity: Identity): PresenceIdentity {
  return identity.kind === 'interviewer'
    ? { userId: identity.sub, name: identity.name, role: 'interviewer' }
    : { userId: candidateUserId(identity.sessionId), name: identity.name, role: 'candidate' };
}
```

Add this hook to the Hocuspocus configuration object in `collab-server.ts`, next to `onStateless`. Import `stampAwarenessState` from `@swint/shared-collab-protocol` and `presenceIdentity` from `./presence.js`:

```ts
    async beforeHandleAwareness({ context, states }) {
      // Presence identity comes from the authenticated connection, never from the client (spec §7.3).
      const identity = (context as CollabContext | undefined)?.identity;
      if (!identity) return;
      const who = presenceIdentity(identity);
      for (const [clientId, state] of states) states.set(clientId, stampAwarenessState(state, who));
    },
```

- [ ] **Step 4: Run tests**

Run: `pnpm nx run-many -t test lint typecheck -p api-collab-server`
Expected: PASS, including the existing auth, sync and session-event suites.

- [ ] **Step 5: Commit**

```bash
git add libs/api/collab-server/src/lib/presence.ts libs/api/collab-server/src/lib/collab-server.ts libs/api/collab-server/src/lib/collab-server.spec.ts
git commit -m "feat(api-collab-server): stamp awareness with the connection identity

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: API dev experience: watch-mode `serve` and the dev seed template

**Files:**
- Create: `apps/api/src/app/dev-seed.ts`, `apps/api/src/app/dev-seed.spec.ts`
- Modify: `apps/api/src/app/config.ts` (+ `config.spec.ts`), `apps/api/src/app/create-app.ts`, `apps/api/package.json` (targets)

**Interfaces:**
- Consumes:
  - `TemplatesRepo`, `BlobStore`, `blobKeys` (`@swint/api-data-access-persistence`)
  - `Clock`, `IdGenerator`, `ulidIds` (`@swint/api-util-rpc`)
  - `isValidBoardElement` (Task 1, used only in the spec)
- Produces:
  - `DEV_SEED_TITLE = 'Design a URL shortener'`
  - `seedDevData(deps: DevSeedDeps): Promise<'created' | 'exists'>`
  - `devSeedElements(): Record<string, unknown>[]`
  - `AppConfig.seedDevData: boolean`

- [ ] **Step 1: Write the failing tests**

`apps/api/src/app/dev-seed.spec.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { createTestStores, type TestStores } from '@swint/api-data-access-persistence/testing';
import { isValidBoardElement } from '@swint/shared-collab-protocol';
import { DEV_SEED_TITLE, devSeedElements, seedDevData } from './dev-seed.js';

let stores: TestStores | undefined;
afterEach(() => {
  stores?.raw.destroy();
  stores?.s3.destroy();
});

let n = 0;
const deps = (s: TestStores) => ({
  templates: s.templates,
  blobs: s.blobs,
  clock: { now: () => 1_700_000_000_000 },
  newId: () => `id-${++n}`,
  orgId: 'default',
});

describe('seedDevData', () => {
  it('creates the URL-shortener template once, with a starting board', async () => {
    stores = await createTestStores();
    await expect(seedDevData(deps(stores))).resolves.toBe('created');
    await expect(seedDevData(deps(stores))).resolves.toBe('exists');

    const all = await stores.templates.listByOrg('default', { includeArchived: true });
    const seeded = all.filter((t) => t.title === DEV_SEED_TITLE);
    expect(seeded).toHaveLength(1);
    expect(seeded[0]).toMatchObject({ durationMin: 45, archived: false, createdBy: 'system' });
    expect(seeded[0].instructionsMd).toContain('URL shortener');
    expect(seeded[0].rubricMd.length).toBeGreaterThan(0);
    const seed = await stores.blobs.getJson<{ elements: unknown[] }>(seeded[0].boardSeedKey as string);
    expect(seed?.elements.length).toBeGreaterThan(0);
  });

  it('counts an archived copy as existing', async () => {
    stores = await createTestStores();
    await seedDevData(deps(stores));
    const [t] = await stores.templates.listByOrg('default', { includeArchived: true });
    await stores.templates.update({ ...t, archived: true });
    await expect(seedDevData(deps(stores))).resolves.toBe('exists');
  });
});

describe('devSeedElements', () => {
  it('produces valid, uniquely identified board elements', () => {
    const elements = devSeedElements();
    expect(elements.every(isValidBoardElement)).toBe(true);
    expect(new Set(elements.map((e) => e['id'])).size).toBe(elements.length);
  });
});
```

If `TestStores` has no `getJson`/`listByOrg`/`update` with these exact signatures, use the real ones. The Task 4 reading list (`libs/api/data-access-persistence/src/lib/templates-repo.ts`, `blob-store.ts`) has them.

Add to `apps/api/src/app/config.spec.ts`:

```ts
  it('seeds dev data by default only in development', () => {
    expect(loadConfig({ NODE_ENV: 'development' }).seedDevData).toBe(true);
    expect(loadConfig({ NODE_ENV: 'test' }).seedDevData).toBe(false);
    expect(loadConfig({ NODE_ENV: 'development', SEED_DEV_DATA: 'false' }).seedDevData).toBe(false);
    expect(loadConfig({ NODE_ENV: 'test', SEED_DEV_DATA: 'true' }).seedDevData).toBe(true);
  });
```

Copy whatever `NODE_ENV: 'production'` setup the existing config tests use. Production-only tests need the required production variables.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm nx test api -- dev-seed config`
Expected: FAIL (`./dev-seed.js` missing; `seedDevData` undefined).

- [ ] **Step 3: Implement**

`apps/api/src/app/dev-seed.ts`:

```ts
import { blobKeys, type BlobStore, type TemplatesRepo } from '@swint/api-data-access-persistence';
import type { Clock, IdGenerator } from '@swint/api-util-rpc';

export const DEV_SEED_TITLE = 'Design a URL shortener';

const INSTRUCTIONS = `# Design a URL shortener

Design a service like bit.ly that turns long URLs into short links and redirects visitors.

## Requirements
- Create a short link for a long URL (optionally with a custom alias).
- Redirect a short link to its long URL with low latency.
- Links can expire.
- Track click counts per link.

## Scale
- 100M new links per month, 10:1 read/write ratio.

Use the board to sketch your architecture. Talk us through your trade-offs.`;

const RUBRIC = `- **Requirements**: clarifies functional and non-functional requirements, estimates scale.
- **API and data model**: clear endpoints; sensible key generation (hash vs counter vs pre-generated keys).
- **Read path**: caching, CDN, redirect status codes (301 vs 302).
- **Scaling**: partitioning, replication, hot keys.
- **Trade-offs**: consistency of counters, expiry clean-up, abuse prevention.`;

interface ElementSpec {
  id: string;
  type: 'rectangle' | 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  index: string;
  seed: number;
  extra?: Record<string, unknown>;
}

function element(s: ElementSpec): Record<string, unknown> {
  return {
    id: s.id,
    type: s.type,
    x: s.x,
    y: s.y,
    width: s.width,
    height: s.height,
    angle: 0,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: s.index,
    roundness: s.type === 'rectangle' ? { type: 3 } : null,
    seed: s.seed,
    version: 1,
    versionNonce: s.seed + 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    ...s.extra,
  };
}

function box(id: string, x: number, label: string, index: number): Record<string, unknown>[] {
  const text = {
    text: label,
    originalText: label,
    fontSize: 20,
    fontFamily: 5,
    textAlign: 'left',
    verticalAlign: 'top',
    containerId: null,
    autoResize: true,
    lineHeight: 1.25,
  };
  return [
    element({ id: `${id}-box`, type: 'rectangle', x, y: 100, width: 160, height: 80, index: `a${index * 2}`, seed: 1000 + index * 10 }),
    element({
      id: `${id}-label`, type: 'text', x: x + 20, y: 125, width: label.length * 11, height: 25,
      index: `a${index * 2 + 1}`, seed: 2000 + index * 10, extra: text,
    }),
  ];
}

/** A small starting board: Client → API → Database boxes with labels (complete Excalidraw 0.18 shapes). */
export function devSeedElements(): Record<string, unknown>[] {
  return [...box('client', 40, 'Client', 0), ...box('api', 280, 'API', 1), ...box('db', 520, 'Database', 2)];
}

export interface DevSeedDeps {
  templates: TemplatesRepo;
  blobs: BlobStore;
  clock: Clock;
  newId: IdGenerator;
  orgId: string;
}

/** Spec §10: in dev, ensure the "Design a URL shortener" template exists. Archived copies count. */
export async function seedDevData(deps: DevSeedDeps): Promise<'created' | 'exists'> {
  const existing = await deps.templates.listByOrg(deps.orgId, { includeArchived: true });
  if (existing.some((t) => t.title === DEV_SEED_TITLE)) return 'exists';
  const id = deps.newId();
  const now = deps.clock.now();
  const boardSeedKey = blobKeys.templateSeed(deps.orgId, id, deps.newId());
  await deps.blobs.putJson(boardSeedKey, { elements: devSeedElements() });
  await deps.templates.create({
    id,
    orgId: deps.orgId,
    title: DEV_SEED_TITLE,
    instructionsMd: INSTRUCTIONS,
    rubricMd: RUBRIC,
    durationMin: 45,
    boardSeedKey,
    archived: false,
    createdBy: 'system',
    createdAt: now,
    updatedAt: now,
  });
  return 'created';
}
```

Element indices `a0`…`a5` sort correctly as fractional indices. Excalidraw 0.18 font family `5` is Excalifont.

`config.ts`:
- Add `SEED_DEV_DATA: z.stringbool().optional()` to `raw`.
- In the returned object add `seedDevData: env.SEED_DEV_DATA ?? env.NODE_ENV === 'development'`.

`create-app.ts`: right after `const clock = systemClock;` add:

```ts
  if (config.seedDevData) {
    await seedDevData({ templates: repos.templates, blobs: repos.blobs, clock, newId: ulidIds, orgId: config.defaultOrgId });
  }
```

Import it from `./dev-seed.js`.

- [ ] **Step 4: Run tests**

Run: `pnpm nx test api`
Expected: PASS, both the new tests and all existing integration tests (they run with `NODE_ENV: 'test'`, so no seeding).

- [ ] **Step 5: Watch-mode `serve`**

In `apps/api/package.json` → `nx.targets`, replace `serve` and add `serve-dist`:

```json
      "serve": {
        "continuous": true,
        "executor": "nx:run-commands",
        "options": {
          "command": "tsx watch --conditions=swint --clear-screen=false apps/api/src/main.ts"
        }
      },
      "serve-dist": {
        "continuous": true,
        "executor": "nx:run-commands",
        "dependsOn": ["build"],
        "options": {
          "command": "node apps/api/dist/main.js"
        }
      }
```

Verify it by hand. You need Docker Compose up; run `docker compose up -d` if `docker compose ps` shows it down.
1. Run `pnpm nx serve api` in the background, logging to a scratch file. If port 3000 is busy, prefix `PORT=3100`.
2. `curl -s localhost:3000/healthz` should return 200.
3. Check the logs for the seed. There's no log line yet, so add `server.log.info({ result }, 'dev seed')` after `seedDevData` in `create-app.ts`, where `server` exists, or capture the result and log it after `buildServer`.
4. `touch libs/api/feature-auth/src/lib/me-router.ts` and confirm in the log that the process restarts.
5. Stop the process you started.

**Fallbacks**, in order, if `tsx watch` doesn't honour `--conditions` (symptom: `Cannot find module …/dist/index.js`) or doesn't restart on lib edits:
1. `node --conditions=swint --import tsx --watch apps/api/src/main.ts`
2. `tsx watch --tsconfig apps/api/tsconfig.app.json …` plus `NODE_OPTIONS=--conditions=swint`

Record the command that works in the report.

- [ ] **Step 6: Update README and commit**

In `README.md`, under "Local development", change the serve line to `pnpm nx serve api   # API :3000 with watch mode; seeds the "Design a URL shortener" template in development`. Also mention `pnpm nx serve-dist api` for running the built output.

```bash
git add apps/api/src/app/dev-seed.ts apps/api/src/app/dev-seed.spec.ts apps/api/src/app/config.ts apps/api/src/app/config.spec.ts \
  apps/api/src/app/create-app.ts apps/api/package.json README.md
git commit -m "feat(api): watch-mode serve and the dev seed template

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 5: Scaffold `apps/web`, Tailwind, the dev proxy, and `web-ui-primitives`

**Files:**
- Generate: `apps/web` (React + Vite app), `libs/web/ui-primitives`
- Create: `apps/web/src/dev-proxy.ts` (+ `dev-proxy.spec.ts`), `apps/web/src/styles.css`, `apps/web/src/main.tsx`, `apps/web/src/app/app.tsx` (+ `app.spec.tsx`), `apps/web/src/test-setup.ts`
- Create: `libs/web/ui-primitives/src/lib/{cn.ts,button.tsx,badge.tsx,card.tsx,dialog.tsx,screen.tsx,copy-field.tsx,spinner.tsx}` + `primitives.spec.tsx`
- Modify: `apps/web/vite.config.mts`, root `package.json` (deps)

**Interfaces:**
- Produces (`@swint/web-ui-primitives`):
  - `cn(...classes)`
  - `Button` (`variant?: 'primary' | 'secondary' | 'danger' | 'ghost'`, `size?: 'sm' | 'md'`, plus native button props)
  - `Badge` (`tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger'`, plus span props)
  - `Card` (div props)
  - `Dialog` (`{ open; onOpenChange; title; description?; children }`)
  - `Screen` (`{ title; children?; actions? }`), a centred full-page message
  - `CopyField` (`{ label; value }`)
  - `Spinner` (`{ label?: string }`)
- Produces (`apps/web`): `devProxy(apiUrl: string): Record<string, ProxyOptions>`, `PROXIED_PATTERNS`, `AppRoutes()`, `App()`

- [ ] **Step 1: Generate**

```bash
pnpm nx g @nx/react:application --help
pnpm nx g @nx/react:application --directory=apps/web --name=web --bundler=vite --unitTestRunner=vitest --e2eTestRunner=none --linter=eslint --style=css --routing=false --tags=scope:web --no-interactive
pnpm nx g @nx/react:library --directory=libs/web/ui-primitives --name=web-ui-primitives --importPath=@swint/web-ui-primitives --bundler=none --unitTestRunner=vitest --linter=eslint --tags=scope:web,type:ui --component=false --no-interactive
pnpm add -w react-router@^7.18.5 @tanstack/react-query@^5.107.1 @radix-ui/react-dialog clsx tailwind-merge
pnpm add -Dw tailwindcss@^4.3.5 @tailwindcss/vite@^4.3.5
```

Fix the generator's output to match the conventions:
- Delete the generated sample component, its spec and any `nx-welcome` file.
- Normalise `libs/web/ui-primitives` to the Web library conventions (Global Constraints).
- `apps/web/package.json` stays `"private": true`, with `"type": "module"` and tag `scope:web`.

- [ ] **Step 2: Write the failing tests**

`apps/web/src/dev-proxy.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { devProxy } from './dev-proxy';

const matches = (proxy: Record<string, unknown>, path: string) => Object.keys(proxy).filter((k) => new RegExp(k).test(path));

describe('devProxy', () => {
  const proxy = devProxy('http://localhost:3000/');

  it('proxies API, auth, join and collab (WebSocket) to the API', () => {
    expect(Object.keys(proxy).sort()).toEqual(['^/api/', '^/auth/', '^/collab', '^/join/'].sort());
    expect(proxy['^/collab']).toEqual({ target: 'http://localhost:3000', ws: true });
    expect(proxy['^/api/']).toEqual({ target: 'http://localhost:3000' });
  });

  it.each(['/api/me', '/auth/login', '/auth/callback?code=x', '/join/tok', '/collab'])('proxies %s', (path) => {
    expect(matches(proxy, path)).toHaveLength(1);
  });

  it.each(['/link-invalid?reason=session_ended', '/s/abc', '/', '/templates/new', '/authors', '/joined'])('leaves %s to the SPA', (path) => {
    expect(matches(proxy, path)).toHaveLength(0);
  });
});
```

`libs/web/ui-primitives/src/lib/primitives.spec.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Badge, Button, CopyField, Dialog, Screen, cn } from '../index.js';

describe('ui-primitives', () => {
  it('cn merges and de-duplicates Tailwind classes', () => {
    expect(cn('px-2', false, 'px-4', undefined)).toBe('px-4');
  });

  it('Button applies variant classes and forwards props', async () => {
    const onClick = vi.fn();
    render(<Button variant="danger" onClick={onClick}>End</Button>);
    const button = screen.getByRole('button', { name: 'End' });
    expect(button.className).toContain('bg-red-600');
    expect(button).toHaveAttribute('type', 'button');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('Badge renders its tone', () => {
    render(<Badge tone="success">live</Badge>);
    expect(screen.getByText('live').className).toContain('bg-green-100');
  });

  it('Dialog renders title and content only when open', () => {
    const { rerender } = render(<Dialog open={false} onOpenChange={() => undefined} title="Cancel session">body</Dialog>);
    expect(screen.queryByText('body')).not.toBeInTheDocument();
    rerender(<Dialog open onOpenChange={() => undefined} title="Cancel session">body</Dialog>);
    expect(screen.getByRole('dialog', { name: 'Cancel session' })).toHaveTextContent('body');
  });

  it('Screen shows a heading and actions', () => {
    render(<Screen title="Interview ended" actions={<Button>Home</Button>}>Thanks</Screen>);
    expect(screen.getByRole('heading', { name: 'Interview ended' })).toBeInTheDocument();
    expect(screen.getByText('Thanks')).toBeInTheDocument();
  });

  it('CopyField copies its value', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<CopyField label="Candidate link" value="http://x/join/t" />);
    expect(screen.getByLabelText('Candidate link')).toHaveValue('http://x/join/t');
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('http://x/join/t');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });
});
```

`apps/web/src/app/app.spec.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from './app';

describe('AppRoutes', () => {
  it('renders the not-found page for unknown paths', () => {
    render(<MemoryRouter initialEntries={['/nope']}><AppRoutes /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm nx run-many -t test -p web web-ui-primitives`
Expected: FAIL (modules missing).

- [ ] **Step 4: Implement**

`apps/web/src/dev-proxy.ts`:

```ts
import type { ProxyOptions } from 'vite';

/** Paths the API serves. Everything else, including /link-invalid and /s/:id, is the SPA. */
export const PROXIED_PATTERNS = ['^/api/', '^/auth/', '^/join/', '^/collab'] as const;

/** Same-origin dev setup (spec §10): the browser only ever talks to the Vite origin. */
export function devProxy(apiUrl: string): Record<string, ProxyOptions> {
  const target = apiUrl.replace(/\/+$/, '');
  return {
    '^/api/': { target },
    '^/auth/': { target },
    '^/join/': { target },
    '^/collab': { target, ws: true },
  };
}
```

`apps/web/vite.config.mts`. Keep any generator lines not shown here only if they don't conflict:

```ts
/// <reference types='vitest' />
import { defineConfig, defaultClientConditions } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { devProxy } from './src/dev-proxy';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/web',
  plugins: [react(), tailwindcss()],
  resolve: { conditions: ['swint', ...defaultClientConditions] },
  server: {
    port: 4200,
    strictPort: true,
    host: 'localhost',
    proxy: devProxy(process.env.SWINT_API_URL ?? 'http://localhost:3000'),
  },
  preview: { port: 4300, host: 'localhost' },
  build: { outDir: './dist', emptyOutDir: true, reportCompressedSize: true },
  test: {
    name: 'web',
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
    reporters: ['default'],
  },
}));
```

If Vite 8 doesn't export `defaultClientConditions`, check `node_modules/vite/dist/node/index.d.ts` for the current name, which exists since Vite 6. Don't drop the default conditions.

`apps/web/src/styles.css`:

```css
@import 'tailwindcss';
/* Tailwind v4 only scans the app by default; the UI lives in the web libs. */
@source '../../../libs/web';

html, body, #root { height: 100%; }
body { @apply bg-slate-50 text-slate-900 antialiased; }
```

`apps/web/src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/app';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`apps/web/src/app/app.tsx` is the initial shell, and Task 14 wires the feature routes:

```tsx
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { Screen } from '@swint/web-ui-primitives';

export function NotFound() {
  return (
    <Screen title="Page not found" actions={<Link className="text-blue-700 underline" to="/">Go home</Link>}>
      The page you are looking for does not exist.
    </Screen>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
```

`apps/web/src/test-setup.ts`: `import '@testing-library/jest-dom/vitest';`. Also make sure `apps/web/index.html` has `<div id="root"></div>` and `<title>Swint</title>`.

`libs/web/ui-primitives/src/lib/cn.ts`:

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...classes: ClassValue[]): string {
  return twMerge(clsx(classes));
}
```

`button.tsx`:

```tsx
import type { ButtonHTMLAttributes } from 'react';
import { cn } from './cn.js';

const variants = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700',
  secondary: 'border border-slate-300 bg-white text-slate-900 hover:bg-slate-100',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  ghost: 'text-slate-700 hover:bg-slate-100',
} as const;
const sizes = { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4' } as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

export function Button({ variant = 'primary', size = 'md', className, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
```

`badge.tsx`:

```tsx
import type { HTMLAttributes } from 'react';
import { cn } from './cn.js';

const tones = {
  neutral: 'bg-slate-100 text-slate-700',
  info: 'bg-blue-100 text-blue-800',
  success: 'bg-green-100 text-green-800',
  warning: 'bg-amber-100 text-amber-800',
  danger: 'bg-red-100 text-red-800',
} as const;

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: keyof typeof tones;
}

export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return <span className={cn('inline-flex items-center rounded px-2 py-0.5 text-xs font-medium', tones[tone], className)} {...props} />;
}
```

`card.tsx`:

```tsx
import type { HTMLAttributes } from 'react';
import { cn } from './cn.js';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-slate-200 bg-white p-4 shadow-sm', className)} {...props} />;
}
```

`dialog.tsx`:

```tsx
import * as RadixDialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
}

export function Dialog({ open, onOpenChange, title, description, children }: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 bg-black/40" />
        <RadixDialog.Content className="fixed left-1/2 top-1/2 w-[min(32rem,90vw)] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl">
          <RadixDialog.Title className="text-lg font-semibold">{title}</RadixDialog.Title>
          {description ? (
            <RadixDialog.Description className="mt-1 text-sm text-slate-600">{description}</RadixDialog.Description>
          ) : (
            <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
          )}
          <div className="mt-4">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
```

`screen.tsx`:

```tsx
import type { ReactNode } from 'react';

export interface ScreenProps {
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}

/** Full-page centred message: loading, errors, ended, waiting room. */
export function Screen({ title, children, actions }: ScreenProps) {
  return (
    <main className="flex min-h-full items-center justify-center p-8">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {children ? <div className="mt-3 text-slate-600">{children}</div> : null}
        {actions ? <div className="mt-6 flex justify-center gap-3">{actions}</div> : null}
      </div>
    </main>
  );
}
```

`copy-field.tsx`:

```tsx
import { useId, useState } from 'react';
import { Button } from './button.js';

export function CopyField({ label, value }: { label: string; value: string }) {
  const id = useId();
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-slate-700">{label}</label>
      <div className="mt-1 flex gap-2">
        <input id={id} readOnly value={value} className="min-w-0 flex-1 rounded-md border border-slate-300 bg-slate-50 px-3 text-sm" onFocus={(e) => e.currentTarget.select()} />
        <Button
          variant="secondary"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}
```

`spinner.tsx`:

```tsx
export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-slate-600">
      <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
      {label}
    </span>
  );
}
```

`libs/web/ui-primitives/src/index.ts`:

```ts
export * from './lib/cn.js';
export * from './lib/button.js';
export * from './lib/badge.js';
export * from './lib/card.js';
export * from './lib/dialog.js';
export * from './lib/screen.js';
export * from './lib/copy-field.js';
export * from './lib/spinner.js';
```

- [ ] **Step 5: Verify**

Run: `pnpm install && pnpm nx sync && pnpm nx run-many -t test lint typecheck build -p web web-ui-primitives`
Expected: PASS, and `apps/web/dist/index.html` exists.

Then `pnpm nx serve web` (background), and `curl -s -o /dev/null -w '%{http_code}' localhost:4200/link-invalid` should print `200` (SPA fallback). Stop the server.

- [ ] **Step 6: Commit**

```bash
git add apps/web libs/web/ui-primitives package.json pnpm-lock.yaml tsconfig.json nx.json
git commit -m "feat(web): scaffold the web app (Vite, Tailwind, dev proxy) and ui-primitives

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Stage only files that exist and changed. Check `git status`, and never stage `apps/web/dist`, `out-tsc` or `test-output`.

---

### Task 6: `web-data-access-api`: typed client, errors, auth helpers, React bindings

**Files:**
- Generate: `libs/web/data-access-api` (tags `scope:web,type:data-access`)
- Create:
  - `src/lib/client.ts`, `errors.ts`, `auth.ts`, `query-client.ts`, `react.tsx`
  - `src/testing/{index.ts,fake-api.ts,render.tsx}` (exported as `@swint/web-data-access-api/testing`)
  - `src/lib/client.spec.ts`, `src/lib/auth.spec.ts`
- Modify: `apps/api/src/app/api.integration.spec.ts` (real-client test), `apps/api/package.json` (devDependencies)

**Interfaces:**
- Produces (`@swint/web-data-access-api`):
  - `type ApiClient = ContractRouterClient<typeof contract>`
  - `createApiClient(opts?: { baseUrl?: string; fetch?: typeof fetch }): ApiClient`
  - `interface ApiErrorInfo { code: string; reason?: string; message: string }`
  - `apiError(err: unknown): ApiErrorInfo | null`. Returns null for non-oRPC errors (e.g. network).
  - `loginUrl(returnTo: string): string`
  - `logout(fetchImpl?: typeof fetch): Promise<string>`, which returns the `redirectUrl`
  - `navigation: { assign(url: string): void }`, a mutable object so tests can spy on it
  - `createQueryClient(): QueryClient`, with no retries on 4xx oRPC errors
  - `ApiProvider({ client, children })`, `useApi(): ApiClient`, `useOrpc()` (TanStack Query utils from `createTanstackQueryUtils`)
- Produces (`@swint/web-data-access-api/testing`):
  - `fakeApi(impl: FakeApiImpl): ApiClient`. Any call that isn't stubbed throws `Error('unexpected api call: <path>')`.
  - `orpcError(code: string, data?: unknown): ORPCError`
  - `renderWithApi(ui, { api, path?, routePath? })`, which returns Testing Library's render result plus `queryClient`. It renders a `<div data-testid="location">` holding the current pathname+search.

- [ ] **Step 1: Generate and install**

```bash
pnpm nx g @nx/react:library --directory=libs/web/data-access-api --name=web-data-access-api --importPath=@swint/web-data-access-api --bundler=none --unitTestRunner=vitest --linter=eslint --tags=scope:web,type:data-access --component=false --no-interactive
pnpm add -w @orpc/client@^1.16.2 @orpc/openapi-client@^1.16.2 @orpc/tanstack-query@^1.16.2 @orpc/contract@^1.16.2
```

Normalise to the Web library conventions, using the dependency-checks variant from Task 2. Add the `./testing` export (`"./testing": { "types": "./src/testing/index.ts", "import": "./src/testing/index.ts", "default": "./src/testing/index.ts" }`), and exclude `src/testing/**` from `tsconfig.lib.json`.

- [ ] **Step 2: Write the failing tests**

`libs/web/data-access-api/src/lib/client.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { ORPCError } from '@orpc/client';
import { apiError } from './errors.js';
import { createApiClient } from './client.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function clientWith(response: Response) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response);
  return { client: createApiClient({ baseUrl: 'http://app.test/api', fetch: fetchMock as typeof fetch }), fetchMock };
}

const requestOf = async (fetchMock: ReturnType<typeof vi.fn>) => {
  const [input, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit | undefined];
  const req = input instanceof Request ? input : new Request(input, init);
  return { req, init, body: await req.clone().text() };
};

describe('createApiClient', () => {
  it('maps procedures to REST routes and sends cookies', async () => {
    const session = { id: 's1' };
    const { client, fetchMock } = clientWith(json(200, session));
    await client.sessions.get({ id: 's1' }).catch(() => undefined); // output validation is the server's job; we only check the request
    const { req, init } = await requestOf(fetchMock);
    expect(req.method).toBe('GET');
    expect(new URL(req.url).pathname).toBe('/api/sessions/s1');
    expect(init?.credentials ?? req.credentials).toBe('same-origin');
  });

  it.each([
    ['sessions.start', (c: ReturnType<typeof createApiClient>) => c.sessions.start({ id: 's1' })],
    ['sessions.end', (c: ReturnType<typeof createApiClient>) => c.sessions.end({ id: 's1' })],
    ['sessions.regenerateInvite', (c: ReturnType<typeof createApiClient>) => c.sessions.regenerateInvite({ id: 's1' })],
    ['templates.archive', (c: ReturnType<typeof createApiClient>) => c.templates.archive({ id: 't1' })],
  ])('%s never sends an empty body labelled application/json (the API answers 400)', async (_name, call) => {
    const { client, fetchMock } = clientWith(json(200, {}));
    await call(client).catch(() => undefined);
    const { req, body } = await requestOf(fetchMock);
    expect(req.method).toBe('POST');
    const isJson = (req.headers.get('content-type') ?? '').includes('application/json');
    expect(isJson && body.length === 0).toBe(false);
  });

  it('decodes typed errors including data.reason', async () => {
    const { client } = clientWith(
      json(403, { defined: false, code: 'FORBIDDEN', status: 403, message: 'Forbidden', data: { reason: 'session_ended' } }),
    );
    const err = await client.room.get({ sessionId: 's1' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ORPCError);
    expect(apiError(err)).toEqual({ code: 'FORBIDDEN', reason: 'session_ended', message: 'Forbidden' });
  });
});

describe('apiError', () => {
  it('returns null for non-oRPC errors and omits a non-string reason', () => {
    expect(apiError(new TypeError('Failed to fetch'))).toBeNull();
    expect(apiError(undefined)).toBeNull();
    expect(apiError(new ORPCError('NOT_FOUND', { data: { reason: 42 } }))).toEqual({ code: 'NOT_FOUND', message: expect.any(String) });
  });
});
```

`libs/web/data-access-api/src/lib/auth.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { ORPCError } from '@orpc/client';
import { createQueryClient } from './query-client.js';
import { loginUrl, logout } from './auth.js';

describe('auth helpers', () => {
  it('builds the login URL with an encoded returnTo', () => {
    expect(loginUrl('/s/abc?x=1')).toBe('/auth/login?returnTo=%2Fs%2Fabc%3Fx%3D1');
  });

  it('logs out with a bodyless POST and returns the redirect URL', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ redirectUrl: 'http://kc/logout' }), { status: 200 }));
    await expect(logout(fetchMock as unknown as typeof fetch)).resolves.toBe('http://kc/logout');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/auth/logout');
    expect(init).toEqual({ method: 'POST', credentials: 'same-origin' });
  });

  it('falls back to / when logout fails', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 500 }));
    await expect(logout(fetchMock as unknown as typeof fetch)).resolves.toBe('/');
  });
});

describe('createQueryClient', () => {
  it('does not retry client errors but retries other failures twice', () => {
    const retry = createQueryClient().getDefaultOptions().queries?.retry as (n: number, e: unknown) => boolean;
    expect(retry(0, new ORPCError('UNAUTHORIZED'))).toBe(false);
    expect(retry(0, new ORPCError('NOT_FOUND'))).toBe(false);
    expect(retry(0, new TypeError('network'))).toBe(true);
    expect(retry(1, new ORPCError('INTERNAL_SERVER_ERROR'))).toBe(true);
    expect(retry(2, new TypeError('network'))).toBe(false);
  });
});
```

Add to `apps/api/src/app/api.integration.spec.ts`. It proves the real browser client works against the real server: bodyless POSTs, cookies and typed errors.

```ts
import { createORPCClient, ORPCError } from '@orpc/client';
import type { ContractRouterClient } from '@orpc/contract';
import { OpenAPILink } from '@orpc/openapi-client/fetch';
import { contract } from '@swint/shared-api-contract';

  it('works with the browser oRPC client (OpenAPILink): bodyless POSTs, cookies, typed errors', async () => {
    const app = await setup({ listen: true });
    const cookie = Object.entries(await app.interviewerCookie())
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('; ');
    const client: ContractRouterClient<typeof contract> = createORPCClient(
      new OpenAPILink(contract, { url: `http://127.0.0.1:${app.port}/api`, headers: { cookie } }),
    );
    const t = await client.templates.create(templateBody);
    const { session } = await client.sessions.create({ templateId: t.id, candidateName: 'Ada' });
    await expect(client.sessions.start({ id: session.id })).resolves.toMatchObject({ status: 'live' });
    await expect(client.sessions.extend({ id: session.id, minutes: 5 })).resolves.toMatchObject({ extensionSec: 300 });
    await expect(client.sessions.regenerateInvite({ id: session.id })).resolves.toHaveProperty('candidateUrl');
    await expect(client.sessions.end({ id: session.id })).resolves.toMatchObject({ status: 'ended' });
    await expect(client.templates.archive({ id: t.id })).resolves.toMatchObject({ archived: true });
    await expect(client.templates.list({ includeArchived: false })).resolves.toEqual([]);
    const err = await client.sessions.start({ id: session.id }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ORPCError);
    expect((err as ORPCError<string, unknown>).code).toBe('CONFLICT');
    await app.close();
  });
```

Add `@orpc/client`, `@orpc/openapi-client` and `@orpc/contract` (all `^1.16.2`) to `apps/api` `devDependencies`. Merge the imports with the file's existing ones.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm nx test web-data-access-api` and `pnpm nx test api -- api.integration`
Expected: the web lib FAILS (modules missing). The API test may already PASS: that is fine and still proves the contract. If it FAILS with a 400 or 415 on a bodyless POST, that's a real bug. Fix it in the web client's `fetch` wrapper (drop `content-type` when the body is empty), apply the same fix to the API test's link via a `fetch` option, and record it in the report.

- [ ] **Step 4: Implement**

`src/lib/client.ts`:

```ts
import { createORPCClient } from '@orpc/client';
import type { ContractRouterClient } from '@orpc/contract';
import { OpenAPILink } from '@orpc/openapi-client/fetch';
import { contract } from '@swint/shared-api-contract';

export type ApiClient = ContractRouterClient<typeof contract>;

export interface ApiClientOptions {
  /** Default: `${window.location.origin}/api` (same origin; the dev server proxies /api). */
  baseUrl?: string;
  fetch?: typeof fetch;
}

export function createApiClient(opts: ApiClientOptions = {}): ApiClient {
  const doFetch = opts.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  const link = new OpenAPILink(contract, {
    url: opts.baseUrl ?? `${window.location.origin}/api`,
    fetch: (request, init) => doFetch(request, { ...init, credentials: 'same-origin' }),
  });
  return createORPCClient(link);
}
```

Check `LinkFetchClientOptions['fetch']` in `node_modules/@orpc/client/dist/adapters/fetch/index.d.mts` for the exact parameter list, and keep the wrapper's types aligned.

`src/lib/errors.ts`:

```ts
import { ORPCError } from '@orpc/client';

export interface ApiErrorInfo {
  code: string;
  reason?: string;
  message: string;
}

/** Typed view of an oRPC error. Returns null for anything else (network failures, bugs). */
export function apiError(err: unknown): ApiErrorInfo | null {
  if (!(err instanceof ORPCError)) return null;
  const data = err.data as { reason?: unknown } | undefined;
  const reason = typeof data?.reason === 'string' ? data.reason : undefined;
  return { code: err.code, message: err.message, ...(reason ? { reason } : {}) };
}

const CLIENT_ERROR_CODES = new Set(['BAD_REQUEST', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT']);

export function isClientError(err: unknown): boolean {
  const info = apiError(err);
  return info !== null && CLIENT_ERROR_CODES.has(info.code);
}
```

`src/lib/auth.ts`:

```ts
/** Indirection so tests can observe full-page navigations. */
export const navigation = {
  assign(url: string): void {
    window.location.assign(url);
  },
};

export function loginUrl(returnTo: string): string {
  return `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}

/** POST /auth/logout with no body and no content-type (the API rejects empty JSON bodies). */
export async function logout(fetchImpl: typeof fetch = (i, init) => globalThis.fetch(i, init)): Promise<string> {
  try {
    const res = await fetchImpl('/auth/logout', { method: 'POST', credentials: 'same-origin' });
    if (!res.ok) return '/';
    const body = (await res.json()) as { redirectUrl?: unknown };
    return typeof body.redirectUrl === 'string' ? body.redirectUrl : '/';
  } catch {
    return '/';
  }
}
```

`src/lib/query-client.ts`:

```ts
import { QueryClient } from '@tanstack/react-query';
import { isClientError } from './errors.js';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: (count, err) => !isClientError(err) && count < 2, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}
```

`src/lib/react.tsx`:

```tsx
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import type { ApiClient } from './client.js';

const ApiContext = createContext<ApiClient | null>(null);

export function ApiProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiClient {
  const client = useContext(ApiContext);
  if (!client) throw new Error('useApi must be used inside <ApiProvider>');
  return client;
}

/** TanStack Query utils for the contract: `useQuery(orpc.me.get.queryOptions())`, `orpc.sessions.key()`. */
export function useOrpc() {
  const client = useApi();
  return useMemo(() => createTanstackQueryUtils(client), [client]);
}
```

`src/index.ts`:

```ts
export * from './lib/client.js';
export * from './lib/errors.js';
export * from './lib/auth.js';
export * from './lib/query-client.js';
export * from './lib/react.js';
```

`src/testing/fake-api.ts`:

```ts
import { ORPCError } from '@orpc/client';
import type { ApiClient } from '../lib/client.js';

type AnyFn = (...args: never[]) => unknown;
export type FakeApiImpl = { [G in keyof ApiClient]?: { [P in keyof ApiClient[G]]?: AnyFn } };

/** An ApiClient whose procedures come from `impl`. Unexpected calls throw, so tests fail loudly. */
export function fakeApi(impl: FakeApiImpl): ApiClient {
  return new Proxy({} as ApiClient, {
    get(_t, group: string) {
      return new Proxy(
        {},
        {
          get(_g, proc: string) {
            const fn = (impl as Record<string, Record<string, AnyFn> | undefined>)[group]?.[proc];
            return (
              fn ??
              (() => {
                throw new Error(`unexpected api call: ${group}.${proc}`);
              })
            );
          },
        },
      );
    },
  });
}

export function orpcError(code: string, data?: unknown): ORPCError<string, unknown> {
  return new ORPCError(code, data === undefined ? {} : { data });
}
```

`src/testing/render.tsx`:

```tsx
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { ApiProvider } from '../lib/react.js';
import type { ApiClient } from '../lib/client.js';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

export interface RenderWithApiOptions {
  api: ApiClient;
  /** Initial URL. Default '/'. */
  path?: string;
  /** Route pattern that renders `ui`, e.g. '/s/:sessionId'. Default '*'. */
  routePath?: string;
}

export function renderWithApi(ui: ReactElement, { api, path = '/', routePath = '*' }: RenderWithApiOptions) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={api}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={routePath} element={ui} />
            {routePath === '*' ? null : <Route path="*" element={null} />}
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </ApiProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}
```

`src/testing/index.ts`:

```ts
export * from './fake-api.js';
export * from './render.js';
```

**Ruling to check:** `createTanstackQueryUtils(client)` must work over a `fakeApi` proxy. Add one test to `client.spec.ts` that does `createTanstackQueryUtils(fakeApi({ me: { get: async () => ({ sub: 's' }) } })).me.get.queryOptions().queryFn!({} as never)` and expects `{ sub: 's' }`. If the utils need real procedure functions (e.g. they inspect `client.me.get.length`), adapt `fakeApi`, not the utils.

- [ ] **Step 5: Verify**

Run: `pnpm install && pnpm nx sync && pnpm nx run-many -t test lint typecheck -p web-data-access-api api`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libs/web/data-access-api apps/api/src/app/api.integration.spec.ts apps/api/package.json package.json pnpm-lock.yaml tsconfig.json
git commit -m "feat(web-data-access-api): typed oRPC client, error mapping, auth helpers and query bindings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `web-data-access-collab`: one socket per room and the real-time contract

**Files:**
- Generate: `libs/web/data-access-collab` (tags `scope:web,type:data-access`)
- Create:
  - `src/lib/conn-state.ts` (+ `conn-state.spec.ts`)
  - `src/lib/collab-session.ts` (+ `collab-session.spec.ts`, which runs in Node against a real Hocuspocus server)
  - `src/lib/presence.ts` (+ `presence.spec.ts`)
  - `src/lib/react.tsx`
  - `src/testing/{index.ts,fake-collab-session.ts}` (exported as `@swint/web-data-access-collab/testing`)

**Interfaces:**
- Consumes: `docName`, `parseServerMessage`, `isCloseReason`, `POLICY_CLOSE_CODE`, `CloseReason`, `SessionStateMessage`, `readAwarenessUser`, `AwarenessUser` (collab-protocol); `serverOffsetMs`, `ParticipantRole` (domain)
- Produces:
  - Connection state:
    - `type EndReason = 'session_ended' | 'invite_revoked'`
    - `type RejectReason = Exclude<CloseReason, 'unauthenticated'>`
    - `type CollabPhase = { kind: 'connecting' } | { kind: 'connected' } | { kind: 'reconnecting' } | { kind: 'unreachable' } | { kind: 'rejected'; reason: RejectReason } | { kind: 'closed'; reason: EndReason }`
    - `interface CollabConnState { phase: CollabPhase; failedOpens: number; openedThisAttempt: boolean; everConnected: boolean; readOnly: boolean }`
    - `initialConnState`, `isTerminal(phase)`, `reduceConn(state, event, failedOpensBeforeProbe)`
  - Session:
    - `interface CollabDoc { doc: Y.Doc; provider: HocuspocusProvider; awareness: Awareness }`
    - `interface SessionStateSnapshot { message: SessionStateMessage; offsetMs: number }`
    - `interface CollabSnapshot { conn: CollabConnState; sessionState: SessionStateSnapshot | null; notesError: string | null }`
    - `interface CollabSessionOptions { sessionId: string; role: ParticipantRole; url?: string; WebSocketPolyfill?: unknown; failedOpensBeforeProbe?: number; retry?: { delay: number; minDelay: number; maxDelay: number }; now?: () => number }`
    - `interface CollabSession { board: CollabDoc; notes: CollabDoc | null; getSnapshot(): CollabSnapshot; subscribe(listener: () => void): () => void; destroy(): void }`
    - `type CollabSessionFactory = (opts: CollabSessionOptions) => CollabSession`
    - `createCollabSession`, `defaultCollabUrl(loc?)`
  - Presence: `readParticipants(awareness): AwarenessUser[]`
  - React:
    - `CollabFactoryProvider({ factory, children })`
    - `useCollabSession(opts: CollabSessionOptions | null): { session: CollabSession | null; snapshot: CollabSnapshot | null }`
    - `usePresence(awareness: Awareness | null): AwarenessUser[]`
  - Testing: `createFakeCollabSession({ role }): { session: CollabSession; update(patch: Partial<CollabSnapshot>): void; factory: CollabSessionFactory }`

**Verified provider facts** (`@hocuspocus/provider@4.8.0`):
- `HocuspocusProviderWebsocket({ url, WebSocketPolyfill, delay, minDelay, maxDelay, onOpen, onClose })`; `onClose({ event })` gets a `CloseEvent` with `code`/`reason`.
- `HocuspocusProvider({ websocketProvider, name, document, token, onAuthenticated({ scope: 'read-write' | 'readonly' }), onAuthenticationFailed({ reason }), onStateless({ payload }) })`. Then call `provider.attach()` (needed with an external socket).
- A refused upgrade (HTTP 401) closes with 1006 and never fires `onOpen`.

- [ ] **Step 1: Generate and install**

```bash
pnpm nx g @nx/react:library --directory=libs/web/data-access-collab --name=web-data-access-collab --importPath=@swint/web-data-access-collab --bundler=none --unitTestRunner=vitest --linter=eslint --tags=scope:web,type:data-access --component=false --no-interactive
pnpm add -w y-protocols@^1.0.7
```

Normalise it, and add the `./testing` export as in Task 6. Runtime deps: `@hocuspocus/provider`, `yjs`, `y-protocols`, `react`, `@swint/shared-collab-protocol`, `@swint/shared-domain`. Dev-only (spec) imports: `@hocuspocus/server`, `ws`.

- [ ] **Step 2: Write the failing tests**

`src/lib/conn-state.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { initialConnState, isTerminal, reduceConn, type CollabConnState, type CollabEvent } from './conn-state.js';

const run = (events: CollabEvent[], n = 3): CollabConnState => events.reduce((s, e) => reduceConn(s, e, n), initialConnState);
const close = (code = 1006, reason = ''): CollabEvent => ({ type: 'close', code, reason });

describe('reduceConn', () => {
  it('connects after open + authenticated, recording read-only scope', () => {
    const s = run([{ type: 'open' }, { type: 'authenticated', readOnly: true }]);
    expect(s.phase).toEqual({ kind: 'connected' });
    expect(s.readOnly).toBe(true);
    expect(s.everConnected).toBe(true);
  });

  it('reconnects after a drop of an opened socket', () => {
    const s = run([{ type: 'open' }, { type: 'authenticated', readOnly: false }, close()]);
    expect(s.phase).toEqual({ kind: 'reconnecting' });
    expect(s.failedOpens).toBe(0);
  });

  it('becomes unreachable after N consecutive closes without an open (401 at upgrade)', () => {
    expect(run([close(), close()]).phase).toEqual({ kind: 'reconnecting' });
    expect(run([close(), close(), close()]).phase).toEqual({ kind: 'unreachable' });
  });

  it('an open resets the failed-open count', () => {
    const s = run([close(), close(), { type: 'open' }, close(), close()]);
    expect(s.phase).toEqual({ kind: 'reconnecting' });
  });

  it('recovers from unreachable when the socket opens and authenticates', () => {
    const s = run([close(), close(), close(), { type: 'open' }, { type: 'authenticated', readOnly: false }]);
    expect(s.phase).toEqual({ kind: 'connected' });
  });

  it.each(['forbidden', 'not_started', 'session_ended', 'invite_revoked'] as const)('authFailed %s is terminal', (reason) => {
    const s = run([{ type: 'open' }, { type: 'authFailed', reason }, { type: 'open' }, { type: 'authenticated', readOnly: false }]);
    expect(s.phase).toEqual({ kind: 'rejected', reason });
    expect(isTerminal(s.phase)).toBe(true);
  });

  it('maps unknown or unauthenticated auth failures to forbidden', () => {
    expect(run([{ type: 'authFailed', reason: 'weird' }]).phase).toEqual({ kind: 'rejected', reason: 'forbidden' });
    expect(run([{ type: 'authFailed', reason: 'unauthenticated' }]).phase).toEqual({ kind: 'rejected', reason: 'forbidden' });
  });

  it('4403 closes are terminal with their reason (session_ended by default)', () => {
    expect(run([{ type: 'open' }, close(4403, 'invite_revoked')]).phase).toEqual({ kind: 'closed', reason: 'invite_revoked' });
    expect(run([{ type: 'open' }, close(4403, 'session_ended')]).phase).toEqual({ kind: 'closed', reason: 'session_ended' });
    expect(run([{ type: 'open' }, close(4403, '')]).phase).toEqual({ kind: 'closed', reason: 'session_ended' });
    const after = run([{ type: 'open' }, close(4403, 'session_ended'), { type: 'open' }, { type: 'authenticated', readOnly: false }]);
    expect(after.phase.kind).toBe('closed');
  });
});
```

`src/lib/collab-session.spec.ts`:

```ts
// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { Server, type onAuthenticatePayload } from '@hocuspocus/server';
import { encodeServerMessage, POLICY_CLOSE_CODE } from '@swint/shared-collab-protocol';
import { createCollabSession, type CollabSession, type CollabSnapshot } from './collab-session.js';

const FAST = { delay: 20, minDelay: 20, maxDelay: 40 };
let server: Server | null = null;
let http401: HttpServer | null = null;
let session: CollabSession | null = null;

afterEach(async () => {
  session?.destroy();
  session = null;
  await server?.destroy();
  server = null;
  await new Promise<void>((r) => (http401 ? http401.close(() => r()) : r()));
  http401 = null;
});

async function startServer(hooks: {
  onAuthenticate?: (p: onAuthenticatePayload) => Promise<unknown>;
  connected?: (p: { connection: { sendStateless(s: string): void } }) => Promise<void>;
} = {}) {
  server = new Server({ port: 0, quiet: true, ...hooks });
  await server.listen();
  return server.webSocketURL;
}

function until(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (pred()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('timeout'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

const snap = (): CollabSnapshot => (session as CollabSession).getSnapshot();
const open = (url: string, role: 'candidate' | 'interviewer' = 'candidate') =>
  (session = createCollabSession({ sessionId: 's1', role, url, WebSocketPolyfill: WebSocket, retry: FAST }));

describe('createCollabSession (real Hocuspocus server)', () => {
  it('connects, reports read-only scope and parses session.state with a clock offset', async () => {
    const url = await startServer({
      onAuthenticate: async ({ connectionConfig }) => {
        connectionConfig.readOnly = true;
      },
      connected: async ({ connection }) => {
        connection.sendStateless(
          encodeServerMessage({ type: 'session.state', status: 'live', startedAt: 1000, durationSec: 60, extensionSec: 0, serverNow: Date.now() + 5000 }),
        );
      },
    });
    open(url);
    await until(() => snap().conn.phase.kind === 'connected' && snap().sessionState !== null);
    expect(snap().conn.readOnly).toBe(true);
    expect(snap().sessionState?.message.status).toBe('live');
    expect(snap().sessionState?.offsetMs).toBeGreaterThan(4000);
  });

  it('interviewers get a notes document on the same socket; candidates do not', async () => {
    const url = await startServer();
    open(url, 'interviewer');
    expect(session?.notes?.provider.configuration.name).toBe('session:s1:notes');
    expect(session?.board.provider.configuration.name).toBe('session:s1:board');
    await until(() => snap().conn.phase.kind === 'connected');
    session?.destroy();
    open(url, 'candidate');
    expect(session?.notes).toBeNull();
  });

  it('a rejected document is terminal and stops reconnecting', async () => {
    let attempts = 0;
    const url = await startServer({
      onAuthenticate: async () => {
        attempts += 1;
        throw Object.assign(new Error('not_started'), { reason: 'not_started' });
      },
    });
    open(url);
    await until(() => snap().conn.phase.kind === 'rejected');
    expect(snap().conn.phase).toEqual({ kind: 'rejected', reason: 'not_started' });
    const seen = attempts;
    await new Promise((r) => setTimeout(r, 200));
    expect(attempts).toBe(seen);
  });

  it('a 4403 close is terminal (the provider would otherwise reconnect)', async () => {
    let connections = 0;
    const url = await startServer({
      connected: async ({ connection }) => {
        connections += 1;
        const c = connection as unknown as { webSocket: { close(code: number, reason: string): void } };
        setTimeout(() => c.webSocket.close(POLICY_CLOSE_CODE, 'invite_revoked'), 20);
      },
    });
    open(url);
    await until(() => snap().conn.phase.kind === 'closed');
    expect(snap().conn.phase).toEqual({ kind: 'closed', reason: 'invite_revoked' });
    await new Promise((r) => setTimeout(r, 200));
    expect(connections).toBe(1);
  });

  it('turns unreachable after repeated refused upgrades (HTTP 401)', async () => {
    http401 = createServer();
    http401.on('upgrade', (_req, socket) => {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    });
    await new Promise<void>((r) => http401?.listen(0, '127.0.0.1', r));
    const { port } = http401.address() as AddressInfo;
    open(`ws://127.0.0.1:${port}/collab`);
    await until(() => snap().conn.phase.kind === 'unreachable', 5000);
  });

  it('notifies subscribers and stops after destroy', async () => {
    const url = await startServer();
    open(url);
    let calls = 0;
    const unsubscribe = session?.subscribe(() => (calls += 1));
    await until(() => calls > 0);
    unsubscribe?.();
    session?.destroy();
    session?.destroy(); // idempotent
  });
});
```

Notes for the implementer:
- The "rejected" test's throw shape must match how Hocuspocus 4.8 forwards the reason. Plan 3 verified: "the `onAuthenticate` rejection reason travels as the thrown value's `.reason`". See `libs/api/collab-server/src/lib/collab-server.ts`, `onAuthenticate`, and mirror its throw exactly.
- If `Server`'s option or property names differ (`webSocketURL`, `listen()`, `destroy()`), check `@hocuspocus/server`'s `index.d.ts` (`declare class Server`) and adapt.
- If the provider's `configuration.name` isn't public, assert through `session.notes !== null` plus the doc name you passed instead.

`src/lib/presence.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { AWARENESS_USER_FIELD } from '@swint/shared-collab-protocol';
import { readParticipants } from './presence.js';

const user = (userId: string, name: string, role: 'candidate' | 'interviewer') => ({
  userId, name, role, color: '#1971c2', selectedElementIds: {},
});

function peer(state: unknown): Awareness {
  const a = new Awareness(new Y.Doc());
  a.setLocalStateField(AWARENESS_USER_FIELD, state);
  return a;
}

describe('readParticipants', () => {
  it('dedupes by userId, drops invalid states, sorts interviewers first then by name', () => {
    const local = peer(user('sub-2', 'Zed', 'interviewer'));
    for (const other of [
      peer(user('sub-1', 'Ada', 'interviewer')),
      peer(user('candidate:s1', 'Bo', 'candidate')),
      peer(user('sub-1', 'Ada', 'interviewer')), // second tab
      peer({ name: 'broken' }),
    ]) {
      applyAwarenessUpdate(local, encodeAwarenessUpdate(other, [other.clientID]), 'remote');
    }
    expect(readParticipants(local).map((p) => p.name)).toEqual(['Ada', 'Zed', 'Bo']);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm nx test web-data-access-collab`
Expected: FAIL (modules missing).

- [ ] **Step 4: Implement**

`src/lib/conn-state.ts`:

```ts
import { isCloseReason, POLICY_CLOSE_CODE, type CloseReason } from '@swint/shared-collab-protocol';

export type EndReason = 'session_ended' | 'invite_revoked';
export type RejectReason = Exclude<CloseReason, 'unauthenticated'>;

export type CollabPhase =
  | { kind: 'connecting' }
  | { kind: 'connected' }
  | { kind: 'reconnecting' }
  /** N consecutive closes without an open: likely HTTP 401 at upgrade. Callers probe REST. Still retrying. */
  | { kind: 'unreachable' }
  /** onAuthenticationFailed for the board. Terminal: the provider does not retry. */
  | { kind: 'rejected'; reason: RejectReason }
  /** Closed by policy (4403). Terminal: we destroy the providers so they don't reconnect. */
  | { kind: 'closed'; reason: EndReason };

export interface CollabConnState {
  phase: CollabPhase;
  failedOpens: number;
  openedThisAttempt: boolean;
  everConnected: boolean;
  readOnly: boolean;
}

export type CollabEvent =
  | { type: 'open' }
  | { type: 'authenticated'; readOnly: boolean }
  | { type: 'authFailed'; reason: string }
  | { type: 'close'; code: number; reason: string };

export const initialConnState: CollabConnState = {
  phase: { kind: 'connecting' },
  failedOpens: 0,
  openedThisAttempt: false,
  everConnected: false,
  readOnly: false,
};

export function isTerminal(phase: CollabPhase): boolean {
  return phase.kind === 'rejected' || phase.kind === 'closed';
}

export function reduceConn(state: CollabConnState, event: CollabEvent, failedOpensBeforeProbe: number): CollabConnState {
  if (isTerminal(state.phase)) return state;
  switch (event.type) {
    case 'open':
      return { ...state, openedThisAttempt: true, failedOpens: 0 };
    case 'authenticated':
      return { ...state, phase: { kind: 'connected' }, everConnected: true, readOnly: event.readOnly };
    case 'authFailed': {
      const reason: RejectReason =
        isCloseReason(event.reason) && event.reason !== 'unauthenticated' ? event.reason : 'forbidden';
      return { ...state, phase: { kind: 'rejected', reason } };
    }
    case 'close': {
      if (event.code === POLICY_CLOSE_CODE) {
        const reason: EndReason = event.reason === 'invite_revoked' ? 'invite_revoked' : 'session_ended';
        return { ...state, phase: { kind: 'closed', reason } };
      }
      const failedOpens = state.openedThisAttempt ? 0 : state.failedOpens + 1;
      const phase: CollabPhase = failedOpens >= failedOpensBeforeProbe ? { kind: 'unreachable' } : { kind: 'reconnecting' };
      return { ...state, failedOpens, openedThisAttempt: false, phase };
    }
  }
}
```

`src/lib/collab-session.ts`:

```ts
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { docName, parseServerMessage, type SessionStateMessage } from '@swint/shared-collab-protocol';
import { serverOffsetMs, type ParticipantRole } from '@swint/shared-domain';
import { initialConnState, isTerminal, reduceConn, type CollabConnState, type CollabEvent } from './conn-state.js';

export interface CollabDoc {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  awareness: Awareness;
}

export interface SessionStateSnapshot {
  message: SessionStateMessage;
  /** serverNow - clientNow at receipt; add it to Date.now() to get server time. */
  offsetMs: number;
}

export interface CollabSnapshot {
  conn: CollabConnState;
  sessionState: SessionStateSnapshot | null;
  /** Notes rejection reason (interviewers only); the board keeps working. */
  notesError: string | null;
}

export interface CollabSessionOptions {
  sessionId: string;
  role: ParticipantRole;
  /** Default: same-origin `/collab` (ws or wss). */
  url?: string;
  /** Node tests pass the `ws` package. */
  WebSocketPolyfill?: unknown;
  failedOpensBeforeProbe?: number;
  /** Reconnect backoff. `delay` must be ≥ `minDelay`. */
  retry?: { delay: number; minDelay: number; maxDelay: number };
  now?: () => number;
}

export interface CollabSession {
  board: CollabDoc;
  notes: CollabDoc | null;
  getSnapshot(): CollabSnapshot;
  subscribe(listener: () => void): () => void;
  destroy(): void;
}

export type CollabSessionFactory = (opts: CollabSessionOptions) => CollabSession;

export const DEFAULT_RETRY = { delay: 1000, minDelay: 1000, maxDelay: 10_000 };
export const DEFAULT_FAILED_OPENS_BEFORE_PROBE = 3;

export function defaultCollabUrl(loc: Pick<Location, 'protocol' | 'host'> = window.location): string {
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/collab`;
}

/**
 * One WebSocket per room, multiplexing the board (and, for interviewers, notes) documents.
 * Implements the client side of the real-time contract (libs/shared/collab-protocol/README.md).
 */
export function createCollabSession(opts: CollabSessionOptions): CollabSession {
  const now = opts.now ?? Date.now;
  const threshold = opts.failedOpensBeforeProbe ?? DEFAULT_FAILED_OPENS_BEFORE_PROBE;
  const retry = opts.retry ?? DEFAULT_RETRY;
  const listeners = new Set<() => void>();
  let snapshot: CollabSnapshot = { conn: initialConnState, sessionState: null, notesError: null };
  let destroyed = false;
  let tornDown = false;

  const set = (patch: Partial<CollabSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of [...listeners]) listener();
  };

  const dispatch = (event: CollabEvent) => {
    if (destroyed) return;
    const conn = reduceConn(snapshot.conn, event, threshold);
    if (conn === snapshot.conn) return;
    set({ conn });
    if (isTerminal(conn.phase)) teardown();
  };

  const socket = new HocuspocusProviderWebsocket({
    url: opts.url ?? defaultCollabUrl(),
    ...(opts.WebSocketPolyfill ? { WebSocketPolyfill: opts.WebSocketPolyfill } : {}),
    delay: retry.delay,
    minDelay: retry.minDelay,
    maxDelay: retry.maxDelay,
    onOpen: () => dispatch({ type: 'open' }),
    onClose: ({ event }) => dispatch({ type: 'close', code: event?.code ?? 1006, reason: event?.reason ?? '' }),
  });

  const makeDoc = (
    name: string,
    extra: Partial<ConstructorParameters<typeof HocuspocusProvider>[0]>,
  ): CollabDoc => {
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({ websocketProvider: socket, name, document: doc, token: 'cookie', ...extra });
    // With an external websocketProvider the provider does not attach itself.
    provider.attach();
    const awareness = provider.awareness;
    if (!awareness) throw new Error('provider has no awareness');
    return { doc, provider, awareness };
  };

  const board = makeDoc(docName.board(opts.sessionId), {
    onAuthenticated: ({ scope }) => dispatch({ type: 'authenticated', readOnly: scope === 'readonly' }),
    onAuthenticationFailed: ({ reason }) => dispatch({ type: 'authFailed', reason }),
    onStateless: ({ payload }) => {
      const message = parseServerMessage(payload);
      if (message?.type === 'session.state') {
        set({ sessionState: { message, offsetMs: serverOffsetMs(message.serverNow, now()) } });
      }
    },
  });

  const notes =
    opts.role === 'interviewer'
      ? makeDoc(docName.notes(opts.sessionId), {
          onAuthenticationFailed: ({ reason }) => set({ notesError: reason }),
        })
      : null;

  function teardown() {
    if (tornDown) return;
    tornDown = true;
    board.provider.destroy();
    notes?.provider.destroy();
    socket.destroy();
  }

  return {
    board,
    notes,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      teardown();
      board.doc.destroy();
      notes?.doc.destroy();
      listeners.clear();
    },
  };
}
```

If `HocuspocusProviderWebsocket`'s option types don't include `delay`, `minDelay`, `maxDelay`, `onOpen` or `onClose` under these names, check the provider `.d.ts` (`CompleteHocuspocusProviderWebsocketConfiguration`) and adapt. Keep the semantics.

`src/lib/presence.ts`:

```ts
import type { Awareness } from 'y-protocols/awareness';
import { readAwarenessUser, type AwarenessUser } from '@swint/shared-collab-protocol';

/** Everyone in the room (including us), one entry per user, interviewers first. */
export function readParticipants(awareness: Awareness): AwarenessUser[] {
  const byId = new Map<string, AwarenessUser>();
  awareness.getStates().forEach((state) => {
    const user = readAwarenessUser(state);
    if (user && !byId.has(user.userId)) byId.set(user.userId, user);
  });
  return [...byId.values()].sort((a, b) =>
    a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'interviewer' ? -1 : 1,
  );
}
```

`src/lib/react.tsx`:

```tsx
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import type { AwarenessUser } from '@swint/shared-collab-protocol';
import { createCollabSession, type CollabSession, type CollabSessionFactory, type CollabSessionOptions, type CollabSnapshot } from './collab-session.js';
import { readParticipants } from './presence.js';

const FactoryContext = createContext<CollabSessionFactory>(createCollabSession);

/** Lets tests (and future transports) replace how sessions are created. */
export function CollabFactoryProvider({ factory, children }: { factory: CollabSessionFactory; children: ReactNode }) {
  return <FactoryContext.Provider value={factory}>{children}</FactoryContext.Provider>;
}

const noopSubscribe = () => () => undefined;

/** Creates the room's collab session while mounted (and while `opts` is non-null); destroys it on unmount. */
export function useCollabSession(opts: CollabSessionOptions | null): { session: CollabSession | null; snapshot: CollabSnapshot | null } {
  const factory = useContext(FactoryContext);
  const [session, setSession] = useState<CollabSession | null>(null);
  const sessionId = opts?.sessionId;
  const role = opts?.role;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const current = optsRef.current;
    if (!current) return;
    const created = factory(current);
    setSession(created);
    return () => {
      created.destroy();
      setSession(null);
    };
  }, [factory, sessionId, role]);

  const snapshot = useSyncExternalStore(session ? session.subscribe : noopSubscribe, () => session?.getSnapshot() ?? null);
  return { session, snapshot };
}

export function usePresence(awareness: Awareness | null): AwarenessUser[] {
  const cache = useRef<AwarenessUser[]>([]);
  const subscribe = (onChange: () => void) => {
    if (!awareness) return () => undefined;
    const handler = () => {
      cache.current = readParticipants(awareness);
      onChange();
    };
    handler();
    awareness.on('change', handler);
    return () => awareness.off('change', handler);
  };
  return useSyncExternalStore(subscribe, () => cache.current);
}
```

`usePresence`'s `subscribe` is recreated each render. That makes React resubscribe every render, which is safe but wasteful. Wrap it in `useCallback(…, [awareness])`. Lint (`react-hooks/exhaustive-deps`) will require it anyway.

`src/testing/fake-collab-session.ts`:

```ts
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import type { ParticipantRole } from '@swint/shared-domain';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { initialConnState } from '../lib/conn-state.js';
import type { CollabDoc, CollabSession, CollabSessionFactory, CollabSnapshot } from '../lib/collab-session.js';

function fakeDoc(): CollabDoc {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  return { doc, awareness, provider: { awareness } as unknown as HocuspocusProvider };
}

/** In-memory CollabSession for component tests: drive it with `update()`. */
export function createFakeCollabSession({ role }: { role: ParticipantRole }) {
  const listeners = new Set<() => void>();
  let snapshot: CollabSnapshot = {
    conn: { ...initialConnState, phase: { kind: 'connected' }, everConnected: true },
    sessionState: null,
    notesError: null,
  };
  const session: CollabSession = {
    board: fakeDoc(),
    notes: role === 'interviewer' ? fakeDoc() : null,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy: () => listeners.clear(),
  };
  const update = (patch: Partial<CollabSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const l of [...listeners]) l();
  };
  const factory: CollabSessionFactory = () => session;
  return { session, update, factory };
}
```

`src/testing/index.ts`: `export * from './fake-collab-session.js';`

`src/index.ts`:

```ts
export * from './lib/conn-state.js';
export * from './lib/collab-session.js';
export * from './lib/presence.js';
export * from './lib/react.js';
```

- [ ] **Step 5: Verify**

Run: `pnpm install && pnpm nx sync && pnpm nx run-many -t test lint typecheck -p web-data-access-collab`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libs/web/data-access-collab package.json pnpm-lock.yaml tsconfig.json
git commit -m "feat(web-data-access-collab): room collab session with the real-time contract state machine

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `web-ui-whiteboard`: Excalidraw binding, collaborative board, seed editor, export

**Files:**
- Create:
  - `libs/web/ui-whiteboard/src/lib/binding/excalidraw-binding.ts` (+ `excalidraw-binding.spec.ts`)
  - `libs/web/ui-whiteboard/src/lib/components/collaborative-board.tsx` (+ `collaborative-board.spec.tsx`)
  - `libs/web/ui-whiteboard/src/lib/components/seed-board-editor.tsx`
  - `libs/web/ui-whiteboard/src/lib/export.ts`
- Modify: `libs/web/ui-whiteboard/src/index.ts`, `libs/web/ui-whiteboard/package.json`

**Interfaces:**
- Consumes: `BoardSync` (Task 2), `createPeers` (`test-peers.ts`), `readAwarenessUser`, `AWARENESS_USER_FIELD`, `AwarenessUser`, `SyncedElement`
- Produces:
  - Binding:
    - `POINTER_INTERVAL_MS = 33`
    - `interface SceneCollaborator { id: string; username: string; color: { background: string; stroke: string }; pointer?: { x: number; y: number; tool: 'pointer' | 'laser' }; selectedElementIds?: Record<string, true> }`
    - `interface SceneApi { updateScene(scene: { elements?: readonly SyncedElement[]; collaborators?: Map<string, SceneCollaborator>; captureUpdate?: string }): void; getSceneElementsIncludingDeleted(): readonly SyncedElement[]; getAppState(): unknown }`
    - `interface ExcalidrawFns { reconcileElements(local, remote, appState): readonly SyncedElement[]; restoreElements(elements): readonly SyncedElement[]; captureNever: string }`
    - `interface Scheduler { requestFrame(cb: () => void): number; cancelFrame(h: number): void; now(): number; setTimeout(cb: () => void, ms: number): number; clearTimeout(h: number): void }`
    - `class ExcalidrawBinding { constructor(o: { doc; api: SceneApi; fns: ExcalidrawFns; awareness: Awareness | null; scheduler?: Scheduler }); handleChange(elements, appState: { selectedElementIds?: Record<string, boolean> }): void; handlePointer(p): void; setReadOnly(v: boolean): void; destroy(): void }`
  - Components:
    - `CollaborativeBoard(props: { doc: Y.Doc; awareness: Awareness | null; readOnly: boolean; onReady?: (handle: BoardHandle) => void })`
    - `interface BoardHandle { exportAs(format: ExportFormat): Promise<Blob> }`
    - `SeedBoardEditor(props: { initialElements: readonly SyncedElement[]; onChange: (elements: SyncedElement[]) => void })`
  - Export:
    - `type ExportFormat = 'png' | 'svg' | 'excalidraw'`
    - `EXPORT_FORMATS: readonly ExportFormat[]`
    - `exportBoard(api: ExcalidrawImperativeAPI, format): Promise<Blob>`
    - `downloadBlob(blob: Blob, filename: string): void`
    - `exportFileName(title: string, format: ExportFormat): string`

**Verified Excalidraw 0.18.1 facts** (from `dist/types/excalidraw/index.d.ts`, `types.d.ts`, `data/reconcile.d.ts`, `data/restore.d.ts`):
- Exports: `Excalidraw`, `CaptureUpdateAction` (`NEVER | IMMEDIATELY | EVENTUALLY`), `reconcileElements(local, remote, appState)`, `restoreElements(elements, localElements, { refreshDimensions?, repairBindings? })`, `exportToBlob`, `exportToSvg`, `serializeAsJSON`.
- `restoreElements` keeps `version` and `versionNonce` (`version: element.version || 1, versionNonce: element.versionNonce ?? 0`).
- CSS: `import '@excalidraw/excalidraw/index.css'`. Types: `import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'`.
- Props used: `excalidrawAPI`, `onChange(elements, appState, files)`, `onPointerUpdate({ pointer })`, `onPaste(data, event) => boolean` (false prevents default), `isCollaborating`, `viewModeEnabled`, `UIOptions.tools.image`, `initialData`.
- `SceneData`: `{ elements?, appState?, collaborators?: Map<SocketId, Collaborator>, captureUpdate? }`. `Collaborator`: `{ pointer?, selectedElementIds?, username?, color?: { background, stroke }, id? }`.
- API methods: `updateScene`, `getSceneElements`, `getSceneElementsIncludingDeleted`, `getAppState`, `getFiles`.

**Design:** `ExcalidrawBinding` is framework-free and takes the Excalidraw functions it needs as `fns`. Its tests never load the real Excalidraw bundle, which is heavy and needs canvas. The React component supplies the real functions and casts the branded Excalidraw types once, at the boundary.

- [ ] **Step 1: Install**

```bash
pnpm add -w @excalidraw/excalidraw@0.18.1
```

Add to `libs/web/ui-whiteboard/package.json` dependencies:
- `"@excalidraw/excalidraw": "0.18.1"`, an exact pin (spec §11)
- `"react": "^19.0.0"`
- `"y-protocols": "^1.0.7"`

Keep `@swint/shared-collab-protocol` and `yjs`.

- [ ] **Step 2: Write the failing binding tests**

`src/lib/binding/excalidraw-binding.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { AWARENESS_USER_FIELD, getBoardElements, type SyncedElement } from '@swint/shared-collab-protocol';
import { ExcalidrawBinding, POINTER_INTERVAL_MS, type ExcalidrawFns, type SceneApi, type Scheduler } from './excalidraw-binding.js';
import { createPeers } from './test-peers.js';

const el = (id: string, version: number, extra: Partial<SyncedElement> = {}): SyncedElement => ({
  id, type: 'rectangle', version, versionNonce: version * 7, index: 'a0', isDeleted: false, x: 0, y: 0, width: 10, height: 10, ...extra,
});

const fns: ExcalidrawFns = {
  // remote wins by id; keeps local-only elements
  reconcileElements: (local, remote) => {
    const byId = new Map(local.map((e) => [e.id, e]));
    for (const r of remote) byId.set(r.id, r);
    return [...byId.values()];
  },
  restoreElements: (els) => els,
  captureNever: 'NEVER',
};

function fakeScheduler() {
  let frames: (() => void)[] = [];
  let timers: { at: number; cb: () => void }[] = [];
  let t = 0;
  const s: Scheduler = {
    requestFrame: (cb) => frames.push(cb),
    cancelFrame: (h) => {
      frames[h - 1] = () => undefined;
    },
    now: () => t,
    setTimeout: (cb, ms) => timers.push({ at: t + ms, cb }),
    clearTimeout: (h) => {
      if (timers[h - 1]) timers[h - 1].cb = () => undefined;
    },
  };
  return {
    s,
    frame: () => {
      const run = frames;
      frames = [];
      run.forEach((f) => f());
    },
    advance: (ms: number) => {
      t += ms;
      const due = timers.filter((x) => x.at <= t);
      timers = timers.filter((x) => x.at > t);
      due.forEach((x) => x.cb());
    },
  };
}

function fakeApi(): SceneApi & { updateScene: ReturnType<typeof vi.fn> } {
  let scene: readonly SyncedElement[] = [];
  return {
    updateScene: vi.fn((s: { elements?: readonly SyncedElement[] }) => {
      if (s.elements) scene = s.elements;
    }),
    getSceneElementsIncludingDeleted: () => scene,
    getAppState: () => ({}),
  };
}

function setup() {
  const { a, b, flush } = createPeers({ clientIds: [1, 2] });
  const sched = fakeScheduler();
  const apiA = fakeApi();
  const apiB = fakeApi();
  const awA = new Awareness(a);
  const bindA = new ExcalidrawBinding({ doc: a, api: apiA, fns, awareness: awA, scheduler: sched.s });
  const bindB = new ExcalidrawBinding({ doc: b, api: apiB, fns, awareness: null, scheduler: sched.s });
  return { a, b, flush, sched, apiA, apiB, awA, bindA, bindB };
}

describe('ExcalidrawBinding', () => {
  it('throttles local pushes to one Yjs transaction per animation frame, using the latest scene', () => {
    const { a, b, flush, sched, bindA } = setup();
    const updates = vi.fn();
    a.on('update', updates);
    bindA.handleChange([el('r1', 1)], {});
    bindA.handleChange([el('r1', 2)], {});
    bindA.handleChange([el('r1', 3)], {});
    expect(updates).not.toHaveBeenCalled();
    sched.frame();
    expect(updates).toHaveBeenCalledTimes(1);
    flush();
    expect(getBoardElements(b).get('r1')?.version).toBe(3);
  });

  it('applies remote changes with captureUpdate NEVER, so they never enter local undo history', () => {
    const { flush, sched, apiB, bindA } = setup();
    bindA.handleChange([el('r1', 1, { x: 5 })], {});
    sched.frame();
    flush();
    const sceneCalls = apiB.updateScene.mock.calls.map((c) => c[0]).filter((s) => s.elements);
    expect(sceneCalls).toHaveLength(1);
    expect(sceneCalls[0].captureUpdate).toBe('NEVER');
    expect(sceneCalls[0].elements.map((e: SyncedElement) => [e.id, e['x']])).toEqual([['r1', 5]]);
    // every updateScene the binding issues is non-capturing (elements and collaborators alike)
    expect(apiB.updateScene.mock.calls.every((c) => c[0].captureUpdate === 'NEVER')).toBe(true);
  });

  it('does not echo its own local edits back into its scene', () => {
    const { flush, sched, apiA, bindA } = setup();
    apiA.updateScene.mockClear();
    bindA.handleChange([el('r1', 1)], {});
    sched.frame();
    flush();
    expect(apiA.updateScene.mock.calls.filter((c) => c[0].elements)).toHaveLength(0);
  });

  it('loads elements already in the document on construction', () => {
    const doc = new Y.Doc();
    getBoardElements(doc).set('r1', el('r1', 4));
    const api = fakeApi();
    new ExcalidrawBinding({ doc, api, fns, awareness: null, scheduler: fakeScheduler().s });
    expect(api.updateScene).toHaveBeenCalledWith(expect.objectContaining({ captureUpdate: 'NEVER', elements: [expect.objectContaining({ id: 'r1', version: 4 })] }));
  });

  it('read-only bindings never write', () => {
    const { a, sched, bindA } = setup();
    bindA.setReadOnly(true);
    bindA.handleChange([el('r1', 1)], {});
    sched.frame();
    expect(getBoardElements(a).size).toBe(0);
  });

  it('never syncs image elements', () => {
    const { a, sched, bindA } = setup();
    bindA.handleChange([el('img', 1, { type: 'image' }), el('r1', 1)], {});
    sched.frame();
    expect([...getBoardElements(a).keys()]).toEqual(['r1']);
  });

  it('throttles pointer awareness to ~30/s (leading + trailing)', () => {
    const { awA, sched, bindA } = setup();
    const set = vi.spyOn(awA, 'setLocalStateField');
    bindA.handlePointer({ x: 1, y: 1, tool: 'pointer' });
    bindA.handlePointer({ x: 2, y: 2, tool: 'pointer' });
    bindA.handlePointer({ x: 3, y: 3, tool: 'pointer' });
    expect(set).toHaveBeenCalledTimes(1);
    sched.advance(POINTER_INTERVAL_MS);
    expect(set).toHaveBeenCalledTimes(2);
    expect(awA.getLocalState()?.[AWARENESS_USER_FIELD]).toMatchObject({ pointer: { x: 3, y: 3, tool: 'pointer' } });
  });

  it('publishes selection changes once per change, merged into the existing user field', () => {
    const { awA, bindA } = setup();
    awA.setLocalStateField(AWARENESS_USER_FIELD, { userId: 'u', name: 'Ada', role: 'interviewer', color: '#1971c2', selectedElementIds: {} });
    const set = vi.spyOn(awA, 'setLocalStateField');
    bindA.handleChange([], { selectedElementIds: { r1: true, r2: false } });
    bindA.handleChange([], { selectedElementIds: { r1: true } });
    expect(set).toHaveBeenCalledTimes(1);
    expect(awA.getLocalState()?.[AWARENESS_USER_FIELD]).toMatchObject({ name: 'Ada', selectedElementIds: { r1: true } });
  });

  it('shows remote peers as Excalidraw collaborators, excluding itself and invalid states', () => {
    const { awA, apiA } = setup();
    const peer = new Awareness(new Y.Doc());
    peer.setLocalStateField(AWARENESS_USER_FIELD, {
      userId: 'candidate:s1', name: 'Bo', role: 'candidate', color: '#2f9e44', selectedElementIds: { r1: true }, pointer: { x: 4, y: 5, tool: 'laser' },
    });
    const broken = new Awareness(new Y.Doc());
    broken.setLocalStateField(AWARENESS_USER_FIELD, { name: 'x' });
    awA.setLocalStateField(AWARENESS_USER_FIELD, { userId: 'me', name: 'Me', role: 'interviewer', color: '#000000', selectedElementIds: {} });
    applyAwarenessUpdate(awA, encodeAwarenessUpdate(peer, [peer.clientID]), 'remote');
    applyAwarenessUpdate(awA, encodeAwarenessUpdate(broken, [broken.clientID]), 'remote');
    const last = apiA.updateScene.mock.calls.map((c) => c[0]).filter((s) => s.collaborators).at(-1);
    const collaborators = [...(last.collaborators as Map<string, unknown>).values()];
    expect(collaborators).toEqual([
      { id: 'candidate:s1', username: 'Bo', color: { background: '#2f9e44', stroke: '#2f9e44' }, pointer: { x: 4, y: 5, tool: 'laser' }, selectedElementIds: { r1: true } },
    ]);
  });

  it('after destroy, ignores remote changes and pending frames', () => {
    const { flush, sched, apiA, bindA, bindB } = setup();
    bindA.handleChange([el('r1', 1)], {});
    bindA.destroy();
    sched.frame();
    apiA.updateScene.mockClear();
    bindB.handleChange([el('r2', 1)], {});
    sched.frame();
    flush();
    expect(apiA.updateScene).not.toHaveBeenCalled();
  });
});
```

`createPeers` lives in `test-peers.ts` next to `board-sync.ts`. Check its real signature and adapt the call if it differs.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm nx test web-ui-whiteboard`
Expected: FAIL (`./excalidraw-binding.js` missing).

- [ ] **Step 4: Implement the binding**

`src/lib/binding/excalidraw-binding.ts`:

```ts
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { AWARENESS_USER_FIELD, readAwarenessUser, type AwarenessUser, type SyncedElement } from '@swint/shared-collab-protocol';
import { BoardSync } from './board-sync.js';

/** ~30 pointer updates per second (spec §7.3). */
export const POINTER_INTERVAL_MS = 33;

export interface SceneCollaborator {
  id: string;
  username: string;
  color: { background: string; stroke: string };
  pointer?: { x: number; y: number; tool: 'pointer' | 'laser' };
  selectedElementIds?: Record<string, true>;
}

/** The subset of ExcalidrawImperativeAPI the binding uses (structural, so tests can fake it). */
export interface SceneApi {
  updateScene(scene: { elements?: readonly SyncedElement[]; collaborators?: Map<string, SceneCollaborator>; captureUpdate?: string }): void;
  getSceneElementsIncludingDeleted(): readonly SyncedElement[];
  getAppState(): unknown;
}

/** Excalidraw functions, injected so the binding is testable without the Excalidraw bundle. */
export interface ExcalidrawFns {
  reconcileElements(local: readonly SyncedElement[], remote: readonly SyncedElement[], appState: unknown): readonly SyncedElement[];
  restoreElements(elements: readonly SyncedElement[]): readonly SyncedElement[];
  /** CaptureUpdateAction.NEVER: remote updates must never enter the local undo stack. */
  captureNever: string;
}

export interface Scheduler {
  requestFrame(cb: () => void): number;
  cancelFrame(handle: number): void;
  now(): number;
  setTimeout(cb: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

const browserScheduler: Scheduler = {
  requestFrame: (cb) => requestAnimationFrame(cb),
  cancelFrame: (h) => cancelAnimationFrame(h),
  now: () => performance.now(),
  setTimeout: (cb, ms) => window.setTimeout(cb, ms),
  clearTimeout: (h) => window.clearTimeout(h),
};

type Pointer = NonNullable<AwarenessUser['pointer']>;
type AwarenessChanges = { added: number[]; updated: number[]; removed: number[] };

export interface ExcalidrawBindingOptions {
  doc: Y.Doc;
  api: SceneApi;
  fns: ExcalidrawFns;
  awareness: Awareness | null;
  scheduler?: Scheduler;
}

/** Connects one Excalidraw instance to the board document and presence (spec §7.2, §7.3). */
export class ExcalidrawBinding {
  private readonly s: Scheduler;
  private readonly sync: BoardSync;
  private pendingScene: readonly SyncedElement[] | null = null;
  private frame: number | null = null;
  private lastSelectionKey = '';
  private pendingPointer: Pointer | null = null;
  private lastPointerAt = Number.NEGATIVE_INFINITY;
  private pointerTimer: number | null = null;
  private readOnly = false;
  private destroyed = false;

  constructor(private readonly o: ExcalidrawBindingOptions) {
    this.s = o.scheduler ?? browserScheduler;
    this.sync = new BoardSync({ doc: o.doc, onRemoteChange: (elements) => this.applyRemote(elements) });
    const initial = this.sync.getElements();
    if (initial.length > 0) this.applyRemote(initial);
    o.awareness?.on('change', this.handleAwareness);
    this.handleAwareness();
  }

  setReadOnly(readOnly: boolean): void {
    this.readOnly = readOnly;
    if (readOnly) this.pendingScene = null;
  }

  /** Excalidraw `onChange`. At most one BoardSync push per animation frame, with the latest scene. */
  handleChange(elements: readonly SyncedElement[], appState: { selectedElementIds?: Record<string, boolean> }): void {
    if (this.destroyed) return;
    this.publishSelection(appState.selectedElementIds ?? {});
    if (this.readOnly) return;
    this.pendingScene = elements;
    if (this.frame === null) this.frame = this.s.requestFrame(this.flush);
  }

  /** Excalidraw `onPointerUpdate`. Leading + trailing throttle. */
  handlePointer(pointer: Pointer): void {
    if (this.destroyed || !this.o.awareness) return;
    this.pendingPointer = { x: pointer.x, y: pointer.y, tool: pointer.tool };
    const elapsed = this.s.now() - this.lastPointerAt;
    if (elapsed >= POINTER_INTERVAL_MS) {
      this.sendPointer();
    } else if (this.pointerTimer === null) {
      this.pointerTimer = this.s.setTimeout(() => {
        this.pointerTimer = null;
        this.sendPointer();
      }, POINTER_INTERVAL_MS - elapsed);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.frame !== null) this.s.cancelFrame(this.frame);
    if (this.pointerTimer !== null) this.s.clearTimeout(this.pointerTimer);
    this.o.awareness?.off('change', this.handleAwareness);
    this.sync.destroy();
  }

  private readonly flush = (): void => {
    this.frame = null;
    const scene = this.pendingScene;
    this.pendingScene = null;
    if (!scene || this.destroyed || this.readOnly) return;
    // BoardSync drops invalid elements, which includes images (disabled in v1).
    this.sync.pushLocal(scene);
  };

  private applyRemote(elements: SyncedElement[]): void {
    if (this.destroyed) return;
    const { api, fns } = this.o;
    const remote = fns.restoreElements(elements);
    const merged = fns.reconcileElements(api.getSceneElementsIncludingDeleted(), remote, api.getAppState());
    api.updateScene({ elements: merged, captureUpdate: fns.captureNever });
  }

  private sendPointer(): void {
    if (!this.pendingPointer) return;
    this.lastPointerAt = this.s.now();
    this.patchUser({ pointer: this.pendingPointer });
    this.pendingPointer = null;
  }

  private publishSelection(selected: Record<string, boolean>): void {
    const ids = Object.keys(selected).filter((id) => selected[id]).sort();
    const key = ids.join('\u0000');
    if (key === this.lastSelectionKey) return;
    this.lastSelectionKey = key;
    this.patchUser({ selectedElementIds: Object.fromEntries(ids.map((id) => [id, true as const])) });
  }

  private patchUser(patch: Partial<AwarenessUser>): void {
    const awareness = this.o.awareness;
    if (!awareness) return;
    const current = awareness.getLocalState()?.[AWARENESS_USER_FIELD];
    const base = typeof current === 'object' && current !== null ? current : {};
    awareness.setLocalStateField(AWARENESS_USER_FIELD, { ...base, ...patch });
  }

  private readonly handleAwareness = (changes?: AwarenessChanges): void => {
    const awareness = this.o.awareness;
    if (!awareness || this.destroyed) return;
    if (changes && [...changes.added, ...changes.updated, ...changes.removed].every((id) => id === awareness.clientID)) return;
    const collaborators = new Map<string, SceneCollaborator>();
    awareness.getStates().forEach((state, clientId) => {
      if (clientId === awareness.clientID) return;
      const user = readAwarenessUser(state);
      if (!user) return;
      collaborators.set(String(clientId), {
        id: user.userId,
        username: user.name,
        color: { background: user.color, stroke: user.color },
        ...(user.pointer ? { pointer: user.pointer } : {}),
        selectedElementIds: user.selectedElementIds,
      });
    });
    this.o.api.updateScene({ collaborators, captureUpdate: this.o.fns.captureNever });
  };
}
```

- [ ] **Step 5: Run the binding tests**

Run: `pnpm nx test web-ui-whiteboard`
Expected: PASS.

- [ ] **Step 6: Write the failing component tests**

`src/lib/components/collaborative-board.spec.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { getBoardElements } from '@swint/shared-collab-protocol';

const api = {
  updateScene: vi.fn(),
  getSceneElementsIncludingDeleted: vi.fn(() => []),
  getSceneElements: vi.fn(() => []),
  getAppState: vi.fn(() => ({})),
  getFiles: vi.fn(() => ({})),
};
let lastProps: Record<string, unknown> = {};

vi.mock('@excalidraw/excalidraw/index.css', () => ({}));
vi.mock('@excalidraw/excalidraw', () => ({
  CaptureUpdateAction: { NEVER: 'NEVER', IMMEDIATELY: 'IMMEDIATELY', EVENTUALLY: 'EVENTUALLY' },
  reconcileElements: (_l: unknown[], r: unknown[]) => r,
  restoreElements: (els: unknown[]) => els,
  exportToBlob: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
  exportToSvg: vi.fn(async () => ({ outerHTML: '<svg/>' })),
  serializeAsJSON: vi.fn(() => '{"type":"excalidraw"}'),
  Excalidraw: (props: Record<string, unknown>) => {
    lastProps = props;
    (props['excalidrawAPI'] as (a: unknown) => void)?.(api);
    return <div data-testid="excalidraw" data-view-mode={String(props['viewModeEnabled'])} />;
  },
}));

const { CollaborativeBoard } = await import('./collaborative-board.js');

const rect = { id: 'r1', type: 'rectangle', version: 1, versionNonce: 1, index: 'a0', isDeleted: false, x: 0, y: 0, width: 1, height: 1 };

describe('CollaborativeBoard', () => {
  it('renders Excalidraw for collaboration with images disabled', () => {
    render(<CollaborativeBoard doc={new Y.Doc()} awareness={null} readOnly={false} />);
    expect(screen.getByTestId('excalidraw')).toHaveAttribute('data-view-mode', 'false');
    expect(lastProps['isCollaborating']).toBe(true);
    expect(lastProps['UIOptions']).toEqual({ tools: { image: false } });
  });

  it('switches to view mode when read-only', () => {
    render(<CollaborativeBoard doc={new Y.Doc()} awareness={null} readOnly />);
    expect(screen.getByTestId('excalidraw')).toHaveAttribute('data-view-mode', 'true');
  });

  it('applies document elements with captureUpdate NEVER', async () => {
    const doc = new Y.Doc();
    getBoardElements(doc).set('r1', rect);
    api.updateScene.mockClear();
    render(<CollaborativeBoard doc={doc} awareness={null} readOnly={false} />);
    await act(async () => undefined);
    expect(api.updateScene).toHaveBeenCalledWith(expect.objectContaining({ captureUpdate: 'NEVER', elements: [expect.objectContaining({ id: 'r1' })] }));
  });

  it('refuses pasted image files but allows other pastes', () => {
    render(<CollaborativeBoard doc={new Y.Doc()} awareness={null} readOnly={false} />);
    const onPaste = lastProps['onPaste'] as (d: unknown, e: unknown) => boolean;
    const withFiles = (types: string[]) => ({ clipboardData: { files: types.map((type) => ({ type })) } });
    expect(onPaste({}, withFiles(['image/png']))).toBe(false);
    expect(onPaste({}, withFiles([]))).toBe(true);
    expect(onPaste({}, null)).toBe(true);
  });

  it('hands out an export handle', async () => {
    const onReady = vi.fn();
    render(<CollaborativeBoard doc={new Y.Doc()} awareness={null} readOnly onReady={onReady} />);
    await act(async () => undefined);
    const handle = onReady.mock.calls[0][0];
    await expect(handle.exportAs('png')).resolves.toBeInstanceOf(Blob);
    const svg = await handle.exportAs('svg');
    expect(svg.type).toBe('image/svg+xml');
    const json = await handle.exportAs('excalidraw');
    expect(await json.text()).toContain('excalidraw');
  });
});
```

Add `src/lib/export.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { exportFileName } from './export.js';

describe('exportFileName', () => {
  it('slugs the title and appends the extension', () => {
    expect(exportFileName('Design a URL shortener!', 'png')).toBe('design-a-url-shortener.png');
    expect(exportFileName('   ', 'excalidraw')).toBe('board.excalidraw');
  });
});
```

`export.ts` imports from `@excalidraw/excalidraw`. Keep `exportFileName` free of those imports, or mock the module in this spec the same way as above.

- [ ] **Step 7: Implement components and export**

`src/lib/export.ts`:

```ts
import { exportToBlob, exportToSvg, serializeAsJSON } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';

export type ExportFormat = 'png' | 'svg' | 'excalidraw';
export const EXPORT_FORMATS: readonly ExportFormat[] = ['png', 'svg', 'excalidraw'];

/** Spec §6: exports are generated in the browser from the (read-only) board. */
export async function exportBoard(api: ExcalidrawImperativeAPI, format: ExportFormat): Promise<Blob> {
  const elements = api.getSceneElements();
  const appState = { ...api.getAppState(), exportBackground: true };
  const files = api.getFiles();
  if (format === 'png') return exportToBlob({ elements, appState, files, mimeType: 'image/png' });
  if (format === 'svg') {
    const svg = await exportToSvg({ elements, appState, files });
    return new Blob([svg.outerHTML], { type: 'image/svg+xml' });
  }
  return new Blob([serializeAsJSON(elements, appState, files, 'local')], { type: 'application/json' });
}

export function exportFileName(title: string, format: ExportFormat): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'board'}.${format}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
```

`src/lib/components/collaborative-board.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { CaptureUpdateAction, Excalidraw, reconcileElements, restoreElements } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import '@excalidraw/excalidraw/index.css';
import type { SyncedElement } from '@swint/shared-collab-protocol';
import { ExcalidrawBinding, type ExcalidrawFns, type SceneApi } from '../binding/excalidraw-binding.js';
import { exportBoard, type ExportFormat } from '../export.js';

/** The real Excalidraw functions. Casts happen here, once, at the boundary to Excalidraw's branded types. */
export const excalidrawFns: ExcalidrawFns = {
  reconcileElements: (local, remote, appState) =>
    reconcileElements(local as never, remote as never, appState as never) as unknown as readonly SyncedElement[],
  restoreElements: (elements) =>
    restoreElements(elements as never, null, { refreshDimensions: false, repairBindings: false }) as unknown as readonly SyncedElement[],
  captureNever: CaptureUpdateAction.NEVER,
};

export interface BoardHandle {
  exportAs(format: ExportFormat): Promise<Blob>;
}

export interface CollaborativeBoardProps {
  doc: Y.Doc;
  awareness: Awareness | null;
  readOnly: boolean;
  onReady?: (handle: BoardHandle) => void;
}

const hasImageFile = (event: ClipboardEvent | null): boolean =>
  Array.from(event?.clipboardData?.files ?? []).some((file) => file.type.startsWith('image/'));

export function CollaborativeBoard({ doc, awareness, readOnly, onReady }: CollaborativeBoardProps) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const bindingRef = useRef<ExcalidrawBinding | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  useEffect(() => {
    if (!api) return;
    const binding = new ExcalidrawBinding({ doc, api: api as unknown as SceneApi, awareness, fns: excalidrawFns });
    binding.setReadOnly(readOnlyRef.current);
    bindingRef.current = binding;
    onReadyRef.current?.({ exportAs: (format) => exportBoard(api, format) });
    return () => {
      binding.destroy();
      bindingRef.current = null;
    };
  }, [api, doc, awareness]);

  useEffect(() => {
    bindingRef.current?.setReadOnly(readOnly);
  }, [readOnly]);

  return (
    <div className="h-full w-full" data-testid="board">
      <Excalidraw
        excalidrawAPI={setApi}
        isCollaborating
        viewModeEnabled={readOnly}
        UIOptions={{ tools: { image: false } }}
        onChange={(elements, appState) =>
          bindingRef.current?.handleChange(elements as unknown as readonly SyncedElement[], appState)
        }
        onPointerUpdate={({ pointer }) => bindingRef.current?.handlePointer(pointer)}
        onPaste={(_data, event) => !hasImageFile(event)}
      />
    </div>
  );
}
```

**Ruling:** `repairBindings: false`. The board's elements come from peers running the same binding, and repairing bindings could rewrite elements, which would fight convergence. This deviates from Excalidraw's default; if arrows misbehave in manual testing, revisit it.

`src/lib/components/seed-board-editor.tsx`:

```tsx
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { SyncedElement } from '@swint/shared-collab-protocol';

export interface SeedBoardEditorProps {
  initialElements: readonly SyncedElement[];
  /** Live (non-deleted, non-image) elements after every scene change. */
  onChange: (elements: SyncedElement[]) => void;
}

/** A local, non-collaborative Excalidraw used to author a template's starting board. */
export function SeedBoardEditor({ initialElements, onChange }: SeedBoardEditorProps) {
  return (
    <div className="h-[420px] w-full overflow-hidden rounded-md border border-slate-300" data-testid="seed-board">
      <Excalidraw
        initialData={{ elements: initialElements as never }}
        UIOptions={{ tools: { image: false } }}
        onChange={(elements) =>
          onChange(
            elements
              .filter((e) => !e.isDeleted && e.type !== 'image')
              .map((e) => structuredClone(e) as unknown as SyncedElement),
          )
        }
      />
    </div>
  );
}
```

`src/index.ts`:

```ts
export * from './lib/binding/element-order.js';
export * from './lib/binding/board-sync.js';
export * from './lib/binding/excalidraw-binding.js';
export * from './lib/components/collaborative-board.js';
export * from './lib/components/seed-board-editor.js';
export * from './lib/export.js';
```

- [ ] **Step 8: Verify**

Run: `pnpm install && pnpm nx sync && pnpm nx run-many -t test lint typecheck -p web-ui-whiteboard web`
Expected: PASS. Run `web` too, because its typecheck pulls in this lib.

If `ExcalidrawImperativeAPI`'s import path differs (`@excalidraw/excalidraw/types` maps via `exports["./*"]` to `dist/types/excalidraw/*.d.ts`), adjust it.

- [ ] **Step 9: Commit**

```bash
git add libs/web/ui-whiteboard package.json pnpm-lock.yaml
git commit -m "feat(web-ui-whiteboard): Excalidraw binding with rAF throttling, presence, view mode and export

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 9: `web-ui-session-panels`: markdown, timer, presence, banner, error boundary, notes

**Files:**
- Generate: `libs/web/ui-session-panels` (tags `scope:web,type:ui`)
- Create `src/lib/`:
  - `markdown.tsx`, `panels.tsx` (InstructionsPanel, RubricPanel)
  - `timer-bar.tsx` (+ `formatClock`, `useNow`)
  - `participant-list.tsx`, `connection-banner.tsx`, `panel-boundary.tsx`, `notes-editor.tsx`
- Tests: `markdown.spec.tsx`, `timer-bar.spec.tsx`, `panels.spec.tsx`, `notes-editor.spec.tsx`

**Interfaces:**
- Consumes: `Badge`, `Button` (`@swint/web-ui-primitives`); `remainingMs`, `timerPhase`, `isFinished`, `TimerFields`, `SessionStatus` (domain); `AwarenessUser`, `getNotesFragment` (collab-protocol)
- Produces:
  - `Markdown({ source })`, `InstructionsPanel({ markdown })`, `RubricPanel({ markdown })`
  - `formatClock(ms: number): string`, `useNow(intervalMs?: number): number`
  - `TimerBar({ status, timer, offsetMs })`, which renders `role="timer"` with `data-phase` = `not-started | normal | warning | critical | overtime | ended`
  - `ParticipantList({ participants: AwarenessUser[] })`
  - `type BannerState = 'connecting' | 'reconnecting' | 'unreachable' | null`; `ConnectionBanner({ state })`
  - `PanelBoundary({ title, children })`
  - `NotesEditor({ doc, awarenessProvider: { awareness: Awareness }, user: { name: string; color: string }, readOnly, onEditor? })`

- [ ] **Step 1: Generate and install**

```bash
pnpm nx g @nx/react:library --directory=libs/web/ui-session-panels --name=web-ui-session-panels --importPath=@swint/web-ui-session-panels --bundler=none --unitTestRunner=vitest --linter=eslint --tags=scope:web,type:ui --component=false --no-interactive
pnpm add -w react-markdown@^10.1.0 @tiptap/react@^3.33.0 @tiptap/pm@^3.33.0 @tiptap/core@^3.33.0 @tiptap/starter-kit@^3.33.0 @tiptap/extension-collaboration@^3.33.0 @tiptap/extension-collaboration-caret@^3.33.0 @tiptap/y-tiptap
```

Normalise to the Web library conventions. Check `@tiptap/extension-collaboration`'s peer dependencies (`pnpm view @tiptap/extension-collaboration@3.33.0 peerDependencies`) and install any missing peers at the versions they ask for.

- [ ] **Step 2: Write the failing tests**

`src/lib/timer-bar.spec.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { TimerBar, formatClock } from './timer-bar.js';

const T0 = 1_700_000_000_000;
const timer = { startedAt: T0, durationSec: 45 * 60, extensionSec: 0 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

describe('formatClock', () => {
  it.each([
    [0, '00:00'],
    [61_000, '01:01'],
    [45 * 60_000, '45:00'],
    [3_725_000, '1:02:05'],
    [-90_000, '01:30'],
  ])('%i ms -> %s', (ms, text) => expect(formatClock(ms)).toBe(text));
});

describe('TimerBar', () => {
  it('counts down using the server offset and moves through warning, critical, overtime', () => {
    render(<TimerBar status="live" timer={timer} offsetMs={0} />);
    expect(screen.getByRole('timer')).toHaveTextContent('45:00 left');
    expect(screen.getByRole('timer')).toHaveAttribute('data-phase', 'normal');
    act(() => vi.advanceTimersByTime(36 * 60_000));
    expect(screen.getByRole('timer')).toHaveAttribute('data-phase', 'warning');
    act(() => vi.advanceTimersByTime(8 * 60_000));
    expect(screen.getByRole('timer')).toHaveAttribute('data-phase', 'critical');
    act(() => vi.advanceTimersByTime(2 * 60_000));
    expect(screen.getByRole('timer')).toHaveAttribute('data-phase', 'overtime');
    expect(screen.getByRole('timer')).toHaveTextContent('+01:00 overtime');
  });

  it('applies the server clock offset', () => {
    render(<TimerBar status="live" timer={timer} offsetMs={60_000} />);
    expect(screen.getByRole('timer')).toHaveTextContent('44:00 left');
  });

  it('includes extensions', () => {
    render(<TimerBar status="live" timer={{ ...timer, extensionSec: 600 }} offsetMs={0} />);
    expect(screen.getByRole('timer')).toHaveTextContent('55:00 left');
  });

  it('shows the planned duration before start', () => {
    render(<TimerBar status="created" timer={{ ...timer, startedAt: null }} offsetMs={0} />);
    expect(screen.getByRole('timer')).toHaveAttribute('data-phase', 'not-started');
    expect(screen.getByRole('timer')).toHaveTextContent('Not started · 45:00');
  });

  it.each(['ended', 'cancelled'] as const)('is frozen once the session is %s, even deep into overtime', (status) => {
    render(<TimerBar status={status} timer={timer} offsetMs={0} />);
    act(() => vi.advanceTimersByTime(3 * 60 * 60_000));
    expect(screen.getByRole('timer')).toHaveAttribute('data-phase', 'ended');
    expect(screen.getByRole('timer')).toHaveTextContent('Interview ended');
    expect(screen.getByRole('timer')).not.toHaveTextContent('overtime');
  });
});
```

`src/lib/markdown.spec.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Markdown } from './markdown.js';

describe('Markdown', () => {
  it('renders markdown', () => {
    render(<Markdown source={'# Task\n\n- one\n- two'} />);
    expect(screen.getByRole('heading', { name: 'Task' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('never renders raw HTML from template authors', () => {
    const { container } = render(<Markdown source={'<script>alert(1)</script><img src=x onerror=alert(1)>'} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });
});
```

`src/lib/panels.spec.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectionBanner } from './connection-banner.js';
import { InstructionsPanel, RubricPanel } from './panels.js';
import { PanelBoundary } from './panel-boundary.js';
import { ParticipantList } from './participant-list.js';

describe('panels', () => {
  it('labels the rubric as interviewer-only', () => {
    render(<RubricPanel markdown="- scaling" />);
    expect(screen.getByText(/only interviewers can see this/i)).toBeInTheDocument();
    render(<InstructionsPanel markdown="# Go" />);
    expect(screen.getByRole('heading', { name: 'Go' })).toBeInTheDocument();
  });

  it('lists participants with role badges', () => {
    render(
      <ParticipantList
        participants={[
          { userId: 'sub-1', name: 'Ada', role: 'interviewer', color: '#1971c2', selectedElementIds: {} },
          { userId: 'candidate:s1', name: 'Bo', role: 'candidate', color: '#2f9e44', selectedElementIds: {} },
        ]}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Ada');
    expect(items[0]).toHaveTextContent('Interviewer');
    expect(items[1]).toHaveTextContent('Candidate');
  });

  it.each([
    ['connecting', /connecting/i],
    ['reconnecting', /reconnecting/i],
    ['unreachable', /can.t reach/i],
  ] as const)('banner %s', (state, text) => {
    render(<ConnectionBanner state={state} />);
    expect(screen.getByRole('status')).toHaveTextContent(text);
  });

  it('renders nothing when connected', () => {
    const { container } = render(<ConnectionBanner state={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('isolates a crashing panel', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Boom = () => {
      throw new Error('boom');
    };
    render(
      <div>
        <PanelBoundary title="Notes"><Boom /></PanelBoundary>
        <p>still here</p>
      </div>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Notes failed to load');
    expect(screen.getByText('still here')).toBeInTheDocument();
  });
});
```

`src/lib/notes-editor.spec.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import type { Editor } from '@tiptap/react';
import { getNotesFragment } from '@swint/shared-collab-protocol';
import { NotesEditor } from './notes-editor.js';

function linkedDocs() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.on('update', (u: Uint8Array) => Y.applyUpdate(b, u));
  b.on('update', (u: Uint8Array) => Y.applyUpdate(a, u));
  return { a, b };
}

describe('NotesEditor', () => {
  it('writes into the notes fragment and syncs to a peer document', async () => {
    const { a, b } = linkedDocs();
    let editor: Editor | null = null;
    render(
      <NotesEditor doc={a} awarenessProvider={{ awareness: new Awareness(a) }} user={{ name: 'Ada', color: '#1971c2' }} readOnly={false} onEditor={(e) => (editor = e)} />,
    );
    await act(async () => undefined);
    act(() => {
      editor?.commands.insertContent('hello notes');
    });
    expect(getNotesFragment(b).toString()).toContain('hello notes');
  });

  it('is not editable when read-only', async () => {
    const doc = new Y.Doc();
    let editor: Editor | null = null;
    render(
      <NotesEditor doc={doc} awarenessProvider={{ awareness: new Awareness(doc) }} user={{ name: 'Ada', color: '#1971c2' }} readOnly onEditor={(e) => (editor = e)} />,
    );
    await act(async () => undefined);
    expect(editor?.isEditable).toBe(false);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm nx test web-ui-session-panels`
Expected: FAIL (modules missing).

- [ ] **Step 4: Implement**

`markdown.tsx`:

```tsx
import ReactMarkdown from 'react-markdown';

const prose =
  'text-sm leading-6 text-slate-800 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold ' +
  '[&_h3]:mt-3 [&_h3]:font-semibold [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 ' +
  '[&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:bg-slate-100 [&_pre]:p-3 [&_a]:text-blue-700 [&_a]:underline';

/** Markdown from templates. Raw HTML is not rendered (react-markdown's default without rehype-raw). */
export function Markdown({ source }: { source: string }) {
  return (
    <div className={prose}>
      <ReactMarkdown skipHtml>{source}</ReactMarkdown>
    </div>
  );
}
```

`panels.tsx`:

```tsx
import { Markdown } from './markdown.js';

export function InstructionsPanel({ markdown }: { markdown: string }) {
  return (
    <section aria-label="Instructions" className="p-4">
      <Markdown source={markdown} />
    </section>
  );
}

export function RubricPanel({ markdown }: { markdown: string }) {
  return (
    <section aria-label="Rubric" className="p-4">
      <p className="mb-3 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">Only interviewers can see this.</p>
      <Markdown source={markdown} />
    </section>
  );
}
```

`timer-bar.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { isFinished, remainingMs, timerPhase, type SessionStatus, type TimerFields } from '@swint/shared-domain';
import { cn } from '@swint/web-ui-primitives';

export function formatClock(ms: number): string {
  const total = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function useNow(intervalMs = 500): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const phaseClass = {
  'not-started': 'bg-slate-100 text-slate-700',
  normal: 'bg-slate-100 text-slate-900',
  warning: 'bg-amber-100 text-amber-900',
  critical: 'bg-red-100 text-red-800',
  overtime: 'bg-red-600 text-white',
  ended: 'bg-slate-200 text-slate-700',
} as const;

export interface TimerBarProps {
  status: SessionStatus;
  timer: TimerFields;
  /** serverNow - clientNow, from session.state. */
  offsetMs: number;
}

/** Spec §6 timer: warnings at 10 and 2 minutes, overtime below zero, frozen once the session is finished. */
export function TimerBar({ status, timer, offsetMs }: TimerBarProps) {
  const now = useNow();
  let phase: keyof typeof phaseClass;
  let label: string;
  if (isFinished(status)) {
    phase = 'ended';
    label = 'Interview ended';
  } else if (status === 'created' || timer.startedAt === null) {
    phase = 'not-started';
    label = `Not started · ${formatClock((timer.durationSec + timer.extensionSec) * 1000)}`;
  } else {
    const remaining = remainingMs(timer, now + offsetMs) ?? 0;
    phase = timerPhase(remaining) as keyof typeof phaseClass;
    label = remaining < 0 ? `+${formatClock(remaining)} overtime` : `${formatClock(remaining)} left`;
  }
  return (
    <span role="timer" data-phase={phase} className={cn('rounded-md px-3 py-1 font-mono text-sm font-semibold tabular-nums', phaseClass[phase])}>
      {label}
    </span>
  );
}
```

`participant-list.tsx`:

```tsx
import type { AwarenessUser } from '@swint/shared-collab-protocol';
import { Badge } from '@swint/web-ui-primitives';

export function ParticipantList({ participants }: { participants: AwarenessUser[] }) {
  return (
    <ul aria-label="Participants" className="flex items-center gap-2">
      {participants.map((p) => (
        <li key={p.userId} className="flex items-center gap-1 text-sm">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} />
          <span>{p.name}</span>
          <Badge tone={p.role === 'interviewer' ? 'info' : 'success'}>{p.role === 'interviewer' ? 'Interviewer' : 'Candidate'}</Badge>
        </li>
      ))}
    </ul>
  );
}
```

`connection-banner.tsx`:

```tsx
export type BannerState = 'connecting' | 'reconnecting' | 'unreachable' | null;

const text: Record<Exclude<BannerState, null>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting… your changes are kept and will sync when the connection is back.',
  unreachable: "Can't reach the collaboration server. Retrying…",
};

export function ConnectionBanner({ state }: { state: BannerState }) {
  if (!state) return null;
  return (
    <div role="status" className={state === 'unreachable' ? 'bg-red-50 px-4 py-2 text-sm text-red-800' : 'bg-amber-50 px-4 py-2 text-sm text-amber-900'}>
      {text[state]}
    </div>
  );
}
```

`panel-boundary.tsx`:

```tsx
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  failed: boolean;
}

/** Spec §8: one error boundary per panel, so one broken panel doesn't take down the room. */
export class PanelBoundary extends Component<{ title: string; children: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`${this.props.title} panel crashed`, error, info.componentStack);
  }

  override render() {
    if (this.state.failed) {
      return (
        <div role="alert" className="m-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {this.props.title} failed to load.{' '}
          <button type="button" className="underline" onClick={() => this.setState({ failed: false })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

`notes-editor.tsx`:

```tsx
import { useEffect } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { getNotesFragment } from '@swint/shared-collab-protocol';

export interface NotesEditorProps {
  doc: Y.Doc;
  /** Anything with an `awareness` (the Hocuspocus provider in the app). */
  awarenessProvider: { awareness: Awareness };
  user: { name: string; color: string };
  readOnly: boolean;
  onEditor?: (editor: Editor) => void;
}

/** Shared interviewer notes (spec §2: TipTap + Collaboration + collaboration caret). */
export function NotesEditor({ doc, awarenessProvider, user, readOnly, onEditor }: NotesEditorProps) {
  const editor = useEditor(
    {
      extensions: [
        // The Collaboration extension brings its own Yjs-aware undo; TipTap's history must be off.
        StarterKit.configure({ undoRedo: false }),
        Collaboration.configure({ fragment: getNotesFragment(doc) }),
        CollaborationCaret.configure({ provider: awarenessProvider, user }),
      ],
      editable: !readOnly,
      editorProps: { attributes: { class: 'min-h-[12rem] p-4 text-sm outline-none', 'aria-label': 'Interviewer notes' } },
    },
    [doc, awarenessProvider],
  );

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  useEffect(() => {
    if (editor) onEditor?.(editor);
  }, [editor, onEditor]);

  return <EditorContent editor={editor} />;
}
```

The notes doc's awareness `user` field only needs `{ name, color }` for TipTap's caret. The server's stamping (Task 3) adds the identity fields, so that's harmless.

`src/index.ts`:

```ts
export * from './lib/markdown.js';
export * from './lib/panels.js';
export * from './lib/timer-bar.js';
export * from './lib/participant-list.js';
export * from './lib/connection-banner.js';
export * from './lib/panel-boundary.js';
export * from './lib/notes-editor.js';
```

If TipTap needs DOM APIs jsdom lacks (e.g. `elementFromPoint`, `getClientRects`), stub them in `src/test-setup.ts`, for example `Range.prototype.getClientRects = () => [] as unknown as DOMRectList;`. Don't skip the tests.

- [ ] **Step 5: Verify**

Run: `pnpm install && pnpm nx sync && pnpm nx run-many -t test lint typecheck -p web-ui-session-panels`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libs/web/ui-session-panels package.json pnpm-lock.yaml tsconfig.json
git commit -m "feat(web-ui-session-panels): markdown, frozen-when-ended timer, presence, banner, panel boundary, notes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: `web-feature-dashboard`: auth gate, header, sessions, templates, create session

**Files:**
- Generate: `libs/web/feature-dashboard` (tags `scope:web,type:feature`)
- Create `src/lib/`:
  - `require-interviewer.tsx` (RequireInterviewer, useMe)
  - `app-header.tsx`, `interviewer-layout.tsx`
  - `dashboard-page.tsx`, `sessions-section.tsx`, `templates-section.tsx`, `create-session-dialog.tsx`
- Tests: `require-interviewer.spec.tsx`, `dashboard-page.spec.tsx`, `app-header.spec.tsx`

**Interfaces:**
- Consumes: `useOrpc`, `useApi`, `apiError`, `loginUrl`, `logout`, `navigation` (Task 6); `fakeApi`, `orpcError`, `renderWithApi` (Task 6 testing); primitives (Task 5); `Me`, `SessionSummary`, `TemplateSummary`, `CreateSessionOutput` (api-contract)
- Produces:
  - `RequireInterviewer({ children })`, `useMe(): Me`
  - `InterviewerLayout()`, which wraps `<Outlet/>` in `RequireInterviewer` + `AppHeader`
  - `AppHeader()`, `DashboardPage()`

- [ ] **Step 1: Generate**

```bash
pnpm nx g @nx/react:library --directory=libs/web/feature-dashboard --name=web-feature-dashboard --importPath=@swint/web-feature-dashboard --bundler=none --unitTestRunner=vitest --linter=eslint --tags=scope:web,type:feature --component=false --no-interactive
```

Normalise it. Runtime deps: `react`, `react-router`, `@tanstack/react-query`, `@swint/web-data-access-api`, `@swint/web-ui-primitives`, `@swint/shared-api-contract`.

- [ ] **Step 2: Write the failing tests**

`src/lib/require-interviewer.spec.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { navigation } from '@swint/web-data-access-api';
import { fakeApi, orpcError, renderWithApi } from '@swint/web-data-access-api/testing';
import { RequireInterviewer, useMe } from './require-interviewer.js';

const me = { sub: 'sub-1', name: 'Ada', email: null, orgId: 'default', roles: ['interviewer'] };
function WhoAmI() {
  return <p>hello {useMe().name}</p>;
}

afterEach(() => vi.restoreAllMocks());

describe('RequireInterviewer', () => {
  it('renders children with the current user', async () => {
    renderWithApi(<RequireInterviewer><WhoAmI /></RequireInterviewer>, { api: fakeApi({ me: { get: async () => me } }) });
    expect(await screen.findByText('hello Ada')).toBeInTheDocument();
  });

  it('sends anonymous visitors to the login page, returning to where they were', async () => {
    const assign = vi.spyOn(navigation, 'assign').mockImplementation(() => undefined);
    renderWithApi(<RequireInterviewer><WhoAmI /></RequireInterviewer>, {
      api: fakeApi({ me: { get: async () => { throw orpcError('UNAUTHORIZED'); } } }),
      path: '/templates/new?x=1',
    });
    expect(await screen.findByText(/redirecting to sign-in/i)).toBeInTheDocument();
    expect(assign).toHaveBeenCalledWith('/auth/login?returnTo=%2Ftemplates%2Fnew%3Fx%3D1');
  });

  it('explains when the account is not allowed', async () => {
    renderWithApi(<RequireInterviewer><WhoAmI /></RequireInterviewer>, {
      api: fakeApi({ me: { get: async () => { throw orpcError('FORBIDDEN'); } } }),
    });
    expect(await screen.findByRole('heading', { name: /no access/i })).toBeInTheDocument();
  });
});
```

`src/lib/dashboard-page.spec.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeApi, renderWithApi } from '@swint/web-data-access-api/testing';
import { DashboardPage } from './dashboard-page.js';

const sessions = [
  { id: 's1', title: 'URL shortener', candidateName: 'Ada', status: 'live', startedAt: 1, createdAt: 1_700_000_000_000 },
  { id: 's2', title: 'Chat app', candidateName: 'Bo', status: 'ended', startedAt: 1, createdAt: 1_700_000_100_000 },
];
const templates = [{ id: 't1', title: 'URL shortener', durationMin: 45, archived: false, updatedAt: 1_700_000_000_000 }];

function api(overrides: Record<string, Record<string, (...a: never[]) => unknown>> = {}) {
  return {
    sessions: { list: vi.fn(async () => sessions), create: vi.fn(), ...overrides['sessions'] },
    templates: { list: vi.fn(async () => templates), archive: vi.fn(async () => ({ ...templates[0], archived: true })), ...overrides['templates'] },
  };
}

describe('DashboardPage', () => {
  it('lists sessions (linking to their rooms) and templates (linking to the editor)', async () => {
    const a = api();
    renderWithApi(<DashboardPage />, { api: fakeApi(a) });
    const sessionsTable = await screen.findByRole('table', { name: 'Sessions' });
    expect(within(sessionsTable).getByRole('link', { name: /Ada/ })).toHaveAttribute('href', '/s/s1');
    expect(within(sessionsTable).getByText('ended')).toBeInTheDocument();
    const templatesTable = screen.getByRole('table', { name: 'Templates' });
    expect(within(templatesTable).getByRole('link', { name: 'URL shortener' })).toHaveAttribute('href', '/templates/t1');
    expect(screen.getByRole('link', { name: 'New template' })).toHaveAttribute('href', '/templates/new');
    expect(a.templates.list).toHaveBeenCalledWith({ includeArchived: false }, expect.anything());
  });

  it('filters sessions by status', async () => {
    const a = api();
    renderWithApi(<DashboardPage />, { api: fakeApi(a) });
    await screen.findByRole('table', { name: 'Sessions' });
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'live');
    await waitFor(() => expect(a.sessions.list).toHaveBeenLastCalledWith({ status: 'live' }, expect.anything()));
  });

  it('creates a session and shows both links', async () => {
    const a = api({
      sessions: {
        create: vi.fn(async () => ({
          session: { ...sessions[0], id: 's9' },
          candidateUrl: 'http://localhost:4200/join/tok',
          interviewerUrl: 'http://localhost:4200/s/s9',
        })),
      },
    });
    renderWithApi(<DashboardPage />, { api: fakeApi(a) });
    await userEvent.click(await screen.findByRole('button', { name: 'New session' }));
    const dialog = await screen.findByRole('dialog', { name: 'New session' });
    await userEvent.selectOptions(within(dialog).getByLabelText('Template'), 't1');
    await userEvent.type(within(dialog).getByLabelText('Candidate name'), 'Grace');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create session' }));
    expect(a.sessions.create).toHaveBeenCalledWith({ templateId: 't1', candidateName: 'Grace' }, expect.anything());
    expect(await within(dialog).findByLabelText('Candidate link')).toHaveValue('http://localhost:4200/join/tok');
    expect(within(dialog).getByLabelText('Interviewer link')).toHaveValue('http://localhost:4200/s/s9');
    expect(within(dialog).getByRole('link', { name: 'Open room' })).toHaveAttribute('href', '/s/s9');
  });

  it('archives a template after confirmation', async () => {
    const a = api();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithApi(<DashboardPage />, { api: fakeApi(a) });
    await userEvent.click(await screen.findByRole('button', { name: 'Archive URL shortener' }));
    expect(a.templates.archive).toHaveBeenCalledWith({ id: 't1' }, expect.anything());
  });
});
```

oRPC passes a second options argument (`{ signal, context }`) to procedure calls, hence the `expect.anything()`. If calls arrive with a single argument, drop it.

`src/lib/app-header.spec.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { navigation } from '@swint/web-data-access-api';
import { fakeApi, renderWithApi } from '@swint/web-data-access-api/testing';
import { InterviewerLayout } from './interviewer-layout.js';

describe('InterviewerLayout / AppHeader', () => {
  it('shows the user and logs out through the API', async () => {
    const assign = vi.spyOn(navigation, 'assign').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ redirectUrl: 'http://kc/logout' }), { status: 200 })));
    renderWithApi(<InterviewerLayout />, {
      api: fakeApi({ me: { get: async () => ({ sub: 's', name: 'Ada', email: null, orgId: 'default', roles: ['interviewer'] }) } }),
    });
    expect(await screen.findByText('Ada')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(assign).toHaveBeenCalledWith('http://kc/logout');
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm nx test web-feature-dashboard`
Expected: FAIL.

- [ ] **Step 4: Implement**

`require-interviewer.tsx`:

```tsx
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router';
import type { Me } from '@swint/shared-api-contract';
import { apiError, loginUrl, navigation, useOrpc } from '@swint/web-data-access-api';
import { Button, Screen, Spinner } from '@swint/web-ui-primitives';

const MeContext = createContext<Me | null>(null);

export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe must be used inside <RequireInterviewer>');
  return me;
}

/** Interviewer-only pages: anonymous visitors go through Keycloak and come back here. */
export function RequireInterviewer({ children }: { children: ReactNode }) {
  const orpc = useOrpc();
  const location = useLocation();
  const me = useQuery(orpc.me.get.queryOptions());
  const code = apiError(me.error)?.code;
  const returnTo = location.pathname + location.search;

  useEffect(() => {
    if (code === 'UNAUTHORIZED') navigation.assign(loginUrl(returnTo));
  }, [code, returnTo]);

  if (me.isPending) return <Screen title="Loading…"><Spinner /></Screen>;
  if (code === 'UNAUTHORIZED') return <Screen title="Redirecting to sign-in…" />;
  if (code === 'FORBIDDEN') return <Screen title="No access">Your account is not allowed to use Swint.</Screen>;
  if (me.isError) {
    return (
      <Screen title="Something went wrong" actions={<Button onClick={() => void me.refetch()}>Retry</Button>}>
        We couldn&apos;t load your account.
      </Screen>
    );
  }
  return <MeContext.Provider value={me.data}>{children}</MeContext.Provider>;
}
```

`app-header.tsx`:

```tsx
import { Link } from 'react-router';
import { logout, navigation } from '@swint/web-data-access-api';
import { Button } from '@swint/web-ui-primitives';
import { useMe } from './require-interviewer.js';

export function AppHeader() {
  const me = useMe();
  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
      <Link to="/" className="text-lg font-semibold">Swint</Link>
      <div className="flex items-center gap-3 text-sm">
        <span>{me.name}</span>
        <Button variant="ghost" size="sm" onClick={async () => navigation.assign(await logout())}>Sign out</Button>
      </div>
    </header>
  );
}
```

`interviewer-layout.tsx`:

```tsx
import { Outlet } from 'react-router';
import { AppHeader } from './app-header.js';
import { RequireInterviewer } from './require-interviewer.js';

export function InterviewerLayout() {
  return (
    <RequireInterviewer>
      <div className="min-h-full">
        <AppHeader />
        <Outlet />
      </div>
    </RequireInterviewer>
  );
}
```

`sessions-section.tsx`:

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { SessionStatus } from '@swint/shared-domain';
import { useOrpc } from '@swint/web-data-access-api';
import { Badge, Spinner } from '@swint/web-ui-primitives';

const tone = { created: 'neutral', live: 'success', ended: 'info', cancelled: 'danger' } as const;
const STATUSES: SessionStatus[] = ['created', 'live', 'ended', 'cancelled'];

export function SessionsSection() {
  const orpc = useOrpc();
  const [status, setStatus] = useState<SessionStatus | ''>('');
  const sessions = useQuery(orpc.sessions.list.queryOptions({ input: status ? { status } : {} }));
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Sessions</h2>
        <label className="text-sm">
          Status{' '}
          <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as SessionStatus | '')} className="rounded border border-slate-300 px-2 py-1">
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>
      {sessions.isPending ? <Spinner /> : null}
      {sessions.isError ? <p role="alert" className="text-sm text-red-700">Could not load sessions.</p> : null}
      {sessions.data ? (
        <table aria-label="Sessions" className="w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr><th className="py-2">Candidate</th><th>Template</th><th>Status</th><th>Created</th></tr>
          </thead>
          <tbody>
            {sessions.data.map((s) => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="py-2"><Link className="text-blue-700 hover:underline" to={`/s/${s.id}`}>{s.candidateName}</Link></td>
                <td>{s.title}</td>
                <td><Badge tone={tone[s.status]}>{s.status}</Badge></td>
                <td>{new Date(s.createdAt).toLocaleString()}</td>
              </tr>
            ))}
            {sessions.data.length === 0 ? <tr><td colSpan={4} className="py-4 text-slate-500">No sessions yet.</td></tr> : null}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
```

`templates-section.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useOrpc } from '@swint/web-data-access-api';
import { Button, Spinner } from '@swint/web-ui-primitives';

export function TemplatesSection() {
  const orpc = useOrpc();
  const queryClient = useQueryClient();
  const templates = useQuery(orpc.templates.list.queryOptions({ input: { includeArchived: false } }));
  const archive = useMutation(
    orpc.templates.archive.mutationOptions({ onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.templates.key() }) }),
  );
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Templates</h2>
        <Link to="/templates/new" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-100">New template</Link>
      </div>
      {templates.isPending ? <Spinner /> : null}
      {templates.isError ? <p role="alert" className="text-sm text-red-700">Could not load templates.</p> : null}
      {templates.data ? (
        <table aria-label="Templates" className="w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr><th className="py-2">Title</th><th>Duration</th><th>Updated</th><th /></tr>
          </thead>
          <tbody>
            {templates.data.map((t) => (
              <tr key={t.id} className="border-t border-slate-100">
                <td className="py-2"><Link className="text-blue-700 hover:underline" to={`/templates/${t.id}`}>{t.title}</Link></td>
                <td>{t.durationMin} min</td>
                <td>{new Date(t.updatedAt).toLocaleString()}</td>
                <td className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Archive ${t.title}`}
                    disabled={archive.isPending}
                    onClick={() => {
                      if (window.confirm(`Archive "${t.title}"? Existing sessions are not affected.`)) archive.mutate({ id: t.id });
                    }}
                  >
                    Archive
                  </Button>
                </td>
              </tr>
            ))}
            {templates.data.length === 0 ? <tr><td colSpan={4} className="py-4 text-slate-500">No templates yet.</td></tr> : null}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
```

`create-session-dialog.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { apiError, useOrpc } from '@swint/web-data-access-api';
import { Button, CopyField, Dialog } from '@swint/web-ui-primitives';

export function CreateSessionDialog() {
  const orpc = useOrpc();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState('');
  const [candidateName, setCandidateName] = useState('');
  const templates = useQuery({ ...orpc.templates.list.queryOptions({ input: { includeArchived: false } }), enabled: open });
  const create = useMutation(
    orpc.sessions.create.mutationOptions({ onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.sessions.key() }) }),
  );

  const reset = (next: boolean) => {
    setOpen(next);
    if (!next) {
      create.reset();
      setTemplateId('');
      setCandidateName('');
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({ templateId, candidateName });
  };

  return (
    <>
      <Button onClick={() => reset(true)}>New session</Button>
      <Dialog open={open} onOpenChange={reset} title="New session" description="Pick a template and share the links.">
        {create.data ? (
          <div className="space-y-4">
            <CopyField label="Candidate link" value={create.data.candidateUrl} />
            <CopyField label="Interviewer link" value={create.data.interviewerUrl} />
            <p className="text-xs text-slate-500">Send the candidate link only to the candidate. Anyone with it can join as the candidate.</p>
            <Link to={`/s/${create.data.session.id}`} className="inline-block rounded-md bg-blue-600 px-4 py-2 text-white">Open room</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <label className="block text-sm">
              Template
              <select aria-label="Template" required value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5">
                <option value="" disabled>Choose a template…</option>
                {templates.data?.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </label>
            <label className="block text-sm">
              Candidate name
              <input aria-label="Candidate name" required maxLength={100} value={candidateName} onChange={(e) => setCandidateName(e.target.value)} className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5" />
            </label>
            {create.isError ? <p role="alert" className="text-sm text-red-700">{apiError(create.error)?.message ?? 'Could not create the session.'}</p> : null}
            <Button type="submit" disabled={create.isPending || !templateId || !candidateName.trim()}>Create session</Button>
          </form>
        )}
      </Dialog>
    </>
  );
}
```

`dashboard-page.tsx`:

```tsx
import { CreateSessionDialog } from './create-session-dialog.js';
import { SessionsSection } from './sessions-section.js';
import { TemplatesSection } from './templates-section.js';

export function DashboardPage() {
  return (
    <main className="mx-auto max-w-5xl space-y-10 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Interviews</h1>
        <CreateSessionDialog />
      </div>
      <SessionsSection />
      <TemplatesSection />
    </main>
  );
}
```

`src/index.ts`:

```ts
export * from './lib/require-interviewer.js';
export * from './lib/app-header.js';
export * from './lib/interviewer-layout.js';
export * from './lib/dashboard-page.js';
```

Status badges show the raw status string (`live`, `ended`, …). The dashboard test relies on that.

- [ ] **Step 5: Verify and commit**

Run: `pnpm install && pnpm nx sync && pnpm nx run-many -t test lint typecheck -p web-feature-dashboard`
Expected: PASS.

```bash
git add libs/web/feature-dashboard package.json pnpm-lock.yaml tsconfig.json
git commit -m "feat(web-feature-dashboard): interviewer gate, header, sessions and templates, create-session flow

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: `web-feature-template-editor`

**Files:**
- Generate: `libs/web/feature-template-editor` (tags `scope:web,type:feature`)
- Create: `src/lib/template-editor-page.tsx`, `src/lib/markdown-field.tsx`, `src/lib/template-editor-page.spec.tsx`

**Interfaces:**
- Consumes: `useApi`, `useOrpc`, `apiError` (Task 6); `SeedBoardEditor` (Task 8); `Markdown` (Task 9); `templateInputSchema`, `Template`, `TemplateInput` (api-contract); `SyncedElement` (collab-protocol)
- Produces: `TemplateEditorPage()`. It reads `:templateId` from the route; when absent it creates a new template. `MarkdownField({ label, value, onChange, rows? })`.

Behaviour:
- **Create:** `boardSeed` is `{ elements }` when the board has elements, otherwise `null`.
- **Update:** `boardSeed` is `{ elements }` only if the board changed (by an id:version signature), otherwise `null`, meaning keep the current one (`templateInputSchema` doc comment).
- **Validation:** `templateInputSchema.safeParse` runs before any request. Field errors show next to the fields.
- **Last-write-wins guard:** before `update`, call `templates.get`. If `updatedAt` differs from the loaded one, `window.confirm('This template was changed by someone else since you opened it. Overwrite their changes?')`, and abort if declined.
- **After saving:** invalidate `orpc.templates.key()` and navigate to `/`.

- [ ] **Step 1: Generate**

```bash
pnpm nx g @nx/react:library --directory=libs/web/feature-template-editor --name=web-feature-template-editor --importPath=@swint/web-feature-template-editor --bundler=none --unitTestRunner=vitest --linter=eslint --tags=scope:web,type:feature --component=false --no-interactive
```

Normalise it. Runtime deps: `react`, `react-router`, `@tanstack/react-query`, `zod`, `@swint/web-data-access-api`, `@swint/web-ui-primitives`, `@swint/web-ui-whiteboard`, `@swint/web-ui-session-panels`, `@swint/shared-api-contract`, `@swint/shared-collab-protocol`.

- [ ] **Step 2: Write the failing tests**

`src/lib/template-editor-page.spec.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeApi, renderWithApi } from '@swint/web-data-access-api/testing';

const drawn = { id: 'e1', type: 'rectangle', version: 2, versionNonce: 3, index: 'a0', isDeleted: false, x: 0, y: 0, width: 5, height: 5 };

vi.mock('@swint/web-ui-whiteboard', () => ({
  SeedBoardEditor: ({ initialElements, onChange }: { initialElements: unknown[]; onChange: (e: unknown[]) => void }) => (
    <div>
      <span data-testid="seed-count">{initialElements.length}</span>
      <button type="button" onClick={() => onChange(initialElements)}>noop-change</button>
      <button type="button" onClick={() => onChange([...initialElements, drawn])}>draw</button>
    </div>
  ),
}));

const { TemplateEditorPage } = await import('./template-editor-page.js');

const existing = {
  id: 't1', title: 'URL shortener', instructionsMd: '# Go', rubricMd: '- x', durationMin: 45,
  hasBoardSeed: true, archived: false, createdBy: 's', createdAt: 1, updatedAt: 100,
};
const seed = { elements: [{ ...drawn, id: 'seed1', version: 1 }] };

afterEach(() => vi.restoreAllMocks());

describe('TemplateEditorPage (new)', () => {
  it('creates a template without a board when nothing was drawn', async () => {
    const create = vi.fn(async () => existing);
    renderWithApi(<TemplateEditorPage />, { api: fakeApi({ templates: { create } }), path: '/templates/new', routePath: '/templates/new' });
    await userEvent.type(screen.getByLabelText('Title'), 'Chat app');
    await userEvent.clear(screen.getByLabelText('Duration (minutes)'));
    await userEvent.type(screen.getByLabelText('Duration (minutes)'), '60');
    await userEvent.type(screen.getByLabelText('Instructions'), 'Design a chat');
    await userEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        { title: 'Chat app', durationMin: 60, instructionsMd: 'Design a chat', rubricMd: '', boardSeed: null },
        expect.anything(),
      ),
    );
    expect(await screen.findByTestId('location')).toHaveTextContent(/^\/$/);
  });

  it('sends the drawn starting board', async () => {
    const create = vi.fn(async () => existing);
    renderWithApi(<TemplateEditorPage />, { api: fakeApi({ templates: { create } }), path: '/templates/new', routePath: '/templates/new' });
    await userEvent.type(screen.getByLabelText('Title'), 'Chat app');
    await userEvent.click(screen.getByRole('button', { name: 'draw' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect((create.mock.calls[0] as unknown[])[0]).toMatchObject({ boardSeed: { elements: [drawn] } });
  });

  it('validates before sending', async () => {
    const create = vi.fn();
    renderWithApi(<TemplateEditorPage />, { api: fakeApi({ templates: { create } }), path: '/templates/new', routePath: '/templates/new' });
    await userEvent.clear(screen.getByLabelText('Duration (minutes)'));
    await userEvent.type(screen.getByLabelText('Duration (minutes)'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Save template' }));
    expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('TemplateEditorPage (edit)', () => {
  const render = (templates: Record<string, (...a: never[]) => unknown>) =>
    renderWithApi(<TemplateEditorPage />, {
      api: fakeApi({ templates: { get: async () => existing, getSeed: async () => seed, ...templates } }),
      path: '/templates/t1',
      routePath: '/templates/:templateId',
    });

  it('loads the template and its starting board', async () => {
    render({});
    expect(await screen.findByDisplayValue('URL shortener')).toBeInTheDocument();
    expect(screen.getByTestId('seed-count')).toHaveTextContent('1');
  });

  it('keeps the current board (boardSeed null) when the board was not changed', async () => {
    const update = vi.fn(async () => existing);
    render({ update });
    await screen.findByDisplayValue('URL shortener');
    await userEvent.click(screen.getByRole('button', { name: 'noop-change' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect((update.mock.calls[0] as unknown[])[0]).toMatchObject({ id: 't1', boardSeed: null });
  });

  it('warns before overwriting a concurrent edit, and aborts if declined', async () => {
    const update = vi.fn(async () => existing);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    let calls = 0;
    renderWithApi(<TemplateEditorPage />, {
      api: fakeApi({
        templates: {
          get: async () => (calls++ === 0 ? existing : { ...existing, updatedAt: 200 }),
          getSeed: async () => seed,
          update,
        },
      }),
      path: '/templates/t1',
      routePath: '/templates/:templateId',
    });
    await screen.findByDisplayValue('URL shortener');
    await userEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm nx test web-feature-template-editor`
Expected: FAIL.

- [ ] **Step 4: Implement**

`markdown-field.tsx`:

```tsx
import { useId, useState } from 'react';
import { Markdown } from '@swint/web-ui-session-panels';

export interface MarkdownFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  error?: string;
}

export function MarkdownField({ label, value, onChange, rows = 10, error }: MarkdownFieldProps) {
  const id = useId();
  const [preview, setPreview] = useState(false);
  return (
    <div>
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-sm font-medium">{label}</label>
        <button type="button" className="text-xs text-blue-700 underline" onClick={() => setPreview((p) => !p)}>
          {preview ? 'Edit' : 'Preview'}
        </button>
      </div>
      {preview ? (
        <div className="mt-1 min-h-[8rem] rounded-md border border-slate-200 bg-white p-3"><Markdown source={value} /></div>
      ) : (
        <textarea id={id} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 p-2 font-mono text-sm" />
      )}
      {error ? <p role="alert" className="mt-1 text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
```

`template-editor-page.tsx`:

```tsx
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { templateInputSchema, type Template } from '@swint/shared-api-contract';
import type { SyncedElement } from '@swint/shared-collab-protocol';
import { apiError, useApi, useOrpc } from '@swint/web-data-access-api';
import { Button, Screen, Spinner } from '@swint/web-ui-primitives';
import { SeedBoardEditor } from '@swint/web-ui-whiteboard';
import { MarkdownField } from './markdown-field.js';

const signature = (elements: readonly SyncedElement[]) =>
  elements.map((e) => `${e.id}:${e.version}`).sort().join('|');

type FieldErrors = Partial<Record<'title' | 'durationMin' | 'instructionsMd' | 'rubricMd' | 'boardSeed', string>>;

interface FormState {
  title: string;
  durationMin: string;
  instructionsMd: string;
  rubricMd: string;
}

const EMPTY: FormState = { title: '', durationMin: '45', instructionsMd: '', rubricMd: '' };

export function TemplateEditorPage() {
  const { templateId } = useParams();
  const orpc = useOrpc();
  const template = useQuery({ ...orpc.templates.get.queryOptions({ input: { id: templateId ?? '' } }), enabled: !!templateId });
  const seed = useQuery({ ...orpc.templates.getSeed.queryOptions({ input: { id: templateId ?? '' } }), enabled: !!templateId });

  if (!templateId) return <TemplateForm loaded={null} initialElements={[]} />;
  if (template.isPending || seed.isPending) return <Screen title="Loading template…"><Spinner /></Screen>;
  if (template.isError || seed.isError) {
    const code = apiError(template.error ?? seed.error)?.code;
    return <Screen title={code === 'NOT_FOUND' ? 'Template not found' : 'Could not load the template'} />;
  }
  return <TemplateForm key={template.data.id} loaded={template.data} initialElements={seed.data.elements as SyncedElement[]} />;
}

function TemplateForm({ loaded, initialElements }: { loaded: Template | null; initialElements: SyncedElement[] }) {
  const api = useApi();
  const orpc = useOrpc();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(
    loaded
      ? { title: loaded.title, durationMin: String(loaded.durationMin), instructionsMd: loaded.instructionsMd, rubricMd: loaded.rubricMd }
      : EMPTY,
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const elementsRef = useRef<SyncedElement[]>(initialElements);
  const initialSignature = useRef(signature(initialElements));
  const [boardDirty, setBoardDirty] = useState(false);

  useEffect(() => setSaveError(null), [form]);

  const set = (key: keyof FormState) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const onBoardChange = (elements: SyncedElement[]) => {
    elementsRef.current = elements;
    setBoardDirty(signature(elements) !== initialSignature.current);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const elements = elementsRef.current;
    const sendBoard = loaded ? boardDirty : elements.length > 0;
    const parsed = templateInputSchema.safeParse({
      title: form.title,
      durationMin: Number(form.durationMin),
      instructionsMd: form.instructionsMd,
      rubricMd: form.rubricMd,
      boardSeed: sendBoard ? { elements } : null,
    });
    if (!parsed.success) {
      const fields = z.flattenError(parsed.error).fieldErrors as Record<string, string[] | undefined>;
      setErrors(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v?.[0]])) as FieldErrors);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      if (loaded) {
        const latest = await api.templates.get({ id: loaded.id });
        if (
          latest.updatedAt !== loaded.updatedAt &&
          !window.confirm('This template was changed by someone else since you opened it. Overwrite their changes?')
        ) {
          return;
        }
        await api.templates.update({ id: loaded.id, ...parsed.data });
      } else {
        await api.templates.create(parsed.data);
      }
      await queryClient.invalidateQueries({ queryKey: orpc.templates.key() });
      navigate('/');
    } catch (err) {
      setSaveError(apiError(err)?.message ?? 'Could not save the template.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-6 text-2xl font-semibold">{loaded ? 'Edit template' : 'New template'}</h1>
      <form onSubmit={submit} className="space-y-6" noValidate>
        <div className="grid grid-cols-[1fr_12rem] gap-4">
          <label className="text-sm font-medium">
            Title
            <input aria-label="Title" value={form.title} onChange={(e) => set('title')(e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5" />
            {errors.title ? <span role="alert" className="text-xs text-red-700">{errors.title}</span> : null}
          </label>
          <label className="text-sm font-medium">
            Duration (minutes)
            <input aria-label="Duration (minutes)" type="number" min={5} max={240} value={form.durationMin} onChange={(e) => set('durationMin')(e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5" />
            {errors.durationMin ? <span role="alert" className="text-xs text-red-700">{errors.durationMin}</span> : null}
          </label>
        </div>
        <MarkdownField label="Instructions" value={form.instructionsMd} onChange={set('instructionsMd')} error={errors.instructionsMd} />
        <MarkdownField label="Rubric (interviewers only)" value={form.rubricMd} onChange={set('rubricMd')} rows={6} error={errors.rubricMd} />
        <div>
          <p className="mb-1 text-sm font-medium">Starting board</p>
          <SeedBoardEditor initialElements={initialElements} onChange={onBoardChange} />
          {errors.boardSeed ? <p role="alert" className="text-xs text-red-700">{errors.boardSeed}</p> : null}
        </div>
        {saveError ? <p role="alert" className="text-sm text-red-700">{saveError}</p> : null}
        <div className="flex gap-3">
          <Button type="submit" disabled={saving}>Save template</Button>
          <Button variant="secondary" onClick={() => navigate('/')}>Cancel</Button>
        </div>
      </form>
    </main>
  );
}
```

The `MarkdownField` label `Instructions` must match the test's `getByLabelText('Instructions')`. The rubric field's label is `Rubric (interviewers only)`, so it doesn't collide. `src/index.ts`: `export * from './lib/template-editor-page.js';`

- [ ] **Step 5: Verify and commit**

Run: `pnpm install && pnpm nx sync && pnpm nx run-many -t test lint typecheck -p web-feature-template-editor`
Expected: PASS.

```bash
git add libs/web/feature-template-editor package.json pnpm-lock.yaml tsconfig.json
git commit -m "feat(web-feature-template-editor): markdown + starting-board editor with a concurrent-edit guard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 12: `web-feature-session-room`: room gate, screens, session state, interviewer controls

**Files:**
- Generate: `libs/web/feature-session-room` (tags `scope:web,type:feature`)
- Create `src/lib/`:
  - `session-state.ts` (+ `session-state.spec.ts`)
  - `screens.tsx`, `use-room.ts`, `session-controls.tsx` (+ `session-controls.spec.tsx`)
  - `live-room.tsx`, `session-room-page.tsx` (+ `session-room-page.spec.tsx`)

**Interfaces:**
- Consumes:
  - `useOrpc`, `apiError`, `loginUrl` (Task 6), and the testing helpers
  - primitives (Task 5)
  - `InstructionsPanel`, `RubricPanel`, `TimerBar`, `PanelBoundary` (Task 9)
  - `RoomView` (api-contract); `isFinished`, `SessionStatus`, `TimerFields`, `EXTENSION_MINUTES` (domain)
- Produces:
  - Session state:
    - `interface RoomSessionState { status: SessionStatus; timer: TimerFields; offsetMs: number }`
    - `mergeSessionState(current: RoomSessionState | null, incoming: { status: SessionStatus; timer: TimerFields; offsetMs?: number }): RoomSessionState`
    - `useMergedSessionState(view: RoomView, live: { message: SessionStateMessage; offsetMs: number } | null): RoomSessionState`
  - Screens and hooks:
    - `SignInRequiredScreen({ sessionId })`, `InterviewEndedScreen()`, `LinkInvalidScreen({ reason })`, `RoomUnavailableScreen()`, `WaitingRoom({ title, name })`
    - `WAITING_POLL_MS = 3000`, `useRoomQuery(sessionId, pollMs?)`
  - Components:
    - `SessionControls({ sessionId, status })`
    - `LiveRoom({ view })` (Task 13 extends it)
    - `SessionRoomPage({ pollMs? })`

**Merge rule.** `room.get` (REST) and `session.state` (WebSocket) can arrive in any order. The status rank is `created 0 < live 1 < ended = cancelled 2`. An incoming value replaces the current one when its rank is higher, or when the rank is equal and its `extensionSec` is at least the current one. The offset comes from the incoming value when it has one; otherwise the current offset is kept (default 0).

**Gate.** Check errors first, because a refetch may fail while old data is still cached:
- `UNAUTHORIZED` → `SignInRequiredScreen`
- `FORBIDDEN` with reason `session_ended` → `InterviewEndedScreen`
- other `FORBIDDEN`, or `NOT_FOUND` → `RoomUnavailableScreen`
- otherwise, with data: a candidate in `created` → `WaitingRoom` (polls); everyone else → `LiveRoom`
- otherwise, pending → loading
- any other error → generic error screen with a Retry button

- [ ] **Step 1: Generate**

```bash
pnpm nx g @nx/react:library --directory=libs/web/feature-session-room --name=web-feature-session-room --importPath=@swint/web-feature-session-room --bundler=none --unitTestRunner=vitest --linter=eslint --tags=scope:web,type:feature --component=false --no-interactive
```

Normalise it. Runtime deps (Task 13 adds more): `react`, `react-router`, `@tanstack/react-query`, `@swint/web-data-access-api`, `@swint/web-ui-primitives`, `@swint/web-ui-session-panels`, `@swint/shared-api-contract`, `@swint/shared-domain`, `@swint/shared-collab-protocol`.

- [ ] **Step 2: Write the failing tests**

`src/lib/session-state.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mergeSessionState } from './session-state.js';

const timer = (extensionSec = 0, startedAt: number | null = 1000) => ({ startedAt, durationSec: 2700, extensionSec });

describe('mergeSessionState', () => {
  it('starts from the first value, offset defaulting to 0', () => {
    expect(mergeSessionState(null, { status: 'created', timer: timer(0, null) })).toEqual({ status: 'created', timer: timer(0, null), offsetMs: 0 });
  });

  it('never regresses status (a stale REST view after a live end message)', () => {
    const ended = mergeSessionState(null, { status: 'ended', timer: timer(), offsetMs: 50 });
    expect(mergeSessionState(ended, { status: 'live', timer: timer() })).toEqual({ status: 'ended', timer: timer(), offsetMs: 50 });
  });

  it('accepts progress and extensions, keeping the last known offset', () => {
    const live = mergeSessionState(null, { status: 'live', timer: timer(), offsetMs: 120 });
    expect(mergeSessionState(live, { status: 'live', timer: timer(300) })).toEqual({ status: 'live', timer: timer(300), offsetMs: 120 });
    expect(mergeSessionState(live, { status: 'live', timer: timer(300), offsetMs: 80 }).offsetMs).toBe(80);
  });

  it('ignores an older extension count at the same status', () => {
    const extended = mergeSessionState(null, { status: 'live', timer: timer(600) });
    expect(mergeSessionState(extended, { status: 'live', timer: timer(300) }).timer.extensionSec).toBe(600);
  });

  it('created → live → cancelled', () => {
    let s = mergeSessionState(null, { status: 'created', timer: timer(0, null) });
    s = mergeSessionState(s, { status: 'live', timer: timer() });
    s = mergeSessionState(s, { status: 'cancelled', timer: timer() });
    expect(s.status).toBe('cancelled');
  });
});
```

`src/lib/session-controls.spec.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeApi, orpcError, renderWithApi } from '@swint/web-data-access-api/testing';
import { SessionControls } from './session-controls.js';

afterEach(() => vi.restoreAllMocks());
const ok = async () => ({});

describe('SessionControls', () => {
  it('offers Start, Cancel and a new candidate link before the interview starts', async () => {
    const start = vi.fn(ok);
    renderWithApi(<SessionControls sessionId="s1" status="created" />, { api: fakeApi({ sessions: { start } }) });
    expect(screen.queryByRole('button', { name: /\+5 min/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start interview' }));
    expect(start).toHaveBeenCalledWith({ id: 's1' }, expect.anything());
    expect(screen.getByRole('button', { name: 'Cancel…' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New candidate link' })).toBeInTheDocument();
  });

  it('extends by 5 and 10 minutes while live', async () => {
    const extend = vi.fn(ok);
    renderWithApi(<SessionControls sessionId="s1" status="live" />, { api: fakeApi({ sessions: { extend } }) });
    await userEvent.click(screen.getByRole('button', { name: '+5 min' }));
    await userEvent.click(screen.getByRole('button', { name: '+10 min' }));
    expect(extend.mock.calls.map((c) => (c as unknown[])[0])).toEqual([{ id: 's1', minutes: 5 }, { id: 's1', minutes: 10 }]);
  });

  it('ends only after confirmation', async () => {
    const end = vi.fn(ok);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderWithApi(<SessionControls sessionId="s1" status="live" />, { api: fakeApi({ sessions: { end } }) });
    await userEvent.click(screen.getByRole('button', { name: 'End interview' }));
    expect(end).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'End interview' }));
    expect(end).toHaveBeenCalledWith({ id: 's1' }, expect.anything());
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('cancels with an optional private reason', async () => {
    const cancel = vi.fn(ok);
    renderWithApi(<SessionControls sessionId="s1" status="live" />, { api: fakeApi({ sessions: { cancel } }) });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancel interview' });
    await userEvent.type(within(dialog).getByLabelText(/reason/i), 'no-show');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel interview' }));
    expect(cancel).toHaveBeenCalledWith({ id: 's1', reason: 'no-show' }, expect.anything());
  });

  it('regenerates the candidate link and shows it', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const regenerateInvite = vi.fn(async () => ({ candidateUrl: 'http://localhost:4200/join/new' }));
    renderWithApi(<SessionControls sessionId="s1" status="live" />, { api: fakeApi({ sessions: { regenerateInvite } }) });
    await userEvent.click(screen.getByRole('button', { name: 'New candidate link' }));
    expect(await screen.findByLabelText('Candidate link')).toHaveValue('http://localhost:4200/join/new');
  });

  it('shows nothing once the session is finished', () => {
    const { container } = renderWithApi(<SessionControls sessionId="s1" status="ended" />, { api: fakeApi({}) });
    expect(within(container).queryAllByRole('button')).toHaveLength(0);
  });

  it('explains a conflict', async () => {
    const start = vi.fn(async () => {
      throw orpcError('CONFLICT');
    });
    renderWithApi(<SessionControls sessionId="s1" status="created" />, { api: fakeApi({ sessions: { start } }) });
    await userEvent.click(screen.getByRole('button', { name: 'Start interview' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/changed/i));
  });
});
```

`src/lib/session-room-page.spec.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { fakeApi, orpcError, renderWithApi } from '@swint/web-data-access-api/testing';
import { SessionRoomPage } from './session-room-page.js';

const base = { sessionId: 's1', title: 'URL shortener', timer: { startedAt: 1000, durationSec: 2700, extensionSec: 0 } };
const candidate = (status: 'created' | 'live') => ({ ...base, role: 'candidate', status, instructionsMd: status === 'created' ? null : '# Task', me: { name: 'Bo' } });
const interviewer = (status: 'created' | 'live' | 'ended') => ({
  ...base, role: 'interviewer', status, instructionsMd: '# Task', rubricMd: '- secret rubric', candidateName: 'Bo', me: { name: 'Ada', sub: 'sub-1' },
});

const renderRoom = (get: () => Promise<unknown>, pollMs?: number) =>
  renderWithApi(<SessionRoomPage pollMs={pollMs} />, { api: fakeApi({ room: { get } }), path: '/s/s1', routePath: '/s/:sessionId' });

describe('SessionRoomPage gate', () => {
  it('asks anonymous visitors to sign in (or use their invitation link)', async () => {
    renderRoom(async () => { throw orpcError('UNAUTHORIZED'); });
    expect(await screen.findByRole('link', { name: /sign in as interviewer/i })).toHaveAttribute('href', '/auth/login?returnTo=%2Fs%2Fs1');
    expect(screen.getByText(/invitation link/i)).toBeInTheDocument();
  });

  it('shows the ended screen when the candidate session is over', async () => {
    renderRoom(async () => { throw orpcError('FORBIDDEN', { reason: 'session_ended' }); });
    expect(await screen.findByRole('heading', { name: 'The interview has ended' })).toBeInTheDocument();
  });

  it.each([['FORBIDDEN'], ['NOT_FOUND']])('%s → unavailable', async (code) => {
    renderRoom(async () => { throw orpcError(code); });
    expect(await screen.findByRole('heading', { name: 'This room is not available' })).toBeInTheDocument();
  });

  it('keeps a candidate in the waiting room until the interview starts', async () => {
    const get = vi.fn().mockResolvedValueOnce(candidate('created')).mockResolvedValue(candidate('live'));
    renderRoom(get, 20);
    expect(await screen.findByRole('heading', { name: /waiting for your interviewer/i })).toBeInTheDocument();
    expect(screen.queryByText('Task')).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Task' }, { timeout: 2000 })).toBeInTheDocument();
  });

  it('candidates see instructions but no rubric or controls', async () => {
    renderRoom(async () => candidate('live'));
    expect(await screen.findByRole('heading', { name: 'Task' })).toBeInTheDocument();
    expect(screen.queryByText(/secret rubric/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End interview' })).not.toBeInTheDocument();
  });

  it('interviewers see the rubric tab and controls, even before start', async () => {
    renderRoom(async () => interviewer('created'));
    expect(await screen.findByRole('button', { name: 'Start interview' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Rubric' })).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveAttribute('data-phase', 'not-started');
  });
});
```

**Note for Task 13:** these page tests render `LiveRoom`. Once Task 13 makes `LiveRoom` open a collab session, they must wrap the page in a fake `CollabFactoryProvider` (Task 13, Step 1 says how).

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm nx test web-feature-session-room`
Expected: FAIL.

- [ ] **Step 4: Implement**

`session-state.ts`:

```ts
import { useMemo, useRef } from 'react';
import type { RoomView } from '@swint/shared-api-contract';
import type { SessionStateMessage } from '@swint/shared-collab-protocol';
import type { SessionStatus, TimerFields } from '@swint/shared-domain';

export interface RoomSessionState {
  status: SessionStatus;
  timer: TimerFields;
  /** serverNow - clientNow (0 until the first session.state). */
  offsetMs: number;
}

const RANK: Record<SessionStatus, number> = { created: 0, live: 1, ended: 2, cancelled: 2 };

/** REST and WebSocket state can arrive in any order; never move backwards. */
export function mergeSessionState(
  current: RoomSessionState | null,
  incoming: { status: SessionStatus; timer: TimerFields; offsetMs?: number },
): RoomSessionState {
  const offsetMs = incoming.offsetMs ?? current?.offsetMs ?? 0;
  if (!current) return { status: incoming.status, timer: incoming.timer, offsetMs };
  const a = RANK[current.status];
  const b = RANK[incoming.status];
  const newer = b > a || (b === a && incoming.timer.extensionSec >= current.timer.extensionSec);
  return newer ? { status: incoming.status, timer: incoming.timer, offsetMs } : { ...current, offsetMs };
}

export function useMergedSessionState(
  view: RoomView,
  live: { message: SessionStateMessage; offsetMs: number } | null,
): RoomSessionState {
  const last = useRef<RoomSessionState | null>(null);
  return useMemo(() => {
    let next = mergeSessionState(last.current, { status: view.status, timer: view.timer });
    if (live) {
      const { status, startedAt, durationSec, extensionSec } = live.message;
      next = mergeSessionState(next, { status, timer: { startedAt, durationSec, extensionSec }, offsetMs: live.offsetMs });
    }
    last.current = next;
    return next;
  }, [view, live]);
}
```

`use-room.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { useOrpc } from '@swint/web-data-access-api';

export const WAITING_POLL_MS = 3000;

/** room.get; polls while a candidate waits for the interview to start (spec §6, contract README). */
export function useRoomQuery(sessionId: string, pollMs = WAITING_POLL_MS) {
  const orpc = useOrpc();
  return useQuery({
    ...orpc.room.get.queryOptions({ input: { sessionId } }),
    retry: false,
    refetchInterval: (query) => {
      const view = query.state.data;
      return view && view.role === 'candidate' && view.status === 'created' ? pollMs : false;
    },
  });
}
```

`screens.tsx`:

```tsx
import { Link } from 'react-router';
import { loginUrl } from '@swint/web-data-access-api';
import { Screen, Spinner } from '@swint/web-ui-primitives';

export function SignInRequiredScreen({ sessionId }: { sessionId: string }) {
  return (
    <Screen
      title="Sign in to join this interview"
      actions={<a className="rounded-md bg-blue-600 px-4 py-2 text-white" href={loginUrl(`/s/${sessionId}`)}>Sign in as interviewer</a>}
    >
      If you are the candidate, open the invitation link you received again.
    </Screen>
  );
}

export function InterviewEndedScreen() {
  return <Screen title="The interview has ended">Thank you for your time. You can close this window.</Screen>;
}

export function LinkInvalidScreen({ reason }: { reason: 'invite_revoked' | 'session_ended' | null }) {
  if (reason === 'session_ended') return <InterviewEndedScreen />;
  return (
    <Screen title="This link is no longer valid">
      {reason === 'invite_revoked'
        ? 'A newer invitation link was issued. Please use the latest link from your interviewer.'
        : 'Please check the link or ask your interviewer for a new one.'}
    </Screen>
  );
}

export function RoomUnavailableScreen() {
  return (
    <Screen title="This room is not available" actions={<Link className="text-blue-700 underline" to="/">Go home</Link>}>
      It may not exist, or you may not have access to it.
    </Screen>
  );
}

export function WaitingRoom({ title, name }: { title: string; name: string }) {
  return (
    <Screen title="Waiting for your interviewer to start">
      <p>Hi {name}! “{title}” will begin shortly. This page updates automatically.</p>
      <div className="mt-4"><Spinner label="Waiting…" /></div>
    </Screen>
  );
}
```

`session-controls.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { EXTENSION_MINUTES, isFinished, type SessionStatus } from '@swint/shared-domain';
import { apiError, useOrpc } from '@swint/web-data-access-api';
import { Button, CopyField, Dialog } from '@swint/web-ui-primitives';

const describeError = (err: unknown): string =>
  apiError(err)?.code === 'CONFLICT'
    ? 'The session changed in the meantime. The view has been refreshed; please try again.'
    : 'Something went wrong. Please try again.';

/** Interviewer commands (spec §6). The server is authoritative; state updates arrive via session.state. */
export function SessionControls({ sessionId, status }: { sessionId: string; status: SessionStatus }) {
  const orpc = useOrpc();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.room.key() });
  const opts = { onSettled: refresh };
  const start = useMutation(orpc.sessions.start.mutationOptions(opts));
  const extend = useMutation(orpc.sessions.extend.mutationOptions(opts));
  const end = useMutation(orpc.sessions.end.mutationOptions(opts));
  const cancel = useMutation(orpc.sessions.cancel.mutationOptions(opts));
  const invite = useMutation(orpc.sessions.regenerateInvite.mutationOptions());
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);

  if (isFinished(status)) return null;
  const failed = [start, extend, end, cancel, invite].find((m) => m.isError);
  const busy = [start, extend, end, cancel].some((m) => m.isPending);

  const submitCancel = (e: FormEvent) => {
    e.preventDefault();
    cancel.mutate({ id: sessionId, reason: reason.trim() || undefined }, { onSuccess: () => setCancelOpen(false) });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === 'created' ? <Button size="sm" disabled={busy} onClick={() => start.mutate({ id: sessionId })}>Start interview</Button> : null}
      {status === 'live'
        ? EXTENSION_MINUTES.map((minutes) => (
            <Button key={minutes} size="sm" variant="secondary" disabled={busy} onClick={() => extend.mutate({ id: sessionId, minutes })}>
              +{minutes} min
            </Button>
          ))
        : null}
      {status === 'live' ? (
        <Button size="sm" variant="danger" disabled={busy} onClick={() => window.confirm('End the interview for everyone?') && end.mutate({ id: sessionId })}>
          End interview
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setCancelOpen(true)}>Cancel…</Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={invite.isPending}
        onClick={() => {
          if (window.confirm('Create a new candidate link? The current link stops working immediately.')) {
            invite.mutate({ id: sessionId }, { onSuccess: () => setInviteOpen(true) });
          }
        }}
      >
        New candidate link
      </Button>
      {failed ? <p role="alert" className="text-sm text-red-700">{describeError(failed.error)}</p> : null}

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen} title="Cancel interview" description="The candidate will see that the interview has ended. The reason is never shown to them.">
        <form onSubmit={submitCancel} className="space-y-3">
          <label className="block text-sm">
            Reason (optional, private)
            <textarea value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 p-2" />
          </label>
          <Button type="submit" variant="danger" disabled={cancel.isPending}>Cancel interview</Button>
        </form>
      </Dialog>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen} title="New candidate link" description="The previous link no longer works.">
        {invite.data ? <CopyField label="Candidate link" value={invite.data.candidateUrl} /> : null}
      </Dialog>
    </div>
  );
}
```

`live-room.tsx` is the first version, without collaboration. Task 13 adds the board, notes, presence and connection handling.

```tsx
import { useState } from 'react';
import type { RoomView } from '@swint/shared-api-contract';
import { InstructionsPanel, PanelBoundary, RubricPanel, TimerBar } from '@swint/web-ui-session-panels';
import { SessionControls } from './session-controls.js';
import { useMergedSessionState } from './session-state.js';

type Tab = 'instructions' | 'rubric' | 'notes';

export function LiveRoom({ view }: { view: RoomView }) {
  const state = useMergedSessionState(view, null);
  const [tab, setTab] = useState<Tab>('instructions');
  const tabs: Tab[] = view.role === 'interviewer' ? ['instructions', 'rubric'] : ['instructions'];
  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-4 border-b border-slate-200 bg-white px-4 py-2">
        <h1 className="font-semibold">{view.title}</h1>
        <TimerBar status={state.status} timer={state.timer} offsetMs={state.offsetMs} />
        <div className="ml-auto">{view.role === 'interviewer' ? <SessionControls sessionId={view.sessionId} status={state.status} /> : null}</div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-96 flex-col border-r border-slate-200 bg-white">
          <div role="tablist" className="flex border-b border-slate-200">
            {tabs.map((t) => (
              <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)} className={tab === t ? 'border-b-2 border-blue-600 px-4 py-2 text-sm font-medium' : 'px-4 py-2 text-sm text-slate-600'}>
                {t === 'instructions' ? 'Instructions' : t === 'rubric' ? 'Rubric' : 'Notes'}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {tab === 'instructions' ? <PanelBoundary title="Instructions"><InstructionsPanel markdown={view.instructionsMd ?? ''} /></PanelBoundary> : null}
            {tab === 'rubric' && view.role === 'interviewer' ? <PanelBoundary title="Rubric"><RubricPanel markdown={view.rubricMd} /></PanelBoundary> : null}
          </div>
        </aside>
        <main aria-label="Board" className="min-w-0 flex-1" />
      </div>
    </div>
  );
}
```

`session-room-page.tsx`:

```tsx
import { useParams } from 'react-router';
import { apiError } from '@swint/web-data-access-api';
import { Button, Screen, Spinner } from '@swint/web-ui-primitives';
import { LiveRoom } from './live-room.js';
import { InterviewEndedScreen, RoomUnavailableScreen, SignInRequiredScreen, WaitingRoom } from './screens.js';
import { useRoomQuery } from './use-room.js';

/** /s/:sessionId — one URL for interviewers and the candidate; the server decides the role (spec §5). */
export function SessionRoomPage({ pollMs }: { pollMs?: number }) {
  const { sessionId = '' } = useParams();
  const room = useRoomQuery(sessionId, pollMs);
  const err = apiError(room.error);

  if (err?.code === 'UNAUTHORIZED') return <SignInRequiredScreen sessionId={sessionId} />;
  if (err?.code === 'FORBIDDEN' && err.reason === 'session_ended') return <InterviewEndedScreen />;
  if (err?.code === 'FORBIDDEN' || err?.code === 'NOT_FOUND') return <RoomUnavailableScreen />;
  if (room.data) {
    const view = room.data;
    if (view.role === 'candidate' && view.status === 'created') return <WaitingRoom title={view.title} name={view.me.name} />;
    return <LiveRoom view={view} />;
  }
  if (room.isPending) return <Screen title="Joining…"><Spinner /></Screen>;
  return (
    <Screen title="Could not load the interview" actions={<Button onClick={() => void room.refetch()}>Retry</Button>}>
      Check your connection and try again.
    </Screen>
  );
}
```

`src/index.ts`:

```ts
export * from './lib/session-room-page.js';
export * from './lib/screens.js';
export * from './lib/session-state.js';
```

The room-page tests check that the instructions heading (`# Task` → heading `Task`) appears only when the room is live.

- [ ] **Step 5: Verify and commit**

Run: `pnpm install && pnpm nx sync && pnpm nx run-many -t test lint typecheck -p web-feature-session-room`
Expected: PASS.

```bash
git add libs/web/feature-session-room package.json pnpm-lock.yaml tsconfig.json
git commit -m "feat(web-feature-session-room): room gate, waiting room, session state merge and interviewer controls

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Live room collaboration: board, notes, presence, connection contract, read-only and export

**Files:**
- Modify: `libs/web/feature-session-room/src/lib/live-room.tsx`, `session-room-page.spec.tsx`, `package.json`
- Create:
  - `libs/web/feature-session-room/src/lib/export-menu.tsx`
  - `libs/web/feature-session-room/src/lib/connection.ts`, holding `bannerState` and `myPresence`
  - `libs/web/feature-session-room/src/lib/live-room.spec.tsx`

**Interfaces:**
- Consumes:
  - `useCollabSession`, `usePresence`, `CollabFactoryProvider`, `CollabPhase`, `CollabSnapshot` (Task 7)
  - `createFakeCollabSession` (Task 7 testing)
  - `CollaborativeBoard`, `BoardHandle`, `EXPORT_FORMATS`, `exportFileName`, `downloadBlob` (Task 8)
  - `NotesEditor`, `ParticipantList`, `ConnectionBanner`, `BannerState` (Task 9)
  - `candidateUserId`, `colorForUser`, `AWARENESS_USER_FIELD` (Task 1)
- Produces:
  - `bannerState(phase: CollabPhase | undefined, everConnected: boolean): BannerState`
  - `myPresence(view: RoomView): { userId: string; name: string; role: ParticipantRole; color: string }`
  - `ExportMenu({ board, title })`
  - `LiveRoom` with full collaboration

**Behaviour.** Each item maps to the real-time contract README:

| Collab state | Candidate | Interviewer |
|---|---|---|
| `connecting` before the first connect | banner "Connecting…" | same |
| `reconnecting` | banner "Reconnecting…" | same |
| `unreachable` (likely 401 at upgrade) | banner, and **probe REST**: invalidate the room query. The gate then shows sign-in or ended if REST also fails | same |
| `rejected not_started` | invalidate the room query (gate → waiting room) and show "Waiting for the interview to start…" | n/a |
| `rejected`/`closed` `session_ended` | `InterviewEndedScreen` | invalidate the room query; show a read-only room |
| `rejected`/`closed` `invite_revoked` | `LinkInvalidScreen reason="invite_revoked"` | n/a |
| `rejected forbidden` | `RoomUnavailableScreen` | same |
| merged status finished | `InterviewEndedScreen`, without waiting for 4403 | board and notes read-only; `ExportMenu` shown; controls hidden |

Read-only rule: an interviewer is read-only when the merged status is finished or `snapshot.conn.readOnly` is set; a candidate only when the status is finished.

Local presence: on session creation, set `board.awareness` field `user` to `{ userId, name, role, color: colorForUser(userId), selectedElementIds: {} }` from `myPresence(view)`. Here `userId` is `view.me.sub` for interviewers and `candidateUserId(view.sessionId)` for candidates, which matches the server's stamp.

Notes: interviewers get a "Notes" tab with `NotesEditor`, using `doc = session.notes.doc` and `awarenessProvider = session.notes.provider`. If `notesError` is set, show "Notes are unavailable."

- [ ] **Step 1: Make the Task 12 page tests collab-safe, and write the failing tests**

In `session-room-page.spec.tsx`, render inside a fake factory and mock the heavy components:

```tsx
import { CollabFactoryProvider } from '@swint/web-data-access-collab';
import { createFakeCollabSession } from '@swint/web-data-access-collab/testing';

vi.mock('@swint/web-ui-whiteboard', () => ({
  CollaborativeBoard: () => <div data-testid="board" />,
  EXPORT_FORMATS: ['png', 'svg', 'excalidraw'],
  exportFileName: (t: string, f: string) => `${t}.${f}`,
  downloadBlob: vi.fn(),
}));

const renderRoom = (get: () => Promise<unknown>, pollMs?: number) => {
  const fake = createFakeCollabSession({ role: 'interviewer' });
  return renderWithApi(
    <CollabFactoryProvider factory={fake.factory}><SessionRoomPage pollMs={pollMs} /></CollabFactoryProvider>,
    { api: fakeApi({ room: { get } }), path: '/s/s1', routePath: '/s/:sessionId' },
  );
};
```

The factory ignores `role`. For candidate tests the fake's `notes` is non-null, but `LiveRoom` only reads notes for interviewers, so that's harmless.

`src/lib/live-room.spec.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AWARENESS_USER_FIELD, candidateUserId, colorForUser } from '@swint/shared-collab-protocol';
import { CollabFactoryProvider, initialConnState, type CollabPhase } from '@swint/web-data-access-collab';
import { createFakeCollabSession } from '@swint/web-data-access-collab/testing';
import { fakeApi, orpcError, renderWithApi } from '@swint/web-data-access-api/testing';

const exportAs = vi.fn(async () => new Blob(['x']));
const downloadBlob = vi.fn();
vi.mock('@swint/web-ui-whiteboard', async () => {
  const { useEffect } = await import('react');
  return {
  CollaborativeBoard: ({ readOnly, onReady }: { readOnly: boolean; onReady?: (h: unknown) => void }) => {
    // Like the real board: the handle is handed out after mount, never during render.
    useEffect(() => onReady?.({ exportAs }), [onReady]);
    return <div data-testid="board" data-readonly={String(readOnly)} />;
  },
  EXPORT_FORMATS: ['png', 'svg', 'excalidraw'],
  exportFileName: (t: string, f: string) => `${t}.${f}`,
  downloadBlob: (...a: unknown[]) => downloadBlob(...a),
  };
});
vi.mock('@swint/web-ui-session-panels', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@swint/web-ui-session-panels')>()),
  NotesEditor: ({ readOnly }: { readOnly: boolean }) => <div data-testid="notes" data-readonly={String(readOnly)} />,
}));

const { SessionRoomPage } = await import('./session-room-page.js');

const timer = { startedAt: Date.now(), durationSec: 2700, extensionSec: 0 };
const candidateView = { sessionId: 's1', title: 'URL shortener', status: 'live', timer, role: 'candidate', instructionsMd: '# Task', me: { name: 'Bo' } };
const interviewerView = { ...candidateView, role: 'interviewer', rubricMd: '- r', candidateName: 'Bo', me: { name: 'Ada', sub: 'sub-1' } };
const stateMsg = (status: 'live' | 'ended' | 'cancelled') => ({
  message: { type: 'session.state' as const, status, startedAt: timer.startedAt, durationSec: 2700, extensionSec: 0, serverNow: Date.now() },
  offsetMs: 0,
});
const phase = (p: CollabPhase, everConnected = true) => ({ conn: { ...initialConnState, phase: p, everConnected } });

function renderLive(view: object, get = vi.fn(async () => view)) {
  const fake = createFakeCollabSession({ role: (view as { role: 'candidate' | 'interviewer' }).role });
  const utils = renderWithApi(
    <CollabFactoryProvider factory={fake.factory}><SessionRoomPage /></CollabFactoryProvider>,
    { api: fakeApi({ room: { get } }), path: '/s/s1', routePath: '/s/:sessionId' },
  );
  return { ...utils, fake, get };
}

afterEach(() => vi.clearAllMocks());

describe('LiveRoom (candidate)', () => {
  it('edits the board and announces itself with the server-consistent identity', async () => {
    const { fake } = renderLive(candidateView);
    expect(await screen.findByTestId('board')).toHaveAttribute('data-readonly', 'false');
    expect(fake.session.board.awareness.getLocalState()?.[AWARENESS_USER_FIELD]).toEqual({
      userId: candidateUserId('s1'), name: 'Bo', role: 'candidate', color: colorForUser(candidateUserId('s1')), selectedElementIds: {},
    });
    expect(screen.queryByRole('tab', { name: 'Notes' })).not.toBeInTheDocument();
  });

  it('shows the ended screen as soon as session.state says ended', async () => {
    const { fake } = renderLive(candidateView);
    await screen.findByTestId('board');
    act(() => fake.update({ sessionState: stateMsg('ended') }));
    expect(screen.getByRole('heading', { name: 'The interview has ended' })).toBeInTheDocument();
  });

  it('4403 session_ended → ended screen; invite_revoked → invalid link screen', async () => {
    const a = renderLive(candidateView);
    await screen.findByTestId('board');
    act(() => a.fake.update(phase({ kind: 'closed', reason: 'session_ended' })));
    expect(screen.getByRole('heading', { name: 'The interview has ended' })).toBeInTheDocument();
    a.unmount();
    const b = renderLive(candidateView);
    await screen.findByTestId('board');
    act(() => b.fake.update(phase({ kind: 'closed', reason: 'invite_revoked' })));
    expect(screen.getByRole('heading', { name: 'This link is no longer valid' })).toBeInTheDocument();
  });

  it('when the socket is unreachable, probes REST and follows its verdict', async () => {
    const get = vi.fn().mockResolvedValueOnce(candidateView).mockRejectedValue(orpcError('UNAUTHORIZED'));
    const { fake } = renderLive(candidateView, get);
    await screen.findByTestId('board');
    act(() => fake.update(phase({ kind: 'unreachable' })));
    expect(await screen.findByRole('heading', { name: 'Sign in to join this interview' })).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('not_started → back to the waiting room via REST', async () => {
    const get = vi.fn().mockResolvedValueOnce(candidateView).mockResolvedValue({ ...candidateView, status: 'created', instructionsMd: null });
    const { fake } = renderLive(candidateView, get);
    await screen.findByTestId('board');
    act(() => fake.update(phase({ kind: 'rejected', reason: 'not_started' })));
    expect(await screen.findByRole('heading', { name: /waiting for your interviewer/i })).toBeInTheDocument();
  });

  it('shows connection banners', async () => {
    const { fake } = renderLive(candidateView);
    await screen.findByTestId('board');
    act(() => fake.update(phase({ kind: 'reconnecting' })));
    expect(screen.getByRole('status')).toHaveTextContent(/reconnecting/i);
    act(() => fake.update(phase({ kind: 'connected' })));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('LiveRoom (interviewer)', () => {
  it('has notes; after the session ends everything is read-only and exportable', async () => {
    const { fake } = renderLive(interviewerView);
    expect(await screen.findByTestId('board')).toHaveAttribute('data-readonly', 'false');
    await userEvent.click(screen.getByRole('tab', { name: 'Notes' }));
    expect(screen.getByTestId('notes')).toHaveAttribute('data-readonly', 'false');
    expect(screen.queryByRole('button', { name: /export png/i })).not.toBeInTheDocument();

    act(() => fake.update({ sessionState: stateMsg('ended') }));
    expect(screen.getByTestId('board')).toHaveAttribute('data-readonly', 'true');
    expect(screen.getByTestId('notes')).toHaveAttribute('data-readonly', 'true');
    expect(screen.queryByRole('button', { name: 'End interview' })).not.toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveAttribute('data-phase', 'ended');

    await userEvent.click(screen.getByRole('button', { name: /export png/i }));
    expect(exportAs).toHaveBeenCalledWith('png');
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'URL shortener.png');
  });

  it('is read-only when the server granted only read access (revisit after the end)', async () => {
    const { fake } = renderLive(interviewerView);
    await screen.findByTestId('board');
    act(() => fake.update({ conn: { ...initialConnState, phase: { kind: 'connected' }, everConnected: true, readOnly: true } }));
    expect(screen.getByTestId('board')).toHaveAttribute('data-readonly', 'true');
  });
});
```

Also add `src/lib/connection.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { bannerState, myPresence } from './connection.js';

describe('bannerState', () => {
  it.each([
    [{ kind: 'connecting' }, false, 'connecting'],
    [{ kind: 'connecting' }, true, null],
    [{ kind: 'connected' }, true, null],
    [{ kind: 'reconnecting' }, true, 'reconnecting'],
    [{ kind: 'unreachable' }, false, 'unreachable'],
    [{ kind: 'closed', reason: 'session_ended' }, true, null],
  ] as const)('%j (everConnected=%s) → %s', (phase, ever, expected) => {
    expect(bannerState(phase, ever)).toBe(expected);
  });
});

describe('myPresence', () => {
  it('matches what the server stamps', () => {
    expect(myPresence({ role: 'interviewer', me: { name: 'Ada', sub: 'sub-1' } } as never)).toMatchObject({ userId: 'sub-1', role: 'interviewer' });
    expect(myPresence({ role: 'candidate', sessionId: 's1', me: { name: 'Bo' } } as never)).toMatchObject({ userId: 'candidate:s1', role: 'candidate' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm nx test web-feature-session-room`
Expected: the new `live-room` and `connection` tests FAIL. The gate tests still PASS with the fake factory.

- [ ] **Step 3: Implement**

Add runtime deps to `libs/web/feature-session-room/package.json`: `@swint/web-data-access-collab`, `@swint/web-ui-whiteboard`, `@swint/shared-domain` (already there), and `y-protocols` only if imported directly (prefer not to).

`connection.ts`:

```ts
import type { RoomView } from '@swint/shared-api-contract';
import { candidateUserId, colorForUser } from '@swint/shared-collab-protocol';
import type { ParticipantRole } from '@swint/shared-domain';
import type { CollabPhase } from '@swint/web-data-access-collab';
import type { BannerState } from '@swint/web-ui-session-panels';

export function bannerState(phase: CollabPhase | undefined, everConnected: boolean): BannerState {
  if (!phase) return 'connecting';
  switch (phase.kind) {
    case 'connecting':
      return everConnected ? null : 'connecting';
    case 'reconnecting':
      return 'reconnecting';
    case 'unreachable':
      return 'unreachable';
    default:
      return null;
  }
}

/** Our presence identity. It matches the server's stamp (collab-server presenceIdentity). */
export function myPresence(view: RoomView): { userId: string; name: string; role: ParticipantRole; color: string } {
  const userId = view.role === 'interviewer' ? view.me.sub : candidateUserId(view.sessionId);
  return { userId, name: view.me.name, role: view.role, color: colorForUser(userId) };
}
```

`export-menu.tsx`:

```tsx
import { useState } from 'react';
import { Button } from '@swint/web-ui-primitives';
import { EXPORT_FORMATS, downloadBlob, exportFileName, type BoardHandle } from '@swint/web-ui-whiteboard';

const LABEL = { png: 'Export PNG', svg: 'Export SVG', excalidraw: 'Export .excalidraw' } as const;

export function ExportMenu({ board, title }: { board: BoardHandle | null; title: string }) {
  const [error, setError] = useState(false);
  return (
    <div className="flex items-center gap-2">
      {EXPORT_FORMATS.map((format) => (
        <Button
          key={format}
          size="sm"
          variant="secondary"
          disabled={!board}
          onClick={async () => {
            if (!board) return;
            try {
              setError(false);
              downloadBlob(await board.exportAs(format), exportFileName(title, format));
            } catch {
              setError(true);
            }
          }}
        >
          {LABEL[format]}
        </Button>
      ))}
      {error ? <span role="alert" className="text-sm text-red-700">Export failed.</span> : null}
    </div>
  );
}
```

`live-room.tsx` (full replacement):

```tsx
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { RoomView } from '@swint/shared-api-contract';
import { AWARENESS_USER_FIELD } from '@swint/shared-collab-protocol';
import { isFinished } from '@swint/shared-domain';
import { useOrpc } from '@swint/web-data-access-api';
import { usePresence, useCollabSession } from '@swint/web-data-access-collab';
import { Screen, Spinner } from '@swint/web-ui-primitives';
import {
  ConnectionBanner,
  InstructionsPanel,
  NotesEditor,
  PanelBoundary,
  ParticipantList,
  RubricPanel,
  TimerBar,
} from '@swint/web-ui-session-panels';
import { CollaborativeBoard, type BoardHandle } from '@swint/web-ui-whiteboard';
import { bannerState, myPresence } from './connection.js';
import { ExportMenu } from './export-menu.js';
import { InterviewEndedScreen, LinkInvalidScreen, RoomUnavailableScreen } from './screens.js';
import { SessionControls } from './session-controls.js';
import { useMergedSessionState } from './session-state.js';

type Tab = 'instructions' | 'rubric' | 'notes';

export function LiveRoom({ view }: { view: RoomView }) {
  const orpc = useOrpc();
  const queryClient = useQueryClient();
  const { session, snapshot } = useCollabSession({ sessionId: view.sessionId, role: view.role });
  const state = useMergedSessionState(view, snapshot?.sessionState ?? null);
  const participants = usePresence(session?.board.awareness ?? null);
  const [tab, setTab] = useState<Tab>('instructions');
  const [board, setBoard] = useState<BoardHandle | null>(null);
  const me = myPresence(view);
  const phase = snapshot?.conn.phase;
  const finished = isFinished(state.status);
  const interviewer = view.role === 'interviewer';
  const readOnly = interviewer ? finished || Boolean(snapshot?.conn.readOnly) : finished;
  const terminalReason = phase && (phase.kind === 'rejected' || phase.kind === 'closed') ? phase.reason : null;

  // Announce ourselves. The server re-stamps identity fields anyway (spec §7.3).
  useEffect(() => {
    session?.board.awareness.setLocalStateField(AWARENESS_USER_FIELD, {
      userId: me.userId, name: me.name, role: me.role, color: me.color, selectedElementIds: {},
    });
  }, [session, me.userId, me.name, me.role, me.color]);

  // The REST view decides what the WebSocket cannot tell us: unreachable (maybe a 401 at upgrade), not started, ended.
  const needsProbe = phase?.kind === 'unreachable' || terminalReason === 'not_started' || (interviewer && terminalReason === 'session_ended');
  useEffect(() => {
    if (needsProbe) void queryClient.invalidateQueries({ queryKey: orpc.room.key() });
  }, [needsProbe, queryClient, orpc]);

  if (terminalReason === 'invite_revoked') return <LinkInvalidScreen reason="invite_revoked" />;
  if (!interviewer && (terminalReason === 'session_ended' || finished)) return <InterviewEndedScreen />;
  if (terminalReason === 'forbidden') return <RoomUnavailableScreen />;
  if (terminalReason === 'not_started') return <Screen title="Waiting for the interview to start…"><Spinner /></Screen>;

  const tabs: Tab[] = interviewer ? ['instructions', 'rubric', 'notes'] : ['instructions'];
  const notes = interviewer ? session?.notes ?? null : null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-4 border-b border-slate-200 bg-white px-4 py-2">
        <h1 className="font-semibold">{view.title}</h1>
        <TimerBar status={state.status} timer={state.timer} offsetMs={state.offsetMs} />
        <ParticipantList participants={participants} />
        <div className="ml-auto flex items-center gap-2">
          {interviewer && !finished ? <SessionControls sessionId={view.sessionId} status={state.status} /> : null}
          {interviewer && finished ? <ExportMenu board={board} title={view.title} /> : null}
        </div>
      </header>
      <ConnectionBanner state={bannerState(phase, Boolean(snapshot?.conn.everConnected))} />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-96 flex-col border-r border-slate-200 bg-white">
          <div role="tablist" className="flex border-b border-slate-200">
            {tabs.map((t) => (
              <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)} className={tab === t ? 'border-b-2 border-blue-600 px-4 py-2 text-sm font-medium' : 'px-4 py-2 text-sm text-slate-600'}>
                {t === 'instructions' ? 'Instructions' : t === 'rubric' ? 'Rubric' : 'Notes'}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {tab === 'instructions' ? <PanelBoundary title="Instructions"><InstructionsPanel markdown={view.instructionsMd ?? ''} /></PanelBoundary> : null}
            {tab === 'rubric' && view.role === 'interviewer' ? <PanelBoundary title="Rubric"><RubricPanel markdown={view.rubricMd} /></PanelBoundary> : null}
            {tab === 'notes' && notes ? (
              <PanelBoundary title="Notes">
                {snapshot?.notesError ? (
                  <p className="p-4 text-sm text-slate-600">Notes are unavailable.</p>
                ) : (
                  <NotesEditor doc={notes.doc} awarenessProvider={notes.provider as unknown as { awareness: typeof notes.awareness }} user={{ name: me.name, color: me.color }} readOnly={readOnly} />
                )}
              </PanelBoundary>
            ) : null}
          </div>
        </aside>
        <main aria-label="Board" className="relative min-w-0 flex-1">
          {session ? (
            <PanelBoundary title="Board">
              <CollaborativeBoard doc={session.board.doc} awareness={session.board.awareness} readOnly={readOnly} onReady={setBoard} />
            </PanelBoundary>
          ) : null}
        </main>
      </div>
    </div>
  );
}
```

A few checks against the tests:
- `ExportMenu` test filename: the mocked `exportFileName` returns `${title}.${format}`, so the test expects `'URL shortener.png'`.
- The candidate `session_ended` and `finished` checks run before any board render. The ended screen therefore appears even if 4403 hasn't arrived yet.
- `HocuspocusProvider` exposes `awareness`, so `notes.provider` satisfies `{ awareness }`. If TypeScript accepts the provider without the cast, drop the cast.

- [ ] **Step 4: Verify and commit**

Run: `pnpm install && pnpm nx sync && pnpm nx run-many -t test lint typecheck -p web-feature-session-room`
Expected: PASS.

```bash
git add libs/web/feature-session-room package.json pnpm-lock.yaml tsconfig.json
git commit -m "feat(web-feature-session-room): live board, notes, presence, connection contract, read-only revisit and export

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Wire the app, README, and a smoke run of the whole stack

**Files:**
- Modify: `apps/web/src/app/app.tsx`, `apps/web/src/app/app.spec.tsx`, `apps/web/package.json` (deps), `README.md`

**Interfaces:**
- Consumes:
  - `InterviewerLayout`, `DashboardPage` (Task 10); `TemplateEditorPage` (Task 11)
  - `SessionRoomPage`, `LinkInvalidScreen` (Tasks 12–13)
  - `createApiClient`, `createQueryClient`, `ApiProvider` (Task 6)
- Produces: the final routes (Global Constraints → Web routes).

- [ ] **Step 1: Write the failing tests**

Replace `apps/web/src/app/app.spec.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ApiProvider, navigation } from '@swint/web-data-access-api';
import { fakeApi, orpcError } from '@swint/web-data-access-api/testing';
import { AppRoutes } from './app';

vi.mock('@swint/web-ui-whiteboard', () => ({ SeedBoardEditor: () => null, CollaborativeBoard: () => null, EXPORT_FORMATS: [] }));

function renderAt(path: string, api = fakeApi({})) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ApiProvider client={api}>
        <MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>
      </ApiProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('AppRoutes', () => {
  it('renders the not-found page for unknown paths', () => {
    renderAt('/nope');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it.each([
    ['/link-invalid?reason=session_ended', 'The interview has ended'],
    ['/link-invalid?reason=invite_revoked', 'This link is no longer valid'],
    ['/link-invalid?reason=<script>', 'This link is no longer valid'],
  ])('%s', (path, heading) => {
    renderAt(path);
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
  });

  it.each(['/', '/templates/new', '/templates/t1'])('%s requires an interviewer', async (path) => {
    const assign = vi.spyOn(navigation, 'assign').mockImplementation(() => undefined);
    renderAt(path, fakeApi({ me: { get: async () => { throw orpcError('UNAUTHORIZED'); } } }));
    await screen.findByText(/redirecting to sign-in/i);
    expect(assign).toHaveBeenCalledWith(`/auth/login?returnTo=${encodeURIComponent(path)}`);
  });

  it('/s/:id is open to candidates (no interviewer gate)', async () => {
    renderAt('/s/s1', fakeApi({ room: { get: async () => { throw orpcError('FORBIDDEN', { reason: 'session_ended' }); } } }));
    expect(await screen.findByRole('heading', { name: 'The interview has ended' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm nx test web`
Expected: FAIL (the routes are missing).

- [ ] **Step 3: Implement**

`apps/web/src/app/app.tsx`:

```tsx
import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Link, Route, Routes, useSearchParams } from 'react-router';
import { ApiProvider, createApiClient, createQueryClient } from '@swint/web-data-access-api';
import { DashboardPage, InterviewerLayout } from '@swint/web-feature-dashboard';
import { LinkInvalidScreen, SessionRoomPage } from '@swint/web-feature-session-room';
import { TemplateEditorPage } from '@swint/web-feature-template-editor';
import { Screen } from '@swint/web-ui-primitives';

export function NotFound() {
  return (
    <Screen title="Page not found" actions={<Link className="text-blue-700 underline" to="/">Go home</Link>}>
      The page you are looking for does not exist.
    </Screen>
  );
}

/** /link-invalid?reason=… is where the API's /join/:token sends rejected candidates. */
function LinkInvalidRoute() {
  const [params] = useSearchParams();
  const raw = params.get('reason');
  const reason = raw === 'invite_revoked' || raw === 'session_ended' ? raw : null;
  return <LinkInvalidScreen reason={reason} />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<InterviewerLayout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/templates/new" element={<TemplateEditorPage />} />
        <Route path="/templates/:templateId" element={<TemplateEditorPage />} />
      </Route>
      <Route path="/s/:sessionId" element={<SessionRoomPage />} />
      <Route path="/link-invalid" element={<LinkInvalidRoute />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export function App() {
  const [client] = useState(() => createApiClient());
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={client}>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </ApiProvider>
    </QueryClientProvider>
  );
}
```

`LinkInvalidScreen` must be exported from `@swint/web-feature-session-room` (Task 12's index exports `screens.js`). Add the feature libs and `@swint/web-data-access-api` to `apps/web/package.json` dependencies, then `pnpm install && pnpm nx sync`.

The session room needs the full viewport height. `#root` is already `height: 100%` (Task 5 CSS), and `LiveRoom` uses `h-full`.

- [ ] **Step 4: Verify the build**

Run: `pnpm nx run-many -t test lint typecheck build -p web`
Expected: PASS. `apps/web/dist` contains the bundle. A chunk-size warning from Excalidraw is acceptable.

- [ ] **Step 5: Smoke-test the whole stack**

1. Start Docker Compose (`docker compose up -d`) if it isn't running.
2. Pick the API port. If `ss -ltn 'sport = :3000'` shows a listener you didn't start, use `PORT=3100` and `SWINT_API_URL=http://localhost:3100`.
3. Start both apps in the background with logs in the scratchpad:
   - `pnpm nx serve api`
   - `SWINT_API_URL=… pnpm nx serve web`
4. Wait for `curl -s localhost:4200/api/openapi.json` to return JSON.
5. Check through the **web origin**:
   - `curl -s -o /dev/null -w '%{http_code}' localhost:4200/api/me` → `401`. The API answered via the proxy.
   - `curl -s -o /dev/null -w '%{http_code} %{redirect_url}' localhost:4200/auth/login` → `302` to `http://localhost:8080/realms/swint/...`
   - `curl -s -o /dev/null -w '%{http_code}' localhost:4200/link-invalid?reason=session_ended` → `200` (SPA)
   - `curl -s -o /dev/null -w '%{http_code}' localhost:4200/s/whatever` → `200` (SPA)
   - WebSocket through the proxy without cookies is refused with 401. Use `ws` (a root devDependency), run from the repo root: `node -e "const W=require('ws');const s=new W('ws://localhost:4200/collab');s.on('unexpected-response',(q,r)=>{console.log('status',r.statusCode);process.exit(0)});s.on('open',()=>{console.log('opened?!');process.exit(1)});s.on('error',e=>{console.log('error',e.message);process.exit(1)})"` → `status 401`.
6. The API log shows the dev seed result (`created` on a fresh DB, `exists` after).
7. Stop both processes **you started**. Leave Docker Compose running, as you found it.

Record the outputs in the task report. A manual browser walkthrough (login → create a session → open the candidate link in a private window → draw → end → export) is for the human reviewer. Spell it out in the report as a checklist; don't claim you did it.

- [ ] **Step 6: README**

Update `README.md` → "Local development":

~~~markdown
```bash
pnpm install
docker compose up -d                       # Keycloak :8080, DynamoDB Local :8000, S3Mock :9090
pnpm nx run-many -t serve -p api web       # API :3000 (watch mode) + web :4200 (Vite, proxies /api /auth /join /collab)
```

Open http://localhost:4200 and sign in as `interviewer1` / `password`. In development the API seeds the
"Design a URL shortener" template. Create a session from the dashboard: the candidate link (`/join/…`) is
for the candidate (open it in a private window to try it), the interviewer link (`/s/…`) for other interviewers.

If port 3000 is taken: `PORT=3100 pnpm nx serve api` and `SWINT_API_URL=http://localhost:3100 pnpm nx serve web`.
~~~

Keep the existing test-user, endpoint and test sections.

- [ ] **Step 7: Full verification and commit**

Run: `pnpm nx run-many -t lint test typecheck build --skip-nx-cache`
Expected: exit 0.

```bash
git add apps/web README.md package.json pnpm-lock.yaml
git commit -m "feat(web): wire dashboard, template editor and session room routes; local dev docs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Spec coverage (self-review)

| Spec item | Where |
|---|---|
| §1.1 template → session → candidate + interviewer links | Task 10 (CreateSessionDialog), Task 14 routes |
| §1.2 same instructions and board in real time, live cursors and selections | Tasks 7, 8, 13 |
| §1.3 rubric and notes private to interviewers | Task 12 (rubric tab only in the interviewer view), Task 13 (notes doc only for interviewers; server already rejects candidates) |
| §1.4 timer: warnings, overtime, extend/end/cancel | Task 9 (TimerBar), Task 12 (SessionControls) |
| §1.5 read-only revisit + PNG/SVG/.excalidraw export | Tasks 8, 13 |
| §1.6 in-app template authoring incl. starting board | Tasks 8 (SeedBoardEditor), 11 |
| §2 React + Vite, React Router, TanStack Query, shadcn-style/Radix + Tailwind, Excalidraw, Hocuspocus provider, oRPC, TipTap | Tasks 5–11 |
| §3.1 lib layout and boundaries | Tasks 5–13 (tags per Global Constraints); `ui-primitives` ruling |
| §5 login/logout, `/s/{id}` for both roles, `/join` handled by the API, token never in the room URL | Tasks 6, 10, 12, 14 |
| §6 role/status matrix (waiting room, ended screen, read-only + export) | Tasks 12, 13 |
| §6 clock offset from `serverNow` | Tasks 7, 9, 12 |
| §7.2 binding: rAF throttle, `CaptureUpdateAction.NEVER`, reconcile, images disabled | Tasks 2, 8 |
| §7.3 presence: typed awareness, ~30/s pointer, collaborators, participant list, reconnect banner | Tasks 1, 3, 7, 8, 9, 13 |
| §8 close reasons → dedicated screens; one error boundary per panel | Tasks 7, 9, 12, 13 |
| §10 dev proxy, `run-many -t serve -p api web`, dev seed | Tasks 4, 5, 14 |
| Contract README (401 probe, rejection reasons, 4403 destroy, state ordering) | Tasks 7, 12, 13 |
