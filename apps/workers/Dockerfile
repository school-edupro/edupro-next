# syntax=docker/dockerfile:1.7
# Workers image (S5-05) with Chromium for PDF exports. Built from the monorepo root.
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/config/package.json packages/config/
COPY packages/db/package.json packages/db/
COPY packages/storage/package.json packages/storage/
COPY apps/workers/package.json apps/workers/
RUN pnpm install --frozen-lockfile --filter @edupro/workers... --prod=false

FROM deps AS build
COPY packages/config packages/config
COPY packages/db packages/db
COPY packages/storage packages/storage
COPY apps/workers apps/workers
RUN pnpm --filter @edupro/storage --filter @edupro/db --filter @edupro/workers build \
 && pnpm --filter @edupro/workers... deploy --prod /out

FROM mcr.microsoft.com/playwright:v1.63.0-noble AS runtime
ENV NODE_ENV=production EXPORT_PDF_ENGINE=playwright
WORKDIR /app
COPY --from=build /out .
USER pwuser
CMD ["node", "dist/main.js"]
