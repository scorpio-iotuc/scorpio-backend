import type { SatelliteUpsertJobRepository } from '../repositories/SatelliteUpsertJobRepository';
import type { UpsertSatellites } from './UpsertSatellites';

export class RunJobSatelliteUpsert {
  constructor(
    private readonly jobs: SatelliteUpsertJobRepository,
    private readonly upsert: Pick<UpsertSatellites, 'execute'>,
  ) {}

  async execute() {
    const job = await this.jobs.createRunning();
    if (!job) return null;
    // Starting the asynchronous job here ...
    setImmediate(() => {
      void this.runJobSatelliteUpsert(job.id).catch((error) => {
        console.error('[Satellites][JOB] Could not persist job failure', { jobId: job.id, error });
      });
    });
    return job;
  }

  async runJobSatelliteUpsert(jobId: string): Promise<void> {
    try {
      await this.upsert.execute(() => this.jobs.markDownloaded(jobId));
      await this.jobs.complete(jobId);
    } catch (error) {
      console.error('[Satellites][JOB] Synchronization failed', { jobId, error });
      await this.jobs.fail(jobId, 'Satellite synchronization failed. Check server logs.');
    }
  }
}
