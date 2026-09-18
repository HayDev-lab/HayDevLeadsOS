#!/bin/bash

set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/home/z/my-project}"
BUILD_DIR="${BUILD_DIR:?BUILD_DIR is required}"
TARGET_DB_DIR="$BUILD_DIR/db"
TARGET_DB_PATH="$TARGET_DB_DIR/custom.db"

mkdir -p "$TARGET_DB_DIR"

# v0.20 closure §6 — SEED-ONLY DEMO ARTIFACT.
#
# The packaged demo NEVER copies the developer's preview runtime DB:
# db/custom.db may contain QA mutations, test leads and ad-hoc data — shipping
# it would leak the preview state and make the artifact non-reproducible.
# Instead the artifact database is built deterministically from scratch:
#
#     fresh SQLite → prisma migrate deploy → deterministic demo seed
#
# A REAL production build never embeds ANY database: the schema is applied to
# the EXTERNAL DATABASE_URL at deploy time via `prisma migrate deploy`
# (see README — Deploy), and the server fails fast at boot without it
# (src/instrumentation.ts).
#
# Guard: tests/build-artifact.test.ts asserts this script never references the
# preview DB and always uses migrate deploy (never `db push`).
isDemoMode() {
    [ "${LEADOS_DEMO:-}" = "true" ] || grep -qE '^LEADOS_DEMO="?true"?' "$PROJECT_DIR/.env" 2>/dev/null || grep -qE '^LEADOS_DEMO="?true"?' "$PROJECT_DIR/.env.local" 2>/dev/null
}

if isDemoMode; then
    # ---- PACKAGED DEMO BUILD (seed-only) ---------------------------------
    echo "🗄️  Packaged DEMO build: initializing a FRESH deterministic demo database..."
    rm -f "$TARGET_DB_PATH" "$TARGET_DB_PATH-journal" "$TARGET_DB_PATH-wal" "$TARGET_DB_PATH-shm"
    (
        cd "$PROJECT_DIR"
        DATABASE_URL="file:$TARGET_DB_PATH" bunx prisma migrate deploy
        LEADOS_DEMO=true DATABASE_URL="file:$TARGET_DB_PATH" bun run db:seed:demo
    )
    if [ ! -f "$TARGET_DB_PATH" ]; then
        echo "❌ Demo database initialization succeeded but $TARGET_DB_PATH was not created"
        exit 1
    fi
    echo "✅ Fresh seeded demo database ready (deterministic, no preview data)"
    ls -lah "$TARGET_DB_DIR"
else
    # ---- PRODUCTION BUILD (§7: NO embedded database) ----------------------
    echo "🏭  PRODUCTION build: no database is packaged."
    echo "    Deploy step (see README — Deploy): DATABASE_URL=<external> bunx prisma migrate deploy"
    echo "    The server boot fails fast without DATABASE_URL (src/instrumentation.ts)."
fi
