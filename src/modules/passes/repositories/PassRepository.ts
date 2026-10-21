import type { ListPassesResponseDTO } from "../dto/ListPassesDTO";
import type { Pass } from "../entities/Pass";
import type { Satellite } from "../../satellites/entities/Satellite";
import type { Station } from "../../stations/entities/Station";

export interface PassGeneration {
  id: string;
  stationUuid: string;
  latitude: number;
  longitude: number;
  altitude: number;
  windowStart: Date;
  windowEnd: Date;
}
export interface StoredPass {
  pass: Pass;
  station: Pick<Station, "uuid" | "latitude" | "longitude" | "altitude">;
  satellite: Satellite;
}
export interface PassRepository {
  createGeneration(jobId: string, station: Station): Promise<string>;
  createMany(
    generationId: string,
    stationUuid: string,
    satellite: Satellite,
    passes: Pass[],
  ): Promise<number>;
  deleteExpired(now: Date): Promise<number>;
  findLatestGeneration(stationUuid: string): Promise<PassGeneration | null>;
  findAll(query: {
    page: number;
    limit: number;
    generationId: string;
    stationUuid: string;
    start: Date;
    end: Date;
    minElevation: number;
    satelliteNoradId?: number;
  }): Promise<Pick<ListPassesResponseDTO, "passes" | "pagination">>;
  findById(id: string): Promise<StoredPass | null>;
}
