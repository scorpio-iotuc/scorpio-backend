import { Logger } from "../../lib/Logger";
import type { StationRepository } from "../../modules/stations/repositories/StationRepository";
import type { PassRepository } from "../../modules/passes/repositories/PassRepository";
import type {
  StationPassJob,
  StationPassJobRepository,
} from "../../modules/passes/repositories/StationPassJobRepository";
import type { CreatePasses } from "../../modules/passes/use-cases/CreatePasses";
import type NotifyClientInterface from "../notify/NotifyClientInterface";
import { safeNotify } from "../notify/safe-notify";

const logger = new Logger("CreateStationPasses");
export async function executeStationPassJob(
  job: StationPassJob,
  jobs: StationPassJobRepository,
  stations: StationRepository,
  passes: PassRepository,
  create: Pick<CreatePasses, "execute">,
  notifications?: NotifyClientInterface,
  now: () => Date = () => new Date(),
): Promise<void> {
  const startedAt = Date.now();
  logger.info("Prediction started", { jobId: job.id, windowStart: job.window_start, windowEnd: job.window_end });
  await safeNotify(
    notifications,
    "notify",
    `Create Station Passes ${job.id}: starting; status=running`,
  );
  try {
    const cleanup = async (phase: string) => {
      const cutoff = now();
      const cleanupStartedAt = Date.now();
      logger.info("Expired-pass cleanup started", { jobId: job.id, phase, cutoff });
      const count = await passes.deleteExpired(cutoff);
      logger.info("Expired-pass cleanup completed", { jobId: job.id, phase, cutoff, deleted: count, elapsedMs: Date.now() - cleanupStartedAt });
      return count;
    };
    const deletedAtStart = await cleanup("start");
    let generated = 0;
    let skipped = 0;
    let stationCount = 0;
    // Stations are paginated as well; do not retain the entire station/catalogue cross product.
    for (let page = 1; ; page++) {
      const batch = await stations.findAll({ page, limit: 100 });
      for (const station of batch) {
        const result = await create.execute(
          job.id,
          station,
          job.window_start,
          job.window_end,
        );
        generated += result.generated;
        skipped += result.skipped;
        stationCount++;
        await jobs.progress(job.id, generated, skipped);
        logger.info("Station predicted", {
          jobId: job.id,
          stationUuid: station.uuid,
          generated,
          skipped,
        });
      }
      if (batch.length < 100) break;
    }
    // Do not publish a completed job whose computation has exhausted the useful window.
    if (job.window_end.getTime() < now().getTime() + 24 * 3_600_000) {
      throw new Error(
        "Prediction took too long to provide the next 24 hours; increase window or optimize prediction",
      );
    }
    // Calculation may take hours. Remove passes that expired while the job was running too.
    const deletedBeforePublication = await cleanup("before-publication");
    await jobs.complete(job.id);
    logger.info("Prediction completed", {
      jobId: job.id,
      generated,
      skipped,
      stationCount,
      deleted: deletedAtStart + deletedBeforePublication,
      elapsedMs: Date.now() - startedAt,
    });
    await safeNotify(
      notifications,
      "notify",
      `Create Station Passes ${job.id}: status=completed; stations=${stationCount}; passes=${generated}; skipped satellite/station pairs=${skipped}`,
    );
  } catch (error) {
    logger.error("Prediction failed; previous published results retained", {
      jobId: job.id,
      error,
      elapsedMs: Date.now() - startedAt,
    });
    await jobs.fail(
      job.id,
      "Station pass prediction failed. Check worker logs.",
    );
    await safeNotify(
      notifications,
      "alert",
      `Create Station Passes ${job.id}: status=failed; message=${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
