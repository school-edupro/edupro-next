#!/usr/bin/env bash
# S2-13: per-school schema diff report from two MySQL dumps.
#   scripts/schema-diff.sh <reference.sql> <compared.sql> [reference-name] [compared-name] [legacy-root]
# Writes docs/data/reports/schema-diff-<reference-name>-vs-<compared-name>.md (folder is git-ignored: dumps
# and reports may name real schools). Runs in well under two minutes on a full dump: the parser streams.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REF="${1:?reference dump}"
CMP="${2:?compared dump}"
REF_NAME="${3:-$(basename "$REF" .sql)}"
CMP_NAME="${4:-$(basename "$CMP" .sql)}"
LEGACY_ROOT="${5:-}"
OUT_DIR="$ROOT/docs/data/reports"
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/schema-diff-${REF_NAME}-vs-${CMP_NAME}.md"
ARGS=(--ref "$REF" --cmp "$CMP" --ref-name "$REF_NAME" --cmp-name "$CMP_NAME" --out "$OUT")
if [[ -n "$LEGACY_ROOT" ]]; then ARGS+=(--legacy-root "$LEGACY_ROOT"); fi
node "$ROOT/scripts/schema-diff.mjs" "${ARGS[@]}"
echo "$OUT"
