import { Logger } from "../../../lib/Logger";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import type { SatelliteRepository } from "../../satellites/repositories/SatelliteRepository";
import type { Station } from "../../stations/entities/Station";
import type { PassRepository } from "../repositories/PassRepository";
import { predict } from "../helpers/predict";
import { InvalidOrbitError } from "../errors/InvalidOrbitError";

const logger = new Logger("CreatePasses");

export class CreatePasses {
  constructor(
    private readonly satellites: SatelliteRepository,
    private readonly passes: PassRepository,
    private readonly predictPasses: typeof predict = predict,
  ) {}

  async execute(jobId: string, station: Station, start: Date, end: Date) {
    if (
      !Number.isFinite(station.latitude) ||
      Math.abs(station.latitude) > 90 ||
      !Number.isFinite(station.longitude) ||
      Math.abs(station.longitude) > 180 ||
      !Number.isFinite(station.altitude)
    ) {
      throw new Error(`Station ${station.uuid} has invalid coordinates`);
    }
    const startedAt = Date.now();
    logger.info("Station prediction started", { jobId, stationUuid: station.uuid, windowStart: start, windowEnd: end });
    const generationId = await this.passes.createGeneration(jobId, station);
    let generated = 0;
    let skipped = 0;
    let processed = 0;
    let batchNumber = 0;
    // Await each calculation and insert before retrieving another page: bounded memory/backpressure.
    let afterId = 0;
    while (true) {
      // Cursor ordering is stable when packet ingestion inserts new catalogue entries.
      const batchStartedAt = Date.now();
      const batch = await this.satellites.findAll({ afterId, limit: 100 });
      for (const satellite of batch.data) {
        let predictions;
        try {
          // Compute at the horizon; the HTTP request's minimum elevation is a database filter.
          predictions = await this.predictPasses(
            satellite,
            station,
            start.getTime(),
            end.getTime(),
            0,
          );
        } catch (error) {
          // Packet ingestion can create catalogue entries without orbital elements.
          // One such entry must not prevent predictions for the rest of the catalogue.
          if (!(error instanceof InvalidOrbitError)) throw error;
          skipped++;
          continue;
        }
        generated += await this.passes.createMany(
          generationId,
          station.uuid,
          satellite,
          predictions,
        );
        await yieldToEventLoop();
      }
      processed += batch.data.length;
      if (batch.data.length) {
        logger.info("Satellite batch completed", {
          jobId, stationUuid: station.uuid, generationId, batch: ++batchNumber,
          batchSize: batch.data.length, processed, generated, skipped,
          afterId: batch.data[batch.data.length - 1].id,
          batchElapsedMs: Date.now() - batchStartedAt, elapsedMs: Date.now() - startedAt,
        });
      }
      if (batch.data.length < 100) break;
      afterId = batch.data[batch.data.length - 1].id;
    }
    return { generated, skipped };
  }
}
