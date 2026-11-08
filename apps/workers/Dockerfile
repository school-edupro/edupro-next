# syntax=docker/dockerfile:1.7
# Workers image (S5-05) with Chromium for PDF exports. Built from the monorepo root.
# As the API's: the packages from the lockfile, then the whole workspace.
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# the same pnpm as packageManager in package.json
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile --filter "@edupro/workers..." \
 && pnpm --filter "@edupro/workers..." build \
 && pnpm --filter @edupro/workers deploy --prod /out

FROM mcr.microsoft.com/playwright:v1.63.0-noble AS runtime
ENV NODE_ENV=production EXPORT_PDF_ENGINE=playwright
WORKDIR /app
COPY --from=build /out .
USER pwuser
CMD ["node", "dist/main.js"]
