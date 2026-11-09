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

FROM workspace AS web-build
RUN pnpm nx run web:build

FROM nginx:1.29-alpine AS web
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
