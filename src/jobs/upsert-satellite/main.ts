import { Logger } from "../../lib/Logger";
import "dotenv/config";
import { Client } from "pg";
import { prisma } from "../../lib/prisma";
import { PrismaSatelliteUpsertJobRepository } from "../../modules/satellites/repositories/PrismaSatelliteUpsertJobRepository";
import { PrismaSatelliteRepository } from "../../modules/satellites/repositories/PrismaSatelliteRepository";
import { FetchCelesTrakClient } from "./clients/CelesTrakClient";
import { UpsertSatellites } from "../../modules/satellites/use-cases/UpsertSatellites";
import { scheduleKey } from "../schedule";
import { executeSatelliteJob } from "./execute-job";

const logger = new Logger("SatelliteWorker");

const jobs = new PrismaSatelliteUpsertJobRepository();
const upsert = new UpsertSatellites(new PrismaSatelliteRepository());
let stopping = false;
let active = false;
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
const TIME_TO_SLEEP = 30 * 1000; // 30 seconds to sleep between checks for queued jobs

// The session lock elects one worker, including across container restarts/replicas.
const owner = new Client({
  connectionString: process.env.DATABASE_URL,
  keepAlive: true,
});
owner.on("error", (error) => {
  logger.error("Database ownership connection lost", error);
  process.exit(1);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    stopping = true;
    if (active) {
      // Leave running status for recovery by the next elected worker.
      logger.error("Interrupted; job will be marked failed on restart");
      process.exit(1);
    }
  });
}

async function main(): Promise<void> {
  const trigger = process.env.UPSERT_SATELLITES_TRIGGER_TIME ?? "00:00";
  scheduleKey(new Date(), trigger); // Validate before taking ownership.
  await owner.connect();
  // Acquire an advisory lock to elect a single worker across replicas.
  while (!stopping) {
    const result = await owner.query(
      "SELECT pg_try_advisory_lock(8432, 1) AS acquired",
    );
    if (result.rows[0].acquired) break;
    await sleep(2000);
  }
  if (stopping) return;

  // Only an elected worker can recover jobs abandoned by its predecessor.
  await prisma.satelliteUpsertJob.updateMany({
    where: { status: "running" },
    data: {
      status: "failed",
      finished_at: new Date(),
      error_message: "Import interrupted by worker restart.",
    },
  });
  // If the last job was completed more than an hour ago, queue a new job on startup.
  if (process.env.RUN_ON_START === "true") {
    const latest = await jobs.findLatest();
    if (
      !latest?.finished_at ||
      Date.now() - latest.finished_at.getTime() >= 3600_000
    ) {
      await jobs.createQueued();
    }
  }

  logger.info(`Ready; daily schedule ${trigger} UTC`);
  let checkedDay: string | null = null;
  // Loop until the process is stopped, either by a signal or an error.
  while (!stopping) {
    // Probe the ownership connection before doing work.
    await owner.query("SELECT 1");
    const key = scheduleKey(new Date(), trigger);
    if (key && key !== checkedDay) {
      const existing = await prisma.satelliteUpsertJob.findUnique({
        where: { schedule_key: key },
      });
      if (existing || (await jobs.createQueued(key))) checkedDay = key;
    }
    // Check for a queued job and claim it for processing.
    const job = await prisma.$transaction(async (tx) => {
      const next = await tx.satelliteUpsertJob.findFirst({
        where: { status: "queued" },
        orderBy: { created: "asc" },
      });

      if (!next) return null;
      // Claim the job by updating its status to 'running' in a single transaction.
      const claimed = await tx.satelliteUpsertJob.updateMany({
        where: { id: next.id, status: "queued" },
        data: { status: "running", started_at: new Date() },
      });

      return claimed.count === 1 ? next : null;
    });
    // If no job was found, sleep for a while before checking again.
    // If a job was found, execute it and mark it as completed or failed.
    if (!job) {
      await sleep(TIME_TO_SLEEP);
      continue;
    }

    active = true;

    try {
      // Execute the job
      await executeSatelliteJob(
        job.id,
        jobs,
        upsert,
        new FetchCelesTrakClient(),
      );
    } finally {
      // Regardless of success or failure, mark the job as no longer active.
      active = false;
    }
  }
}

main()
  .catch((error) => {
    logger.error("Fatal error", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Keep ownership until database work has finished.
    await prisma.$disconnect();
    await owner.end();
  });
