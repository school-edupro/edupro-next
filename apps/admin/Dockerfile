# syntax=docker/dockerfile:1.7
# Admin app image (S5-05): Next.js standalone output. Built from the monorepo root.
# As the API's: the packages from the lockfile, then the whole workspace.
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
# the same pnpm as packageManager in package.json
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile --filter "@edupro/admin..." \
 && pnpm --filter "@edupro/admin..." build \
 && mkdir -p apps/admin/public

FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S edupro && adduser -S edupro -G edupro
WORKDIR /app
COPY --from=build /repo/apps/admin/.next/standalone ./
COPY --from=build /repo/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=build /repo/apps/admin/public ./apps/admin/public
USER edupro
EXPOSE 3000
CMD ["node", "apps/admin/server.js"]
