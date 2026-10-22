import "dotenv/config";
import { Client } from "pg";
import { Logger } from "../lib/Logger";
import { prisma } from "../lib/prisma";
import { JobQueue } from "./queue";
import { createJobRegistry } from "./registry";
import NotifyClient from "./notify/NotifyClient";
import { safeNotify } from "./notify/safe-notify";

const logger = new Logger("Jobs");
const notifications = process.env.DISCORD_WEBHOOK_URL?.trim()
  ? new NotifyClient("discord-bot", {
      webhookUrl: process.env.DISCORD_WEBHOOK_URL!.trim(),
    })
  : undefined;
const owner = new Client({
  connectionString: process.env.DATABASE_URL,
  keepAlive: true,
});
let stopping = false;
let active: Promise<void> | null = null;
let activeJob: { id: string; kind: string } | null = null;
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// The same session lock serializes all registered job types across all worker replicas.
owner.on("error", (error) => {
  logger.error("Worker ownership connection lost", error);
  process.exit(1);
});
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    stopping = true;
    if (active) {
      logger.error(
        "Interrupted; running job will be recovered by the next elected worker",
      );
      process.exit(1);
    }
  });
}

async function main(): Promise<void> {
  const jobs = createJobRegistry(notifications);
  const queue = new JobQueue(jobs);
  await owner.connect();
  let waitingForOwnership = false;
  while (!stopping) {
    if (
      (await owner.query("SELECT pg_try_advisory_lock(8432, 1) AS acquired"))
        .rows[0].acquired
    )
      break;
    if (!waitingForOwnership)
      logger.info(
        "Waiting for worker ownership; another replica owns the job coordinator",
      );
    waitingForOwnership = true;
    await sleep(2000);
  }
  if (stopping) return;
  logger.info("Worker ownership acquired");
  // Recover any jobs that were running when the previous worker crashed or was stopped.
  const recovered = await queue.recover();
  if (recovered)
    await safeNotify(
      notifications,
      "alert",
      `${recovered} job(s): status=failed; interrupted by worker restart.`,
    );
  // Queue any jobs that should be scheduled now
  for (const job of await queue.onStartup(new Date())) {
    await safeNotify(
      notifications,
      "notify",
      `${job.name} ${job.id}: queued on startup; status=queued`,
    );
  }
  logger.info("Ready", {
    jobs: jobs.map((job) => ({ kind: job.kind, name: job.name })),
  });
  // The main loop is responsible for scheduling jobs, claiming the next job to run, and reporting waiting jobs.
  while (!stopping) {
    await owner.query("SELECT 1");
    for (const job of await queue.schedule(new Date())) {
      await safeNotify(
        notifications,
        "notify",
        `${job.name} ${job.id}: scheduled; status=queued`,
      );
    }
    // Claim the next job to run, if any, and execute it
    if (!active) {
      const next = await queue.claimNext(new Date());
      if (next) {
        activeJob = { id: next.id, kind: next.kind };
        // Do not await here: the loop must still enqueue scheduled jobs while work runs.
        active = next
          .execute()
          .catch(async (error) => {
            logger.error("Job could not persist its final status", error);
            stopping = true;
            process.exitCode = 1;
            await safeNotify(
              notifications,
              "alert",
              "Worker stopped after a job persistence failure.",
            );
          })
          .finally(() => {
            active = null;
            activeJob = null;
          });
      }
    }
    // Report any jobs that are waiting for the currently running job to finish, if any.
    await queue.reportWaiting(activeJob);
    await sleep(30_000);
  }
}
main()
  .catch(async (error) => {
    stopping = true;
    logger.error("Fatal worker error", error);
    process.exitCode = 1;
    await safeNotify(
      notifications,
      "alert",
      "Worker stopped after a fatal error. Check logs.",
    );
  })
  .finally(async () => {
    // Keep the ownership lock until any in-flight operation has stopped.
    if (active) await active;
    await prisma.$disconnect();
    await owner.end();
  });
