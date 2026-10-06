import type { SatelliteUpsertJobRepository } from '../repositories/SatelliteUpsertJobRepository';

export class GetSatelliteUpsertJob {
  constructor(private readonly jobs: SatelliteUpsertJobRepository) {}

  execute() {
    return this.jobs.findLatest();
  }
}
