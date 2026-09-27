# syntax=docker/dockerfile:1.7
# Admin app image (S5-05): Next.js standalone output. Built from the monorepo root.
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/config/package.json packages/config/
COPY packages/ui/package.json packages/ui/
COPY apps/admin/package.json apps/admin/
RUN pnpm install --frozen-lockfile --filter @edupro/admin... --prod=false

FROM deps AS build
COPY packages/config packages/config
COPY packages/ui packages/ui
COPY apps/admin apps/admin
RUN pnpm --filter @edupro/ui build && pnpm --filter @edupro/admin build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S edupro && adduser -S edupro -G edupro
WORKDIR /app
COPY --from=build /repo/apps/admin/.next/standalone ./
COPY --from=build /repo/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=build /repo/apps/admin/public ./apps/admin/public
USER edupro
EXPOSE 3000
CMD ["node", "apps/admin/server.js"]
