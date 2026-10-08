import type { SatelliteUpsertJobStatus } from "./SatelliteUpsertJobResponseDTO";

export interface ListUpsertSatelliteJobsDTO {
  page?: number;
  limit?: number;
  status?: SatelliteUpsertJobStatus;
  downloaded?: boolean;
}
