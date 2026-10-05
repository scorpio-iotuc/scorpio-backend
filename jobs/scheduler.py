import os
import subprocess
import time
from datetime import datetime, timedelta, timezone


# Helpers
def log(message: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    print(f"[{now}] {message}", flush=True)


def seconds_until_next_trigger_time_utc(trigger_time: str) -> float:
    now = datetime.now(timezone.utc)
    hour, minute = map(int, trigger_time.split(":")[:2])
    next_run = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if next_run <= now:
        next_run += timedelta(days=1)
    return max((next_run - now).total_seconds(), 1)


def run_job() -> None:
    log("Starting satellite upsert")
    result = subprocess.run(["python", "/app/upsert_satellites.py"], check=False)
    if result.returncode == 0:
        log("Satellite upsert completed successfully")
    else:
        log(f"Satellite upsert failed with exit code {result.returncode}")


# Main code
def main() -> None:
    # Check if the job should run on start
    run_on_start = os.getenv("RUN_ON_START", "false").lower() == "true"
    trigger_time = os.getenv("UPSERT_SATELLITES_TRIGGER_TIME", "00:00")
    if run_on_start:
        run_job()
    # Otherwise, wait until the next configured trigger time in UTC.
    while True:
        wait_seconds = seconds_until_next_trigger_time_utc(trigger_time)
        # Parse the wait seconds in to date time utc
        next_run_time = datetime.now(timezone.utc) + timedelta(seconds=wait_seconds)
        log(f"Next execution scheduled at {next_run_time.isoformat()}")
        time.sleep(wait_seconds)
        run_job()


if __name__ == "__main__":
    main()
