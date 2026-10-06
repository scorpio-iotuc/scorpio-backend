#!/bin/sh
set -e

npx prisma migrate deploy
if [ "$SEED_ON_START" = "true" ]; then
  node dist-seed/prisma/seed.js
fi
exec node dist/server.js
