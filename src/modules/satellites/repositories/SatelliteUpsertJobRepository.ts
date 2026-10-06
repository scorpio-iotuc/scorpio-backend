import type { SatelliteUpsertJobResponseDTO } from '../dto/SatelliteUpsertJobResponseDTO';

export interface SatelliteUpsertJobRepository {
  createRunning(): Promise<SatelliteUpsertJobResponseDTO | null>;
  findLatest(): Promise<SatelliteUpsertJobResponseDTO | null>;
  markDownloaded(id: string): Promise<void>;
  complete(id: string): Promise<void>;
  fail(id: string, message: string): Promise<void>;
}
