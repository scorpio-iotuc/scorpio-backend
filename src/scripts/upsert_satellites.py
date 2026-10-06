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
        log("Authenticating automation user")
        login_response = requests.post(
            f"{api_url}/auth/login",
            json={
                "email": email,
                "password": password,
            },
            timeout=(15, 30),
        )
        login_response.raise_for_status()
        login_payload = login_response.json()
        token = login_payload.get("token")

        if not token:
            raise RuntimeError("Login response does not contain a token")

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
                f"{api_url}/satellites/upsert/status",
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
            log(f"Final status response: {status_response.json()}")
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
