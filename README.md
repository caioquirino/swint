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
