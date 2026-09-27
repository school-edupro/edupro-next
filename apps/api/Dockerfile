# syntax=docker/dockerfile:1.7
# API image (S5-05). Built from the monorepo root: docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/config/package.json packages/config/
COPY packages/db/package.json packages/db/
COPY packages/storage/package.json packages/storage/
COPY packages/api-client/package.json packages/api-client/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @edupro/api... --prod=false

FROM deps AS build
COPY packages/config packages/config
COPY packages/db packages/db
COPY packages/storage packages/storage
COPY apps/api apps/api
RUN pnpm --filter @edupro/storage --filter @edupro/db --filter @edupro/api build \
 && pnpm --filter @edupro/api... deploy --prod /out

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
