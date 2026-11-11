# Swint

**Collaborative system-design interviews.** An interviewer picks a template, starts a session and sends the candidate a
link. Both sides then share the instructions, a timer and a live Excalidraw whiteboard. The interviewers also get a
private rubric and shared notes, and the candidate never receives either.

- Runs fully locally with Docker Compose. There is no cloud dependency.
- Nx monorepo: a React web app, a single Node API with real-time collaboration built in, and shared typed contracts.

---

## Contents

- [Features](#features)
- [Quick start](#quick-start)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Configuration](#configuration)
- [Testing](#testing)
- [Full stack in containers](#full-stack-in-containers)
- [Deployment notes](#deployment-notes)
- [Design docs](#design-docs)

---

## Features

### Templates

Interviewers write templates in the app.

- **Full-page tabs** for _Instructions_, _Rubric_ and _Starting board_, so each section gets the whole viewport.
- **WYSIWYG editing** (TipTap) that is stored as markdown. It covers headings, emphasis, lists, checklists, tables,
  quotes, code blocks and links. A section you don't touch is saved back exactly as it was.
- **Starting board:** draw the initial diagram with the same Excalidraw board used in interviews.
- A duration per template, archiving, and a warning when someone else saved the template while you were editing it.

### Sessions

- Create a session from a template. You get a **candidate link** (`/join/…`) and an **interviewer link** (`/s/…`).
- **The session copies its template when it is created.** Later template edits never change existing sessions.
- **Lifecycle:** `created → live → ended`, or `cancelled` from either of the first two. Interviewers _start_, _extend_
  (+5 or +10 min), _end_ and _cancel_ a session. They can also _regenerate_ the candidate link, which revokes the old one.
- **Timer:** the server owns it. Warnings at 10 and 2 minutes, then **overtime**. Nothing locks automatically.

### Interview room

- **Real-time whiteboard** (Excalidraw + Yjs):
  - live cursors and selections;
  - **Follow** another participant's viewport;
  - a remote laser pointer;
  - a fixed shape library;
  - a clean style (no hand-drawn font or sloppiness).
- **Side panel**, resizable:
  - _Instructions_, shown to everyone;
  - _Rubric_ and collaborative _Notes_, for interviewers only.
- **Candidate experience:**
  - before the start: a waiting room only;
  - while live: the instructions, an editable board and the timer;
  - afterwards: an "interview ended" screen.
- **After the interview:** interviewers revisit the room read-only and export the board as PNG, SVG or
  `.excalidraw`.
- **Theme:** light, dark or system, everywhere.

### Security model

- **Interviewers** sign in with OIDC (Authorization Code + PKCE against Keycloak) and the `interviewer` realm role.
- **Candidates** exchange their invite token for an httpOnly cookie that is scoped to a single session. The token
  never appears in the room URL or on the WebSocket.
- **The server enforces what each role can see and do,** not the UI:
  - the rubric and notes live in endpoints and documents that candidates cannot access;
  - every candidate request and socket checks again that the invite is still valid and the session is still live.

---

## Quick start

**Requirements:** Node 24 and pnpm 12 (pinned in `mise.toml`), plus Docker.

```bash
pnpm install
docker compose up -d                       # Keycloak :8080, DynamoDB Local :8000, S3Mock :9090 (bound to 127.0.0.1)
pnpm nx run-many -t serve -p api web       # API :3000 (watch mode) + web :4200 (Vite)
```

1. Open **http://localhost:4200** and sign in as `interviewer1` / `password`.
2. Pick a template (development seeds _Design a URL shortener_) and create a session.
3. Open the **candidate link** in a private window to play the candidate. Start the session from the interviewer side.

| Users (Keycloak realm `swint`, password `password`) | Role             |
| --------------------------------------------------- | ---------------- |
| `interviewer1`, `interviewer2`                      | interviewer      |
| `admin`                                             | admin (reserved) |

- **Keycloak admin console:** http://localhost:8080 (admin / admin).
- **Port 3000 already in use?** Run `PORT=3100 pnpm nx serve api`, then
  `SWINT_API_URL=http://localhost:3100 pnpm nx serve web`.

**Useful endpoints:**

- `GET http://localhost:3000/healthz`
- `GET http://localhost:3000/api/openapi.json`: the OpenAPI document, generated from the oRPC contract.
- `ws://localhost:3000/collab`: real-time collaboration (Hocuspocus/Yjs).
  - It authenticates with the interviewer or candidate cookie.
  - Its documents are `session:<id>:board` and `session:<id>:notes`.

---

## Architecture

```
            ┌──────────────────── Browser (React 19 + Vite) ────────────────────┐
            │  Dashboard · Template editor · Room (Instructions | Board | Notes) │
            │  Excalidraw ◀─▶ BoardSync (Yjs) ◀─▶ HocuspocusProvider             │
            └──────────────┬─────────────────────────────────┬──────────────────┘
                 HTTP (oRPC/REST, cookies)          WebSocket /collab (Yjs, awareness,
                           │                         server-only state messages)
            ┌──────────────▼─────────────────────────────────▼──────────────────┐
            │  apps/api — one Node process                                       │
            │  Fastify · oRPC · OIDC (openid-client) · Hocuspocus                │
            │  session lifecycle · timer state · access checks per role          │
            └───────────┬──────────────────────────────────────┬────────────────┘
                        │                                      │
              DynamoDB (single table + GSI1)          S3 (Yjs snapshots, checkpoints,
              users, templates, sessions,              starting boards)
              invites, auth sessions
```

**Key decisions:**

- **Contract first.** The API is defined once as an oRPC contract with zod schemas in
  `libs/shared/api-contract`. The web app gets a typed client from it, and the API serves OpenAPI from it. There is
  no code-generation step.
- **One Yjs document per trust level.**
  - `board`: candidates can write to it while the session is live.
  - `notes`: interviewers only; a candidate connection is rejected when it opens.
  - Session state (status, timer) is sent as **typed stateless messages** that only the server can emit.
- **Persistence:**
  - DynamoDB stores records, with conditional writes on `status`/`version` for every lifecycle change.
  - S3 stores the Yjs state (saved when edits pause, plus checkpoints about every 5 minutes) and the templates'
    starting boards.
- **Styling:** the UI uses Tailwind v4 and Radix primitives, and Excalidraw 0.18 renders the board. The notes editor
  uses TipTap's Collaboration extension, and the template editor uses `@tiptap/markdown`.

**Module boundaries:** `@nx/enforce-module-boundaries` enforces these rules.

- **By scope:**
  - `scope:web` and `scope:api` may depend only on themselves and on `scope:shared`.
  - `scope:shared` runs anywhere: no DOM and no Node built-ins.
- **By type:** `ui` libraries never import `data-access` or `feature` libraries. The whiteboard UI receives a
  `Y.Doc` and awareness and never touches the network itself.

---

## Repository layout

```
apps/
  api/        Fastify server: oRPC router, OIDC, Hocuspocus at /collab, dev seed
  web/        React SPA (Vite; proxies /api /auth /join /collab to the API in dev)
  web-e2e/    Playwright tests (interviewer + candidate browser contexts)
libs/
  shared/
    api-contract/        oRPC contract + zod schemas
    collab-protocol/     document names, typed accessors, stateless messages, roles, awareness (see its README)
    domain/              session state machine, timer and overtime math
  web/
    feature-dashboard/        session and template lists, interviewer layout
    feature-session-room/     the interview room for both roles
    feature-template-editor/  tabbed WYSIWYG editor + starting board
    ui-primitives/            buttons, dialogs, menus (Radix + Tailwind)
    ui-session-panels/        instructions/rubric markdown, timer bar, participants, notes
    ui-whiteboard/            Excalidraw wrapper, BoardSync (Yjs binding), board style, library
    data-access-api/          oRPC client + TanStack Query hooks
    data-access-collab/       Hocuspocus provider, presence
  api/
    feature-auth/             OIDC login/logout, cookie sessions, candidate invite exchange
    feature-templates/        template CRUD and starting-board seeds
    feature-sessions/         lifecycle, invites, timer broadcasts
    collab-server/            Hocuspocus config: auth, permissions, persistence, awareness stamping
    data-access-persistence/  DynamoDB + S3 repositories (+ Testcontainers helpers under ./testing)
    util-rpc/                 shared oRPC plumbing
docker/       Keycloak realm import (nginx config: apps/web/nginx.conf; images: Dockerfile)
docs/         design specs and implementation plans
```

---

## Configuration

The API reads its environment through `apps/api/src/app/config.ts`. Development needs no variables at all: every
default points at the Compose services.

| Variable                                  | Default (dev)                                     | Notes                                                                                     |
| ----------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `PORT` / `HOST`                           | `3000` / `0.0.0.0`                                |                                                                                           |
| `PUBLIC_BASE_URL`                         | `http://localhost:4200`                           | **Required in production.** Also the only origin allowed for WebSocket upgrades.          |
| `OIDC_ISSUER`                             | `http://localhost:8080/realms/swint`              | **Required in production.**                                                               |
| `OIDC_INTERNAL_URL`                       | —                                                 | Set it when the API reaches the identity provider on a different origin than browsers do. |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET`   | `swint-api` / `swint-dev-secret`                  | **The secret is required in production.**                                                 |
| `COOKIE_SECRET`                           | dev-only value                                    | **Required in production:** at least 32 characters.                                       |
| `DYNAMODB_ENDPOINT` / `S3_ENDPOINT`       | `http://localhost:8000` / `http://localhost:9090` | Leave both unset in production to use real AWS.                                           |
| `AWS_REGION`, `TABLE_NAME`, `BUCKET_NAME` | `us-east-1`, `swint`, `swint`                     |                                                                                           |
| `ENSURE_INFRA`                            | `true` outside production                         | Creates the table and the bucket at startup if they are missing.                          |
| `SEED_DEV_DATA`                           | `true` in development                             | Seeds the demo template.                                                                  |
| `COLLAB_REVALIDATE_MS`                    | `60000`                                           | How often open sockets re-check auth, so sign-out and role removal reach live rooms.      |
| `LOG_LEVEL`                               | `info`                                            |                                                                                           |

**Web dev server:** `SWINT_API_URL` is the API that Vite proxies to. It defaults to `http://localhost:3000`.

---

## Testing

Always run tests through Nx. Integration tests start their own containers through Testcontainers, so Docker must be
running.

```bash
pnpm nx run-many -t lint test typecheck build     # everything
pnpm nx test web-feature-template-editor          # one project
pnpm nx affected -t test                          # only what changed
```

**End-to-end:** Playwright drives an interviewer and a candidate through the real Keycloak login.

```bash
docker compose up -d                      # infra
pnpm exec playwright install chromium     # once
pnpm nx e2e web-e2e                       # starts (or reuses) the dev servers on :4200
E2E_BASE_URL=http://localhost:8088 pnpm nx e2e web-e2e   # against the container stack below
```

- Reports and traces are written to `dist/.playwright/apps/web-e2e/`.
- The e2e tests create their own templates and sessions, and never edit existing ones.

---

## Full stack in containers

```bash
docker compose --profile app up -d --build --wait   # http://localhost:8088
```

Sign in as `interviewer1` / `password`.

- **Web:** nginx serves the built SPA and proxies `/api`, `/auth`, `/join` and `/collab` (WebSocket) to the `api`
  container.
- **API:**
  - runs with `NODE_ENV=production` and seeds the demo template;
  - reaches Keycloak at `http://keycloak:8080`, while browsers keep using `http://localhost:8080`.
- All ports are bound to 127.0.0.1.
- If you changed `docker/keycloak/swint-realm.json`, re-import it with
  `docker compose up -d --force-recreate keycloak`.

---

## Deployment notes

- **Run exactly one API replica.** Live collaboration documents and session events are held in process memory.
  Scaling out needs sticky routing per session, plus pub/sub such as the Hocuspocus Redis extension.
- **Before any non-local deployment**, add security headers and a CSP in nginx (clickjacking protection).
- **Safari:** cookies are `Secure` outside development, so Safari won't keep them over plain
  `http://localhost:8088`. Use another browser locally, or put HTTPS in front.

---

## Design docs

- [Foundation design](docs/superpowers/specs/2026-11-08-swint-foundation-design.md): goals, data model, auth, lifecycle
  and real-time protocol.
- [Template editor design](docs/superpowers/specs/2026-11-10-template-editor-design.md): tabs, WYSIWYG markdown and GFM
  in the room.
- [Real-time client contract](libs/shared/collab-protocol/README.md)
- Implementation plans: [`docs/superpowers/plans/`](docs/superpowers/plans/)
