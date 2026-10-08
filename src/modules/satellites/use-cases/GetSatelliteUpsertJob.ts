import { Logger } from '../../../lib/Logger';
import type { SatelliteUpsertJobRepository } from '../repositories/SatelliteUpsertJobRepository';

const logger = new Logger('Satellites');

export class GetSatelliteUpsertJob {
  constructor(private readonly jobs: SatelliteUpsertJobRepository) {}
  execute() {
    logger.info('UPSERT: Searching the last job executed')
    return this.jobs.findLatest();
  }
}
