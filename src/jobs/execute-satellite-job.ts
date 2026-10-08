import { Logger } from '../lib/Logger';
import type { 
  SatelliteUpsertJobRepository
} from '../modules/satellites/repositories/SatelliteUpsertJobRepository';
import type { UpsertSatellites } from '../modules/satellites/use-cases/UpsertSatellites';

const logger = new Logger('SatelliteWorker');

export async function executeSatelliteJob(
  jobId: string,
  jobs: SatelliteUpsertJobRepository,
  upsert: Pick<UpsertSatellites, 'execute'>,
): Promise<void> {
  logger.info('Import started', { jobId });
  try {
    await upsert.execute(() => jobs.markDownloaded(jobId));
    await jobs.complete(jobId);
    logger.info('Import completed', { jobId });
  } catch (error) {
    logger.error('Import failed', { jobId, error });
    await jobs.fail(jobId, 'Satellite synchronization failed. Check worker logs.');
  }
}
