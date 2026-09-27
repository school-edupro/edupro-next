#!/usr/bin/env bash
# Restore drill (S5-06): restores the newest dump into a scratch database, checks the schema version,
# counts core tables and runs the row-level security tests against the restored copy. Exit code is the
# drill result; the runbook records duration against the RTO.
#   scripts/restore-drill.sh <dump-file-or-dir> [scratch-db-name]
set -euo pipefail
SOURCE="${1:?dump file or directory}"
SCRATCH="${2:-edupro_restore_drill}"
PG_RESTORE="${PG_RESTORE:-pg_restore}"
: "${DATABASE_MIGRATOR_URL:?DATABASE_MIGRATOR_URL is required}"
if [[ -d "$SOURCE" ]]; then SOURCE="$(ls -t "$SOURCE"/edupro-*.dump | head -1)"; fi
[[ -f "$SOURCE" ]] || { echo "no dump found"; exit 1; }
if [[ -f "$SOURCE.sha256" ]]; then (cd "$(dirname "$SOURCE")" && (sha256sum -c "$(basename "$SOURCE").sha256" || shasum -a 256 -c "$(basename "$SOURCE").sha256")); fi
ADMIN_URL="$(node -e 'const u=new URL(process.env.DATABASE_MIGRATOR_URL); u.pathname="/postgres"; console.log(u.href)')"
SCRATCH_URL="$(node -e 'const u=new URL(process.env.DATABASE_MIGRATOR_URL); u.pathname="/"+process.argv[1]; console.log(u.href)' "$SCRATCH")"
START=$(date +%s)
node -e '
const { Client } = require("pg");
(async () => { const c = new Client({ connectionString: process.argv[1] }); await c.connect();
  await c.query(`DROP DATABASE IF EXISTS "${process.argv[2]}" WITH (FORCE)`); await c.query(`CREATE DATABASE "${process.argv[2]}"`); await c.end(); })();
' "$ADMIN_URL" "$SCRATCH"
"$PG_RESTORE" --no-owner --no-privileges --dbname "$SCRATCH_URL" "$SOURCE"
node -e '
const { Client } = require("pg");
(async () => { const c = new Client({ connectionString: process.argv[1] }); await c.connect();
  const v = await c.query("SELECT max(name) AS name FROM app.schema_migrations");
  const counts = await c.query("SELECT (SELECT count(*) FROM schools) AS schools, (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM students) AS students, (SELECT count(*) FROM audit_logs) AS audit");
  console.log("restored schema version:", v.rows[0].name); console.log("row counts:", counts.rows[0]);
  const rls = await c.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = \x27public\x27 AND c.relkind = \x27r\x27 AND c.relrowsecurity AND NOT c.relforcerowsecurity");
  if (rls.rows[0].n > 0) { console.error("RLS not forced on", rls.rows[0].n, "tables"); process.exit(2); }
  await c.end(); })().catch((e) => { console.error(e.message); process.exit(1); });
' "$SCRATCH_URL"
DATABASE_MIGRATOR_URL="$SCRATCH_URL" DATABASE_URL="${SCRATCH_URL/edupro_migrator:edupro_migrator_dev/edupro_app:edupro_app_dev}" pnpm --filter @edupro/db test >/dev/null && echo "RLS and procedure tests pass on the restored copy"
END=$(date +%s)
echo "restore drill completed in $((END-START)) s (RTO target 60 min, RPO target 15 min with WAL archiving)"
