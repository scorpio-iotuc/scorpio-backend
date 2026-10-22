import path from "node:path";
import { Logger } from "../../../lib/Logger";
import type { Satellite } from "../../satellites/entities/Satellite";
import type { Station } from "../../stations/entities/Station";
import type { PassRepository } from "../repositories/PassRepository";
import {
  ThreadClient,
  type ThreadClientContract,
} from "../../../lib/thread-client/main";
import type { PredictionTask, PredictionResult } from "../dto/PredictionDTO";

const logger = new Logger("CreatePasses");
export class CreatePasses {
  constructor(
    private readonly passes: PassRepository,
    private readonly pool: ThreadClientContract<
      PredictionTask,
      PredictionResult
    > = new ThreadClient({
      provider: "piscina",
      workerFile: path.join(__dirname, "../helpers/predictWorker"),
    }),
  ) {}

  async execute(
    jobId: string,
    generationId: string,
    station: Station,
    satellites: Satellite[],
    start: Date,
    end: Date,
  ) {
    if (
      !Number.isFinite(station.latitude) ||
      Math.abs(station.latitude) > 90 ||
      !Number.isFinite(station.longitude) ||
      Math.abs(station.longitude) > 180 ||
      !Number.isFinite(station.altitude)
    ) {
      throw new Error(`Station ${station.uuid} has invalid coordinates`);
    }
    if (satellites.length > 100)
      throw new Error("Prediction batches must contain at most 100 satellites");
    const startedAt = Date.now();
    logger.info("Station batch prediction started", {
      jobId,
      generationId,
      stationUuid: station.uuid,
      batchSize: satellites.length,
    });
    // Run the prediction for each satellite in parallel, but limit the number of concurrent threads 
    // to avoid overwhelming the system.
    const results = await Promise.allSettled(
      satellites.map((satellite) =>
        this.pool.run({
          satellite,
          station,
          start: start.getTime(),
          end: end.getTime(),
        }),
      ),
    );
    const batch = [];
    let skipped = 0;
    // Check each result for errors and count skipped satellites. If any satellite prediction failed,
    // throw an error to abort the job.
    for (let index = 0; index < results.length; index++) {
      const result = results[index];
      if (result.status === "rejected") throw result.reason;
      if (result.value.skipped) skipped++;
      else
        batch.push({
          satellite: satellites[index],
          passes: result.value.passes,
        });
    }
    // Backpressure: await all bulk inserts before moving to another station or fetching another batch.
    const generated = await this.passes.createBatch(
      generationId,
      station.uuid,
      batch,
    );
    logger.info("Station batch persisted", {
      jobId,
      generationId,
      stationUuid: station.uuid,
      processed: satellites.length,
      generated,
      skipped,
      elapsedMs: Date.now() - startedAt,
    });
    return { generated, skipped };
  }

  async close(): Promise<void> {
    await this.pool.destroy();
  }
}
