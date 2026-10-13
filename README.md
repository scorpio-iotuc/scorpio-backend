# Scorpio API 🦂

Backend API for the Scorpio UC project.

## Docker

### Start the full stack from zero

This starts Postgres, runs Prisma migrations inside the API container, and then seeds the database.

```bash
docker compose down -v
docker compose up --build
```
The first command will remove the database volumes, so you will start with an empty Postgres DB.

### Start the full stack without rebuilding images

Use this when Dockerfiles and dependencies have not changed.

```bash
docker compose up -d
```

#### Update the API container without rebuilding the image
```bash
docker compose up -d --build api
```

### Stop all services

```bash
docker compose stop
```

### Stop and remove all containers

Use this when you want to start fresh again later. If you run `up` after this, the API container will execute migrations and seed again.

```bash
docker compose down
```

## Prisma
### Create a new migration

When the stack is up, create migrations from the API container. 
This will create a new migration inside the docker service. 
```bash
docker compose exec api yarn prisma migrate dev --name <feature-name>
```
Note: Run this command after changing **schema.prisma**. Prisma reads the database URL from `prisma.config.ts`, so `DATABASE_URL` must be set in your shell when you run it on the host.

Example of the database url on the Raspberry Pi host:
```bash
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres?schema=public"
```

### Access to the Database
To access the database, you can use the following command:

```bash
docker compose exec db psql -U postgres -d postgres
```



# Watch logs

Logs from all containers:

```bash
docker compose logs -f
```

Filter the logs for the backend or api container.

```bash
docker compose logs -f api
docker compose logs -f db
```

# Development
This that you should consider before starting the stack:
- You must include an environment file in your main directory. Refer to the '.env.example' file for details of the variables required to work in the development environment of this API. 
- If you would like to receive packets from the MQTT stack installed in ScorpioProject, you must have created a Docker network. If you haven't already created a network on the Raspberry Pi, you should run this command:
```bash
docker network create scorpio-net
```

## Discord notifications

Set `DISCORD_WEBHOOK_URL` in `dev.env` (production: `.env`). The jobs service
already loads the file through `env_file`. Keep the webhook URL secret.
If it is absent, the worker runs with notifications disabled.

The worker sends notifications when it creates a startup or scheduled job
(`status=queued`), starts an import (`status=running`), and successfully finishes
(`status=completed`). Jobs queued through the API receive their first notification
when the worker starts them. Failures send an alert with the job ID, `status=failed`,
and the error message after the failure is saved. Restart recovery sends a summary
of interrupted jobs marked failed; fatal worker errors also send an alert.

Discord delivery errors are logged separately and never change job status.
Messages are truncated to fit Discord's limit. Delivery is best effort, with a
10-second request timeout and no automatic retries. Abrupt process termination
may prevent delivery; interrupted jobs are reported during restart recovery.

Recreate the development jobs container after updating configuration:

```bash
docker compose --env-file dev.env -f docker-compose.dev.yml up -d --build jobs
```
