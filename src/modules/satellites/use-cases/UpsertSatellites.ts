import { Logger } from "../../../lib/Logger";
import type { UpsertSatelliteDTO } from "../dto/UpsertSatelliteDTO";
import type { SatelliteRepository } from "../repositories/SatelliteRepository";

const logger = new Logger("Satellites");

/** Persists one bounded batch; external catalog ingestion belongs to the worker. */
export class UpsertSatellites {
  constructor(
    private readonly satellites: Pick<SatelliteRepository, "upsertMany">,
  ) {}

  async execute(batch: UpsertSatelliteDTO[]) {
    const started = Date.now();
    const result = await this.satellites.upsertMany(batch);
    logger.info("Batch saved", { ...result, elapsedMs: Date.now() - started });
    return result;
  }
}
