#!/bin/sh

set -eu

echo "Starting scheduler..."
exec python /app/scheduler.py
echo "Scheduler finished."