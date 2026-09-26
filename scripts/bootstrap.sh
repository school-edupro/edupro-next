#!/usr/bin/env bash
# First-time developer setup for EduPro Next (Sprint 0 task S0-04).
# Installs nothing system-wide; it checks prerequisites and prepares the local stack.
set -euo pipefail

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1 ($2)"; MISSING=1; }; }
MISSING=0
need node "install Node.js 22 LTS, e.g. with fnm or nvm; .nvmrc pins 22"
need docker "install Docker Desktop 24+"
need corepack "ships with Node.js 22"
if [ "$MISSING" = "1" ]; then
  echo "Install the missing tools and re-run scripts/bootstrap.sh"
  exit 1
fi

NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 22 ]; then echo "Node 22 required, found $(node -v)"; exit 1; fi

corepack enable
corepack prepare pnpm@9 --activate

[ -f .env ] || cp .env.example .env

pnpm install
docker compose up -d
echo "waiting for PostgreSQL..."
until docker exec edupro-postgres pg_isready -U edupro_migrator -d edupro >/dev/null 2>&1; do sleep 1; done

set -a; source .env; set +a
pnpm db:migrate
pnpm --filter @edupro/db seed:dev
pnpm db:test

echo
echo "Ready. Start everything with: pnpm dev"
echo "Admin app: http://localhost:3000 (developer sign-in: dev-admin)"
echo "API docs:  http://localhost:4000/api/docs"
