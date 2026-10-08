import { Logger } from "../../../lib/Logger";
import type { SatelliteUpsertJobRepository } from "../repositories/SatelliteUpsertJobRepository";
import type { ListUpsertSatelliteJobsDTO } from "../dto/ListUpsertSatelliteJobsDTO";
const logger = new Logger("Satellites");

export class ListSatelliteUpsertJobs {
  constructor(private readonly jobs: SatelliteUpsertJobRepository) {}
  execute(query: ListUpsertSatelliteJobsDTO) {
    logger.info(
      "Listing satellite upsert jobs",
      query,
    );
    return this.jobs.findAll(query);
  }
}
