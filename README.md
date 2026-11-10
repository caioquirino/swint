# Swint

Collaborative system-design interviews: shared instructions + a real-time whiteboard for candidates and interviewers.

## Local development

Requirements: Node 24, pnpm 12 (see `mise.toml`), Docker.

```bash
pnpm install
docker compose up -d                       # Keycloak :8080, DynamoDB Local :8000, S3Mock :9090 (bound to 127.0.0.1)
pnpm nx run-many -t serve -p api web       # API :3000 (watch mode) + web :4200 (Vite, proxies /api /auth /join /collab)
```

Open http://localhost:4200 and sign in as `interviewer1` / `password`. In development the API seeds the
"Design a URL shortener" template. Create a session from the dashboard: the candidate link (`/join/…`) is
for the candidate (open it in a private window to try it), the interviewer link (`/s/…`) for other interviewers.

If port 3000 is taken: `PORT=3100 pnpm nx serve api` and `SWINT_API_URL=http://localhost:3100 pnpm nx serve web`.

Test users (Keycloak realm `swint`, password `password`): `interviewer1`, `interviewer2`, `admin`.
Keycloak admin console: http://localhost:8080 (admin / admin).

Useful endpoints:

- `GET http://localhost:3000/healthz`
- `GET http://localhost:3000/api/openapi.json`
- `ws://localhost:3000/collab` — real-time collaboration (Hocuspocus/Yjs). Requires the session cookie (interviewer) or candidate cookie; documents `session:<id>:board` and `session:<id>:notes`.

Tests (integration tests start their own containers via Testcontainers; Docker must be running):

```bash
pnpm nx run-many -t lint test typecheck
```

## Full stack in containers

```bash
docker compose --profile app up -d --build --wait   # web (nginx) on http://localhost:8088, API behind it
```

Sign in as `interviewer1` / `password`. nginx serves the built SPA and proxies `/api`, `/auth`, `/join` and `/collab`
(WebSocket) to the `api` container. The API runs with `NODE_ENV=production`, seeds the demo template and reaches
Keycloak through `OIDC_INTERNAL_URL=http://keycloak:8080` while browsers keep using `http://localhost:8080`.
Infra ports are bound to 127.0.0.1 only.

If you changed `docker/keycloak/swint-realm.json`, re-import it with `docker compose up -d --force-recreate keycloak`.

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
