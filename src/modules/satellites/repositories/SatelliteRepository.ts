import { ListSatellitesDTO } from "../dto/ListSatellitesDTO";
import { ListSatellitesResponseDTO } from "../dto/ListSatellitesResponseDTO";
import { UpsertSatelliteDTO } from "../dto/UpsertSatelliteDTO";
import { UpsertSatellitesResultDTO } from "../dto/UpsertSatellitesResultDTO";
import { Satellite } from "../entities/Satellite";
import { PrismaSatelliteRepository } from "./PrismaSatelliteRepository";

export interface SatelliteRepository {
  findAll(query: ListSatellitesDTO): Promise<ListSatellitesResponseDTO>;
  upsertMany(
    satellites: UpsertSatelliteDTO[],
  ): Promise<UpsertSatellitesResultDTO>;
  findOrCreateByNoradId(noradId: number): Promise<Satellite>;
}

export const satelliteRepository: SatelliteRepository =
  new PrismaSatelliteRepository();
