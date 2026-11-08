# syntax=docker/dockerfile:1.7
# API image (S5-05). Built from the monorepo root: docker build -f apps/api/Dockerfile .
# The packages are fetched from the lockfile alone (a layer kept while it does not change), then the
# whole workspace is copied, so a new workspace package of the API needs no change here.
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# the same pnpm as packageManager in package.json
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile --filter "@edupro/api..." \
 && pnpm --filter "@edupro/api..." build \
 && pnpm --filter @edupro/api deploy --prod /out

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
RUN addgroup -S edupro && adduser -S edupro -G edupro
WORKDIR /app
COPY --from=build /out .
# migrations ship with the db package so the schema check has its reference list
USER edupro
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:4000/api/v1/health || exit 1
CMD ["node", "dist/main.js"]
