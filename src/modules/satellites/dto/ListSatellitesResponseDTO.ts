import { Satellite } from "../entities/Satellite";

export interface ListSatellitesResponseDTO {
  data: Satellite[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
