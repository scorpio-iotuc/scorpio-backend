import type { Pass } from "../entities/Pass";

export interface ListPassesDTO {
  stationUuid: string;
  page?: number;
  limit?: number;
  hours?: number;
  minElevation?: number;
  satelliteNoradId?: number;
}

export interface ListPassesResponseDTO {
  stationUuid: string;
  windowHours: number;
  passes: Pass[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
