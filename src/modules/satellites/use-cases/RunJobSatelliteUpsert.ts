import { Logger } from "../../../lib/Logger";
import type { SatelliteUpsertJobRepository } from "../repositories/SatelliteUpsertJobRepository";

const logger = new Logger("Satellites");

// HTTP requests only enqueue; the standalone worker owns execution.
export class RunJobSatelliteUpsert {
  constructor(private readonly jobs: SatelliteUpsertJobRepository) {}

  async execute() {
    const job = await this.jobs.createQueued();
    if (job) logger.info("Import queued", { jobId: job.id });
    else
      logger.info("Import request skipped: a job is already queued or running");
    return job;
  }
}
