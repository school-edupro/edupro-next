#!/usr/bin/env bash
# Start, stop or inspect the user-space PostgreSQL 16 and Redis used for local development on machines
# without Docker. Binaries live under ~/.local (installed by the Sprint 0 first build); data under ~/.local.
# Usage: scripts/local-stack.sh start|stop|status
set -euo pipefail
PG_BIN="$HOME/.local/pgsql/bin"; PG_DATA="$HOME/.local/pgdata"
REDIS_BIN="$HOME/.local/bin"; REDIS_DIR="$HOME/.local/var/redis"
cmd="${1:-status}"
case "$cmd" in
  start)
    if [ ! -f "$PG_DATA/PG_VERSION" ]; then
      echo "edupro_migrator_dev" > /tmp/edupro-pgpw
      "$PG_BIN/initdb" -D "$PG_DATA" -U edupro_migrator --pwfile=/tmp/edupro-pgpw --auth-local=scram-sha-256 --auth-host=scram-sha-256 -E UTF8 >/dev/null
      rm -f /tmp/edupro-pgpw
    fi
    "$PG_BIN/pg_ctl" -D "$PG_DATA" -l "$PG_DATA/server.log" -o "-p 5432 -c listen_addresses=localhost" start >/dev/null || true
    mkdir -p "$REDIS_DIR"
    "$REDIS_BIN/redis-cli" ping >/dev/null 2>&1 || "$REDIS_BIN/redis-server" --daemonize yes --port 6379 --dir "$REDIS_DIR" --logfile "$REDIS_DIR/redis.log" --appendonly yes >/dev/null
    "$0" status ;;
  stop)
    "$PG_BIN/pg_ctl" -D "$PG_DATA" stop >/dev/null 2>&1 || true
    "$REDIS_BIN/redis-cli" shutdown >/dev/null 2>&1 || true
    echo "stopped" ;;
  status)
    "$PG_BIN/pg_ctl" -D "$PG_DATA" status 2>/dev/null | head -1 || echo "pg_ctl: no server running"
    printf "redis: %s\n" "$("$REDIS_BIN/redis-cli" ping 2>/dev/null || echo down)" ;;
  *) echo "usage: $0 start|stop|status"; exit 1 ;;
esac
