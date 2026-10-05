#!/bin/sh

set -eu

echo "Starting scheduler..."
exec python /app/upsert_satellites_scheduler.py
echo "Scheduler finished."