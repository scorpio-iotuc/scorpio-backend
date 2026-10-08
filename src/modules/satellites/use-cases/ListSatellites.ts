import { ListSatellitesDTO } from "../dto/ListSatellitesDTO";
import { ListSatellitesResponseDTO } from "../dto/ListSatellitesResponseDTO";
import { SatelliteRepository } from "../repositories/SatelliteRepository";

export class ListSatellites {
  constructor(private readonly satelliteRepository: SatelliteRepository) {}

  async listSatellites(
    query: ListSatellitesDTO,
  ): Promise<ListSatellitesResponseDTO> {
    return this.satelliteRepository.findAll(query);
  }

  async execute(query: ListSatellitesDTO): Promise<ListSatellitesResponseDTO> {
    return this.listSatellites(query);
  }
}
