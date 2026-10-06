import { AuthenticatedUser } from '../../auth/entities/AuthenticateUser';
import { UserType } from '../../users/entities/User';
import { StationRepository } from '../repositories/StationRepository';
import { PacketRepository } from '../../packets/repositories/PacketRepository';

export class DeleteStation {
  constructor(
    private readonly stationRepository: StationRepository,
    private readonly packetRepository: PacketRepository
  ) { }

  async execute(uuid: string, user: AuthenticatedUser): Promise<boolean> {
    const existingStation = await this.stationRepository.findByUuid(uuid);
    if (!existingStation) {
      return false;
    }
    // Check ownership before touching any data
    if (existingStation.ownerId !== user.id && user.type !== UserType.ADMIN) {
      return false;
    }
    // Remove all packets related to the current station
    await this.packetRepository.deleteAll({ stationId: existingStation.id });

    return this.stationRepository.delete(uuid);
  }
}
