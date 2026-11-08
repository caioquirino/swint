# Swint — Foundation Design (System Design Interviews, v1)

- **Date:** 2026-11-08
- **Status:** Approved (design), pending spec review
- **Scope:** Foundation of an interview platform. v1 delivers **system design interviews** (shared instructions + real-time collaborative whiteboard). Live coding interviews are a planned follow-up and the design keeps room for them, but they are **out of scope** for v1.

## 1. Goals and non-goals

### Goals
1. Interviewers pick a template, create a session, and get a **candidate link** and an **interviewer link**.
2. Candidate and interviewers see the same instructions and edit the same Excalidraw board **in real time**, with live cursors and selections.
3. Interviewers have private material the candidate never receives: the **rubric** and shared **notes**.
4. A timer controlled by the server, with a **soft end**: warnings, then overtime, until an interviewer ends or cancels the session.
5. After the session: interviewers can **revisit it read-only** and **export** the board (PNG, SVG, `.excalidraw`).
6. Templates are authored **in the app**: markdown instructions and rubric, duration, and a starting board.
7. Runs **locally with Docker Compose only**, with no cloud dependency.

### Non-goals (v1)
- AWS infrastructure and deployment (later; the design keeps DynamoDB and S3 endpoints configurable).
- Live coding editor and code execution sandbox (later; see §9).
- Supporting multiple organisations (single org now, but every record carries `orgId`).
- Scorecards, timeline replay UI (S3 checkpoints are still written), images on the board, audio/video.

## 2. Key decisions

| Concern | Decision |
|---|---|
| Monorepo | Nx (existing workspace, pnpm, Node 24) |
| Frontend | React + Vite, React Router v7 (library mode), TanStack Query, shadcn/ui (Radix) + Tailwind |
| Whiteboard | Excalidraw (`@excalidraw/excalidraw`) |
| Real-time sync | Yjs + Hocuspocus (server), `@hocuspocus/provider` (client) |
| Backend | Node, Fastify; Hocuspocus attached to the same HTTP server (single process) |
| API contract | **oRPC, contract-first**: zod schemas in a shared library; typed client; OpenAPI generated from the contract; no code-generation step |
| WebSocket safety | Auth when the connection opens, one Yjs document per trust level, server-only typed stateless messages for session state |
| Persistence | **DynamoDB** (single table + GSI1) for records; **S3** for Yjs snapshots, checkpoints and starting boards |
| Interviewer auth | OIDC / OAuth 2.1 Authorization Code + PKCE against **Keycloak**, handled by the API (`openid-client`), with an httpOnly session cookie |
| Candidate access | Link with an invite token (hash stored) → exchanged for an httpOnly candidate cookie limited to one session |
| Notes editor | TipTap + Collaboration + CollaborationCursor |
| Local runtime | Docker Compose: keycloak, dynamodb-local, minio, plus optional `app` profile (api, web) |

## 3. Architecture

```
                ┌─────────────── Browser (React + Vite) ───────────────┐
                │  Session shell: Instructions | Board | Notes | Timer │
                │  Excalidraw ◀─▶ Yjs binding ◀─▶ HocuspocusProvider   │
                └──────────┬──────────────────────────────┬────────────┘
                     HTTPS (oRPC, cookie)            WSS (Yjs + awareness
                           │                          + stateless msgs)
              ┌────────────▼──────────────────────────────▼───────────┐
              │  apps/api (single Node process)                       │
              │  Fastify + oRPC · OIDC (Keycloak) · Hocuspocus        │
              │  session lifecycle + timer state                      │
              └──────┬───────────────────────────────┬────────────────┘
                     │                               │
               DynamoDB (records)              S3 (Yjs snapshots,
                                              checkpoints, seeds)
```

**Principles:**
- One deployable backend in v1.
- **The server decides what each role can see and do,** not just the UI.
- Candidates never receive private data: it lives in documents and endpoints they cannot access.

### 3.1 Nx layout and module boundaries

```
apps/
  web/                         scope:web
  api/                         scope:api
  web-e2e/                     scope:web   (Playwright)
libs/
  shared/                      scope:shared  — runs anywhere, no DOM/Node deps
    api-contract/              type:contract     oRPC contract + zod schemas
    collab-protocol/           type:contract     doc names, typed doc accessors, stateless msg schemas, roles, awareness types
    domain/                    type:util         session state machine, timer/overtime math
  web/                         scope:web     — browser only
    feature-session-room/      type:feature
    feature-template-editor/   type:feature
    feature-dashboard/         type:feature
    ui-session-panels/         type:ui           instructions, timer bar, participants, notes panel
    ui-whiteboard/             type:ui           Excalidraw wrapper + Yjs binding
    data-access-api/           type:data-access  oRPC client + TanStack Query hooks
    data-access-collab/        type:data-access  Hocuspocus provider, presence
  api/                         scope:api     — Node only
    feature-auth/              type:feature      OIDC (Keycloak), cookie sessions, candidate exchange
    feature-templates/         type:feature
    feature-sessions/          type:feature      lifecycle, invites, timer broadcasts
    collab-server/             type:feature      Hocuspocus config + auth/permission/persistence hooks
    data-access-persistence/   type:data-access  DynamoDB + S3 repositories
```

**Rules enforced by `@nx/enforce-module-boundaries`:**
- `scope:web` → can only depend on `scope:web`, `scope:shared`
- `scope:api` → can only depend on `scope:api`, `scope:shared`
- `scope:shared` → can only depend on `scope:shared`
- `type:ui` → can only depend on `type:ui`, `type:contract`, `type:util` (no `data-access`, no `feature`)
- `type:data-access` → can only depend on `type:data-access`, `type:contract`, `type:util`
- `type:contract` / `type:util` → can only depend on `type:contract`, `type:util`
- `type:feature` → anything within the allowed scopes

**Clarification:** `ui-whiteboard` hosts the Yjs binding and depends only on `yjs` and `collab-protocol` (a contract library), which the rules allow. It never touches the network: the feature library passes in a `Y.Doc` and an awareness instance from `data-access-collab`.

## 4. Data model

### 4.1 DynamoDB (single table `swint`, GSI1)

| Entity | PK | SK | GSI1PK / GSI1SK | Fields |
|---|---|---|---|---|
| User | `USER#{oidcSub}` | `PROFILE` | — | orgId, name, email, roles (refreshed from token claims on each login), lastLoginAt |
| Template | `TEMPLATE#{id}` | `META` | `ORG#{orgId}` / `TEMPLATE#{titleLower}#{id}` | orgId, title, instructionsMd, rubricMd, durationMin, boardSeedKey?, archived, createdBy, createdAt, updatedAt |
| Session | `SESSION#{id}` | `META` | `ORG#{orgId}` / `SESSION#{createdAt}#{id}` | orgId, templateSnapshot {title, instructionsMd, rubricMd, durationMin, boardSeedKey?}, candidateName, status, startedAt?, durationSec, extensionSec, endedAt?, endedBy?, cancelReason?, createdBy, createdAt, version |
| Invite | `INVITE#{sha256(token)}` | `META` | — | orgId, sessionId, createdAt, revokedAt? |
| Auth session | `AUTHSESSION#{id}` | `META` | — | userSub, orgId, roles, idTokenHint (for logout), expiresAt (TTL) |

**Rules:**
- IDs are ULIDs. Invite tokens are 32 random bytes (base64url). Only the SHA-256 is stored.
- Every read checks `orgId` against the caller's org.
- **The session copies the template when it's created.** Later template edits never affect existing sessions.
- All lifecycle changes are **conditional writes** on `status` (and `version`).
- Each session has at most one active invite. Regenerating sets `revokedAt` on the old one and creates a new one.

### 4.2 S3 (bucket `swint`)

```
orgs/{orgId}/templates/{id}/seed.excalidraw.json          starting board (Excalidraw elements JSON)
orgs/{orgId}/sessions/{id}/board/latest.bin               Yjs state (saved after edits pause)
orgs/{orgId}/sessions/{id}/board/checkpoints/{ts}.bin     every ~5 min while live + at end
orgs/{orgId}/sessions/{id}/notes/latest.bin               interviewer notes Yjs state
```

When a session is created, the API turns the template's starting board into the initial board document and writes it to `board/latest.bin`. If the template's starting board is later edited, a new seed file is written and the template's `boardSeedKey` updated, so existing sessions keep their copy.

## 5. Auth and links

### Interviewers
- `GET /auth/login` → Keycloak (Authorization Code + PKCE).
- `GET /auth/callback` → validate tokens, upsert User, set the `swint_sid` httpOnly, SameSite=Lax, Secure (outside dev) cookie, backed by a server-side session store.
- **v1 session store:** DynamoDB item `AUTHSESSION#{id}` with TTL.
- Access requires the `interviewer` realm role. Template management requires `interviewer`. `admin` is reserved.
- `POST /auth/logout` clears the session and redirects through Keycloak's end-session endpoint.
- The interviewer link is just `/s/{sessionId}`. Any logged-in interviewer in the same org can join.

### Candidates
- `GET /join/{token}`:
  1. Look up the hashed invite.
  2. Reject if it's revoked, or if the session is `ended` or `cancelled`.
  3. Set the httpOnly `swint_cand` cookie: a signed `{ sessionId, inviteHash, exp }` valid for 12h.
  4. Redirect to `/s/{sessionId}`.
- **The token never reaches the room page URL or the WebSocket.** The WebSocket authenticates with cookies, because the browser sends them on the same-origin upgrade request.
- **Every candidate request and WebSocket connection re-checks** that the invite is not revoked and the session is not finished.

## 6. Session lifecycle

Pure state machine in `shared/domain`:

```
created ──start──▶ live ──end──▶ ended
   │                 │
   └──cancel────────▶└──cancel──▶ cancelled
```

| Command (oRPC, interviewer only) | Allowed from | Effect |
|---|---|---|
| `sessions.start` | created | `status=live`, `startedAt=now` |
| `sessions.extend {minutes: 5\|10}` | live | `extensionSec += minutes*60` |
| `sessions.end` | live | `status=ended`, `endedAt`, `endedBy`; final checkpoint |
| `sessions.cancel {reason?}` | created, live | `status=cancelled`, `cancelReason` (never shown to candidate) |
| `sessions.regenerateInvite` | created, live | revoke old invite, return new candidate URL |

**After each command:**
- The server broadcasts `session.state { status, startedAt, durationSec, extensionSec, serverNow }` as a stateless message to all connections on the board document.
- On `ended`/`cancelled`:
  - Interviewer connections become read-only on both documents.
  - Candidate connections are closed with reason `session_ended`.

**Timer:**
- Clients compute `remaining = startedAt + durationSec + extensionSec − (Date.now() + serverOffset)`, where `serverOffset` comes from `serverNow` at connect and on every state message.
- Warnings at 10 min and 2 min.
- Below zero the timer shows overtime. **No automatic lock.**

**What each role sees:**

| Status | Candidate | Interviewers |
|---|---|---|
| created | Waiting room only (no board, no instructions) | Board, instructions, rubric, notes, Start |
| live | Instructions + editable board + timer | + rubric, notes, Extend, End, Cancel |
| ended / cancelled | "The interview has ended" screen | Read-only room + Export |

**Exports:** PNG and SVG come from Excalidraw's `exportToBlob` / `exportToSvg`, and `.excalidraw` from `serializeAsJSON`. All are generated in the browser from the read-only board.

## 7. Real-time collaboration

### 7.1 Documents and access

| Document name | Contents | Candidate | Interviewer |
|---|---|---|---|
| `session:{id}:board` | `elements: Y.Map<id, ExcalidrawElement>` | read-write when live; rejected otherwise | read-write when created or live; read-only when ended or cancelled |
| `session:{id}:notes` | `content: Y.XmlFragment` (TipTap) | **rejected at connect** | read-write when created or live; read-only when ended or cancelled |

**Hocuspocus hooks** (in `api/collab-server`):
- `onAuthenticate`: parse cookies, resolve identity, check org and session, apply the access table above, then set `connection.readOnly` where needed. On failure, throw with a typed reason: `unauthenticated`, `forbidden`, `invite_revoked`, `session_ended`, `not_started`.
- `onLoadDocument`: load `latest.bin` from S3. If it's missing and the document is a board, use the starting board copied at session creation.
- `onStoreDocument`: wait about 2s after the last edit, and at most 10s during continuous editing, then PUT `latest.bin`. Retry with backoff.
- Checkpoint timer: every ~5 min while live, and on end.
- `onStateless`: reject all messages sent by clients. Session state goes from server to clients only.

Typed accessors in `shared/collab-protocol` (`getBoardElements(doc)`, `getNotesFragment(doc)`, `docName.board(id)`, `docName.notes(id)`) are the only way code touches document structure. Stateless message payloads are zod schemas, parsed on receipt.

### 7.2 Excalidraw ↔ Yjs binding (`web/ui-whiteboard`)

**Local edits:**
- On `onChange(elements)`, compare elements against the last synced state by `id` + `version`.
- Write changed or deleted elements (Excalidraw marks deletion with `isDeleted`) in one `doc.transact(..., LOCAL_ORIGIN)`.
- Throttle to `requestAnimationFrame`.

**Remote edits:**
- `elements.observe` → if the change isn't local, gather the incoming elements.
- Call `excalidrawAPI.updateScene({ elements: reconcileElements(local, remote, appState), captureUpdate: CaptureUpdateAction.NEVER })`.
- Z-order comes from the elements' fractional `index`.

**Other rules:**
- Each person's Undo/Redo only affects their own edits, because remote updates aren't captured in history.
- **Images are disabled in v1** (image tool hidden; pasted images ignored).

**Build first, behind tests:**
- Evaluate the `y-excalidraw` package against the convergence tests in §8.
- Adopt it if it passes all of them. Otherwise ship our own binding.

### 7.3 Presence

- **Awareness state** (typed in `collab-protocol`): `{ userId, name, role, color, pointer?: {x, y, tool}, selectedElementIds }`.
- **Throttling:** pointer updates are sent about 30 times per second.
- **Display:** shown through Excalidraw's `collaborators` support (live named cursors and selections) and a header participant list with role badges.
- **Connection status:** provider status drives a "Reconnecting…" banner. Local edits stay buffered by Yjs and resync on reconnect.

## 8. Error handling and testing

### Errors
- oRPC typed errors: `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT` (invalid transition or failed conditional write), `BAD_REQUEST` (validation).
- The client maps WebSocket close reasons to dedicated screens: invalid link, ended, not started (waiting room), forbidden.
- **Save failures** are retried and logged. The live session continues from memory and client state.
- **SIGTERM:** close the HTTP server, then let Hocuspocus save all documents, then exit.
- One React error boundary per panel.
- **Logging:** pino structured logs with `requestId` and `sessionId`. Document content, notes, rubric and tokens are never logged.
- **Config:** zod-validated environment variables at startup. The app fails fast on missing or invalid config.

### Testing (all via Nx targets)

| Layer | Tooling | Coverage |
|---|---|---|
| Unit | Vitest | State machine transitions, timer and overtime math, token hashing and cookie signing, contract schemas |
| **Board binding** (first) | Vitest, two in-memory `Y.Doc`s, simulated scene changes | Convergence under concurrent move, edit and delete; delete-vs-edit; z-order; no remote edits in local undo; throttling |
| API integration | Vitest + Testcontainers (DynamoDB Local, MinIO), test auth stub | Templates CRUD, session commands and conflicts, invite lifecycle, org isolation, seed → board document |
| Real-time integration | Real Hocuspocus + Node `HocuspocusProvider` clients | Candidate rejected from notes; candidate rejected before start; read-only after end; candidate disconnected on end; revoked invite rejected; client stateless messages rejected; persistence round-trip |
| End-to-end | Playwright (`@nx/playwright`), two browser contexts, real Keycloak | Create session → candidate joins → draw → interviewer sees it live → extend → end → candidate sees ended screen, interviewer sees read-only + export |
| Boundaries | `@nx/enforce-module-boundaries` | §3.1 rules |

## 9. Live coding (future, not in v1)

What the v1 structure should make possible:
- Add `kind: 'system-design' | 'live-coding'` to templates and sessions. v1 writes only `system-design`.
- Shared editor: Monaco + `y-monaco`, with a new document `session:{id}:code` holding `files: Y.Map<path, Y.Text>`.
- Run output: broadcast to everyone as a server-only stateless message.
- New libraries: `web/feature-code-editor`, `web/ui-console`, `api/feature-runner`.
- The runner is a separate isolated service, never the API process:
  - "Run" button level: Lambda per run, or Judge0/Piston on EC2.
  - Full environment: one isolated container per session, or a managed sandbox (E2B, Daytona).

## 10. Local development

**`docker-compose.yml`:**
- `keycloak`: imports `swint` realm (confidential client `swint-api`; realm roles `interviewer`, `admin`; users `interviewer1`, `interviewer2`, `admin`)
- `dynamodb-local` + init job (table `swint`, GSI1, TTL attribute `expiresAt`)
- `minio` + init job (bucket `swint`)
- profile `app`: `api`, `web` (Nx-generated Dockerfiles; web served by nginx, which proxies `/api`, `/auth`, `/join`, `/collab` to api)

**Workflows:**
- **Day-to-day:**
  - `docker compose up` starts the infrastructure.
  - `pnpm nx run-many -t serve -p api web` runs the apps with hot reload.
  - The Vite dev proxy forwards `/api`, `/auth`, `/join`, `/collab` (WebSocket) to the API, so everything is same-origin.
- **Full stack:** `docker compose --profile app up --build`.

**Seed:** on API startup in dev, ensure org `default` exists and seed the template "Design a URL shortener" (instructions, rubric, starting board) if absent.

## 11. Open risks

1. **Excalidraw ↔ Yjs binding correctness**: mitigated by building it first behind convergence tests (§7.2, §8).
2. **Excalidraw API changes** (`captureUpdate`, `reconcileElements`, fractional `index`): pin the version; the binding tests act as an early warning.
3. **Single process holds all live documents**: fine for v1's scale. Running several API instances later would need Hocuspocus's Redis extension and sticky sessions per room.
