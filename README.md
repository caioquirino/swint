# Swint

Collaborative system-design interviews: shared instructions + a real-time whiteboard for candidates and interviewers.

## Local development

Requirements: Node 24, pnpm 12 (see `mise.toml`), Docker.

```bash
pnpm install
docker compose up -d                       # Keycloak :8080, DynamoDB Local :8000, S3Mock :9090
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
