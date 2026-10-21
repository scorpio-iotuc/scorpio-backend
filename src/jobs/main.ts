import "dotenv/config";
import { Client } from "pg";
import { Logger } from "../lib/Logger";
import { prisma } from "../lib/prisma";
import { PrismaSatelliteUpsertJobRepository } from "../modules/satellites/repositories/PrismaSatelliteUpsertJobRepository";
import { PrismaSatelliteRepository } from "../modules/satellites/repositories/PrismaSatelliteRepository";
import { PrismaStationRepository } from "../modules/stations/repositories/PrismaStationRepository";
import { PrismaPassRepository } from "../modules/passes/repositories/PrismaPassRepository";
import { PrismaStationPassJobRepository } from "../modules/passes/repositories/PrismaStationPassJobRepository";
import { UpsertSatellites } from "../modules/satellites/use-cases/UpsertSatellites";
import { CreatePasses } from "../modules/passes/use-cases/CreatePasses";
import { FetchCelesTrakClient } from "./upsert-satellite/clients/CelesTrakClient";
import { executeSatelliteJob } from "./upsert-satellite/execute-job";
import { executeStationPassJob } from "./create-station-passes/execute-job";
import { JobQueue } from "./queue";
import { scheduleKey } from "./schedule";
import NotifyClient from "./notify/NotifyClient";
import { safeNotify } from "./notify/safe-notify";

const logger = new Logger("Jobs");
const notifications = process.env.DISCORD_WEBHOOK_URL?.trim()
  ? new NotifyClient("discord-bot", {
      webhookUrl: process.env.DISCORD_WEBHOOK_URL!.trim(),
    })
  : undefined;
const satellites = new PrismaSatelliteRepository();
const satelliteJobs = new PrismaSatelliteUpsertJobRepository();
const passJobs = new PrismaStationPassJobRepository();
const passes = new PrismaPassRepository();
const stations = new PrismaStationRepository();
const queue = new JobQueue();
const owner = new Client({
  connectionString: process.env.DATABASE_URL,
  keepAlive: true,
});
let stopping = false;
let active: Promise<void> | null = null;
let activeJob: { id: string; kind: string } | null = null;
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// The same session lock serializes both job types across all worker replicas.
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
  const trigger = process.env.UPSERT_SATELLITES_TRIGGER_TIME ?? "00:00";
  scheduleKey(new Date(), trigger);
  const windowHours = Number(process.env.STATION_PASSES_WINDOW_HOURS ?? 72);
  if (!Number.isInteger(windowHours) || windowHours < 48 || windowHours > 240) {
    throw new Error(
      "STATION_PASSES_WINDOW_HOURS must be an integer between 48 and 240",
    );
  }
  await owner.connect();
  let waitingForOwnership = false;
  while (!stopping) {
    if (
      (await owner.query("SELECT pg_try_advisory_lock(8432, 1) AS acquired"))
        .rows[0].acquired
    )
      break;
    if (!waitingForOwnership) logger.info("Waiting for worker ownership; another replica owns the job coordinator");
    waitingForOwnership = true;
    await sleep(2000);
  }
  if (stopping) return;
  logger.info("Worker ownership acquired");
  const recovered = await queue.recover();
  if (recovered)
    await safeNotify(
      notifications,
      "alert",
      `${recovered} job(s): status=failed; interrupted by worker restart.`,
    );

  if (process.env.RUN_ON_START === "true") {
    const latest = await satelliteJobs.findLatest();
    if (
      !latest?.finished_at ||
      Date.now() - latest.finished_at.getTime() >= 3_600_000
    ) {
      const job = await satelliteJobs.createQueued();
      if (job) logger.info("Job queued on startup", { jobId: job.id, jobType: "satellite", status: "queued" });
      if (job)
        await safeNotify(
          notifications,
          "notify",
          `Satellite job ${job.id}: queued on startup; status=queued`,
        );
    }
  }
  logger.info(
    `Ready; satellite upsert ${trigger} UTC; Create Station Passes 12:00 UTC; prediction window ${windowHours}h`,
  );
  while (!stopping) {
    await owner.query("SELECT 1");
    for (const job of await queue.schedule(new Date(), trigger, windowHours)) {
      await safeNotify(
        notifications,
        "notify",
        `${job.name} ${job.id}: scheduled; status=queued`,
      );
    }
    if (!active) {
      const next = await queue.claimNext(new Date());
      if (next) {
        activeJob = { id: next.job.id, kind: next.kind };
        // Do not await here: the loop must still enqueue scheduled jobs while work runs.
        active = (
          next.kind === "satellite"
            ? executeSatelliteJob(
                next.job.id,
                satelliteJobs,
                new UpsertSatellites(satellites),
                new FetchCelesTrakClient(),
                notifications,
              )
            : executeStationPassJob(
                next.job,
                passJobs,
                stations,
                passes,
                new CreatePasses(satellites, passes),
                notifications,
              )
        )
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
