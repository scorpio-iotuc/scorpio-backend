import { Logger } from "../../../lib/Logger";
import type { SatelliteUpsertJobRepository } from "../repositories/SatelliteUpsertJobRepository";

const logger = new Logger("Satellites");

export class GetSatelliteUpsertJob {
  constructor(private readonly jobs: SatelliteUpsertJobRepository) {}
  execute() {
    logger.info("Finding the latest satellite upsert job");
    return this.jobs.findLatest();
  }
}
