#!/usr/bin/env python3

"""
This script is used to upsert satellites in the SCORPIO system. It authenticates an automation user,
triggers the upsert process, and monitors its status until completion.

An example of the endpoint response is as follows:
```json
{
    "id": "09066014-f609-429c-b7fa-fe863ebe2800",
    "status": "failed",
    "started_at": "2026-10-02T19:18:34.274Z",
    "finished_at": "2026-10-02T19:18:35.696Z",
    "downloaded": false,
    "created": "2026-10-02T19:18:34.274Z",
    "updated": "2026-10-02T19:18:35.878Z",
    "error_message": "Satellite synchronization failed. Check server logs."
}
```
"""

import os
import sys
from datetime import datetime
from time import sleep
import requests

# Constants
OK = 0
ERROR = 1
MODE = "dev"


# Helpers
def log(message: str) -> None:
    print(f"[{datetime.now().astimezone().isoformat()}] {message}", flush=True)


def required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def build_api_url() -> str:
    if MODE == "dev":
        log("Running in development mode")
        return "http://localhost:3000/api"
    else:
        log("Running in production mode")
        return "https://scorpio.cpsrtc.cl/api"


# The main code
def main() -> int:
    api_url = required_env("SCORPIO_API_URL")
    email = required_env("SCORPIO_AUTOMATION_EMAIL")
    password = required_env("SCORPIO_AUTOMATION_PASSWORD")

    try:
        # Validate if the API is reachable
        api_health_response = requests.get(f"{api_url}/health", timeout=(15, 30))
        api_health_response.raise_for_status()
        api_status_code = api_health_response.status_code
        if api_status_code != 200:
            log(f"API health check failed with status code: {api_status_code}")
            log(f"Response: {api_health_response.text}")
            return ERROR
        else:
            log("API health check successful")

        log("Authenticating automation user")
        login_response = requests.post(
            f"{api_url}/auth/login",
            json={"email": email, "password": password},
            timeout=(15, 30),
        )
        login_response.raise_for_status()

        if login_response.status_code != 200:
            log(f"Login failed with status code: {login_response.status_code}")
            log(f"Response: {login_response.text}")
            return ERROR
        else:
            log("Login successful")

        login_payload = login_response.json()
        token = login_payload.get("token")
        if not token:
            raise RuntimeError("Login response does not contain a token")

        # Before triggering, we will check if there was a job alreaddy running or completed
        # (we will not trigger a new job if there is one running or completed at most 1 hour ago)
        status_response = requests.get(
            f"{api_url}/satellites/upsert",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
            },
            timeout=(15, 30),
        )

        status_payload = status_response.json()
        finished_at = status_payload.get("finished_at")
        status = status_payload.get("status", None)

        if not status:
            log("No previous satellite upsert job found. Trying to trigger a new job.")
            return OK
        # Avoid triggering a new job if there is one already running
        if status == "running":
            log("A satellite upsert job is already running. Exiting.")
            return OK
        # Avoid triggering a new job if the last one was completed or failed less than an hour ago
        elif (status == "completed" or status == "failed") and finished_at:
            finished_at_dt = datetime.fromisoformat(finished_at.replace("Z", "+00:00"))
            time_since_finished = datetime.now().astimezone() - finished_at_dt
            log(f"Last satellite upsert job completed at {finished_at_dt.isoformat()}")
            log(f"Time since last completion: {time_since_finished}")
            if time_since_finished.total_seconds() < 3600:
                log(
                    "A satellite upsert job was completed less than an hour ago. Exiting."
                )
                return OK

        # Trigger the satellite upsert process
        log("Starting satellite upsert")
        upsert_response = requests.post(
            f"{api_url}/satellites/upsert",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
            },
            timeout=(15, 30),
        )

        upsert_response.raise_for_status()
        status = upsert_response.json().get("status")
        # Query the status until it is no longer "running"
        while status == "running":
            log("Satellite upsert is still running, waiting for 10 seconds...")
            sleep(10)
            status_response = requests.get(
                f"{api_url}/satellites/upsert",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/json",
                },
                timeout=(15, 30),
            )
            status_response.raise_for_status()
            status = status_response.json().get("status")
        # Check the final status
        if status == "completed":
            log("Satellite upsert completed successfully")
            log(f"Final status response: {status_response.json()}")
            return OK
        else:
            log(f"Satellite upsert failed with status: {status}")
            error_message = status_response.json().get("error_message")
            if error_message:
                log(f"Error message: {error_message}")
            raise RuntimeError(f"Satellite upsert {status}")

    except requests.Timeout:
        log("Request timed out")
        return ERROR

    except requests.HTTPError as error:
        response = error.response
        log(f"HTTP error: {response.status_code if response else 'unknown'}")
        if response is not None:
            log(f"Response: {response.text}")
        return ERROR

    except requests.RequestException as error:
        log(f"Request error: {error}")
        return ERROR

    except Exception as error:
        log(f"Unexpected error: {error}")
        return ERROR


if __name__ == "__main__":
    sys.exit(main())
