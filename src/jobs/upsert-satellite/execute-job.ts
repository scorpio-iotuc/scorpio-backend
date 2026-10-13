import { Logger } from "../../lib/Logger";
import type { SatelliteUpsertJobRepository } from "../../modules/satellites/repositories/SatelliteUpsertJobRepository";
import type { UpsertSatellites } from "../../modules/satellites/use-cases/UpsertSatellites";
import type { CelesTrakClient } from "./clients/CelesTrakClient";

import type NotifyClientInterface from "../notify/NotifyClientInterface";
import { safeNotify } from "../notify/safe-notify";

const logger = new Logger("SatelliteWorker");

/**
 * Executes a satellite upsert job by streaming active satellites from the CelesTrak client,
 * saving each batch, and marking the job as downloaded when complete.
 * If any error occurs during the process, the job is marked as failed.
 * @param jobId Job ID of the satellite upsert job to execute
 * @param jobs Repository for managing satellite upsert jobs
 * @param upsert Use case for upserting satellites
 * @param client Client for streaming active satellites from CelesTrak
 */
export async function executeSatelliteJob(
  jobId: string,
  jobs: SatelliteUpsertJobRepository,
  upsert: Pick<UpsertSatellites, "execute">,
  client: CelesTrakClient,
  notifications?: NotifyClientInterface,
): Promise<void> {
  logger.info("Import started", { jobId });
  await safeNotify(
    notifications,
    "notify",
    `Satellite job ${jobId}: starting new job; status=running`,
  );
  try {
    // Stream active satellites from the CelesTrak client,
    // saving each batch and marking the job as downloaded when complete.
    await client.streamActiveSatellites(
      (batch) => upsert.execute(batch),
      () => jobs.markDownloaded(jobId),
    );
    // Mark the job as completed after all batches have been processed successfully...
    await jobs.complete(jobId);
    logger.info("Import completed", { jobId });
    await safeNotify(
      notifications,
      "notify",
      `Satellite job ${jobId}: job ended; status=completed`,
    );
  } catch (error) {
    logger.error("Import failed; committed batches are retained", {
      jobId,
      error,
    });
    await jobs.fail(
      jobId,
      "Satellite synchronization failed. Check worker logs.",
    );
    const message = error instanceof Error ? error.message : String(error);
    await safeNotify(
      notifications,
      "alert",
      `Satellite job ${jobId}: job ended; status=failed; message=${message}`,
    );
  }
}
