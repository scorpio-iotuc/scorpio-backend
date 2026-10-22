# Start the local development environment
```bash
docker compose --env-file dev.env -f docker-compose.dev.yml up --build -d
```
```bash
docker compose --env-file dev.env -f docker-compose.dev.yml logs 
```
Stop the services
```bash 

docker compose -f docker-compose.dev.yml down
```

Restart the services 
```bash 
docker compose -f docker-compose.dev.yml up -d
```

# Test CI workflow

Run these commands from the repository root. This reproduces the workflow's checks locally; it does not execute GitHub Actions itself. You need Node.js 22.12.0 (aligned with the Dockerfile), npm, Docker Compose with `--wait` support, curl and jq.

## Validate, compile and test

Use a subshell so the dummy DATABASE_URL does not replace your terminal's development configuration. These Prisma commands do not connect to a database.

```bash
(
  set -e
  export DATABASE_URL='postgresql://scorpio_ci:ci_only_password@localhost:5432/scorpio_ci'
  npm ci
  npx prisma validate
  npx prisma generate
  npm run build
  npm run build:seed
  npm test
)
```

Each command must exit successfully. Unit tests simulate repositories and do not call CelesTrak or PostgreSQL. The seed is compiled but not executed.

## Build and start Docker

Use the standalone CI Compose file, not the development or production configuration. It creates an isolated database with temporary storage and assigns a free host port. It does not require local environment files or production secrets.

```bash
docker compose -p scorpio-ci -f docker-compose.ci.yml build api
docker compose -p scorpio-ci -f docker-compose.ci.yml up -d --wait --wait-timeout 180
```

The API entrypoint applies migrations to the empty database. `--wait` checks that the containers become healthy; starting a container alone does not prove that the API is ready.

## Check HTTP and migrations

```bash
(
  set -e
  address=$(docker compose -p scorpio-ci -f docker-compose.ci.yml port api 3000)
  for endpoint in /health /api/health; do
    body=$(curl --fail --silent --show-error --connect-timeout 5 --max-time 15 "http://${address}${endpoint}")
    printf '%s' "$body" | jq -e '.status == "ok"'
  done
  docker compose -p scorpio-ci -f docker-compose.ci.yml exec -T api npx prisma migrate status
)
```

Both endpoints must return HTTP success with `{"status":"ok"}`. Prisma must report that the database schema is up to date. This verifies fresh database migrations, not upgrades against existing production data.

## Diagnose and clean up

If a check fails, inspect the containers before removing them:

```bash
docker compose -p scorpio-ci -f docker-compose.ci.yml ps -a
docker compose -p scorpio-ci -f docker-compose.ci.yml logs --no-color --tail=200
```

After testing, whether it succeeded or failed, remove the temporary stack:

```bash
docker compose -p scorpio-ci -f docker-compose.ci.yml down --volumes --remove-orphans
```

This removes the CI containers, network and temporary database, not the development stack.

## Verify on GitHub

Commit the workflow, Compose file, tests, application changes and migrations together. Open a pull request and inspect Checks or Actions. CI only runs on pull requests targeting `development`, `main` or `main`. To run the whole workflow locally without a pull request, see [Probar los workflows con act](CICD.md#probar-los-workflows-con-act).

Local checks do not validate GitHub triggers, action permissions or runner-specific behavior; the first GitHub run verifies those. Configure branch protection to require both jobs if failed CI should prevent merges. CI does not deploy to the VM.

Satellite worker scheduling, configuration and rollout: [Unreleased changelog](CHANGELOG.md#unreleased--worker-de-satelites-y-logs-2026-10-07).

## Adding a background job

Implement [JobInterface](../src/jobs/JobInterface.ts) in the job's directory and register it in [registry.ts](../src/jobs/registry.ts). The queue and coordinator require no job-specific changes.

- Give the implementation a unique `kind` and a display `name`. `schedule` enqueues due jobs idempotently; optional `onStartup` handles startup rules. Scheduling must never run the workload itself.
- `peekQueued` returns the oldest queued record as `{ id, createdAt }`; `hasRunning` detects active records. The queue compares all registered jobs, using registration order to break timestamp ties.
- `claim` uses the supplied transaction to conditionally change `queued` to `running` and initialize execution metadata. `recover` uses that same transaction boundary to fail interrupted jobs and clean up their staging data.
- `execute` runs after the claim transaction commits. It must await all work and persist completion or failure before resolving, including any job-specific notifications. Persistence failures must propagate so the coordinator stops and the next owner can recover the job.

All registered jobs share the coordinator's PostgreSQL session lock. Only the elected coordinator should call `recover` and `claimNext`; the queue's transaction alone does not replace that ownership lock. The polling loop continues scheduling while a job executes, and other jobs remain queued until it finishes.
