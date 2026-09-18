#!/bin/bash

set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/home/z/my-project}"
BUILD_DIR="${BUILD_DIR:?BUILD_DIR is required}"
SOURCE_DB_DIR="$PROJECT_DIR/db"
SOURCE_DB_PATH="$SOURCE_DB_DIR/custom.db"
TARGET_DB_DIR="$BUILD_DIR/db"
TARGET_DB_PATH="$TARGET_DB_DIR/custom.db"

mkdir -p "$TARGET_DB_DIR"

# v0.19.2 §25–26 (hardening): the PREVIEW RUNTIME DB may be packaged ONLY
# into the packaged-demo build (LEADOS_DEMO=true — the public demo). A real
# production build NEVER embeds the preview database: no runtime data ships
# in the artifact; the schema is applied to the EXTERNAL database at deploy
# time via `prisma migrate deploy` (see README — Deploy), and the server
# fails fast at boot without DATABASE_URL (src/instrumentation.ts).
isDemoMode() {
    [ "${LEADOS_DEMO:-}" = "true" ] || grep -qE '^LEADOS_DEMO="?true"?' "$PROJECT_DIR/.env" 2>/dev/null || grep -qE '^LEADOS_DEMO="?true"?' "$PROJECT_DIR/.env.local" 2>/dev/null
}

if isDemoMode; then
    # ---- PACKAGED DEMO BUILD -------------------------------------------
    if [ -f "$SOURCE_DB_PATH" ]; then
        echo "🗄️  Packaged DEMO build: copying the demo database into the artifact..."
        cp -a "$SOURCE_DB_DIR/." "$TARGET_DB_DIR/"
    else
        echo "ℹ️  Demo build, no db/custom.db found — a fresh demo database will be initialized (seed via POST /api/v1/seed or scripts/reseed-demo.ts)"
    fi
    echo "🗄️  同步构建产物中的数据库结构..."
    (
        cd "$PROJECT_DIR"
        DATABASE_URL="file:$TARGET_DB_PATH" bun run db:push
    )
    if [ ! -f "$TARGET_DB_PATH" ]; then
        echo "❌ 数据库初始化命令执行成功，但未生成 $TARGET_DB_PATH"
        exit 1
    fi
    echo "✅ 构建产物数据库已准备完成"
    ls -lah "$TARGET_DB_DIR"
else
    # ---- PRODUCTION BUILD (§26: NO preview DB promotion) -----------------
    echo "🏭  PRODUCTION build: the preview runtime db/custom.db is NOT packaged."
    echo "    Deploy step (see README — Deploy): DATABASE_URL=<external> bunx prisma migrate deploy"
    echo "    The server boot fails fast without DATABASE_URL (src/instrumentation.ts)."
fi
