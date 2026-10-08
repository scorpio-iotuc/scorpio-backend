#!/bin/sh
set -e

if [ "${1:-}" = "worker" ]; then
  exec node dist/jobs/upsert_satellites_points.js
fi

npx prisma migrate deploy
if [ "$SEED_ON_START" = "true" ]; then
  node dist-seed/prisma/seed.js
fi
exec node dist/server.js
