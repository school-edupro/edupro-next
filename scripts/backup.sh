#!/usr/bin/env bash
# Logical backup of the platform database (S5-06). Writes a compressed custom-format dump and prunes old ones.
#   scripts/backup.sh [target-dir] [retention-days]
# Requires pg_dump 16 on PATH (or PG_DUMP=/path/to/pg_dump) and DATABASE_MIGRATOR_URL in the environment.
# In Azure the same script runs from the backup container job with the storage account mounted at target-dir.
set -euo pipefail
TARGET="${1:-${BACKUP_DIR:-./backups}}"
RETENTION_DAYS="${2:-${BACKUP_RETENTION_DAYS:-30}}"
PG_DUMP="${PG_DUMP:-pg_dump}"
: "${DATABASE_MIGRATOR_URL:?DATABASE_MIGRATOR_URL is required}"
mkdir -p "$TARGET"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$TARGET/edupro-$STAMP.dump"
"$PG_DUMP" --format=custom --compress=6 --no-owner --no-privileges --file "$FILE" "$DATABASE_MIGRATOR_URL"
sha256sum "$FILE" > "$FILE.sha256" 2>/dev/null || shasum -a 256 "$FILE" > "$FILE.sha256"
SIZE=$(du -h "$FILE" | cut -f1)
echo "backup written: $FILE ($SIZE)"
# Retention: keep the last N days; the object store's lifecycle rule keeps monthly copies for a year.
find "$TARGET" -name 'edupro-*.dump' -mtime +"$RETENTION_DAYS" -print -delete | sed 's/^/pruned: /' || true
find "$TARGET" -name 'edupro-*.dump.sha256' -mtime +"$RETENTION_DAYS" -delete || true
