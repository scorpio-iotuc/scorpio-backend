import type { SatelliteUpsertJobRepository } from '../repositories/SatelliteUpsertJobRepository';

export class GetSatelliteUpsertJob {
  constructor(private readonly jobs: SatelliteUpsertJobRepository) {}
  execute() {
    console.log('[Satellites][UPSERT] Searching the last job executed')
    return this.jobs.findLatest();
  }
}
