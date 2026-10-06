export type SatelliteUpsertJobStatus = 'running' | 'completed' | 'failed';

export interface SatelliteUpsertJobResponseDTO {
  id: string;
  status: SatelliteUpsertJobStatus;
  started_at: Date;
  finished_at: Date | null;
  downloaded: boolean;
  created: Date;
  updated: Date;
  error_message: string | null;
}
