import crypto from 'crypto';
import { CreatePacketDTO } from '../dto/CreatePacketDTO';
import { PacketRepository } from '../repositories/PacketRepository';
import { SatelliteRepository } from '../../satellites/repositories/SatelliteRepository';
import { StationRepository } from '../../stations/repositories/StationRepository';
import { emitPacketCreated } from '../../../lib/socket';

export interface CreatePacketResultDTO {
  success: boolean;
  message: string;
}

const parseAuthorization = (
  authorizationHeader: string | undefined,
): { stationId: string; key: string } | null => {
  if (!authorizationHeader) {
    return null;
  }
  const [scheme, token] = authorizationHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return null;
  }
  const separatorIndex = token.indexOf('.');
  if (separatorIndex <= 0 || separatorIndex === token.length - 1) {
    return null;
  }
  return {
    stationId: token.slice(0, separatorIndex),
    key: token.slice(separatorIndex + 1),
  };
};

const hashKey = (key: string): Buffer => crypto.createHash('sha256').update(key).digest();

const isValidKey = (key: string, expectedHashHex: string): boolean => {
  const expected = Buffer.from(expectedHashHex, 'hex');
  const actual = hashKey(key);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

export class CreatePacket {
  constructor(
    private readonly packetRepository: PacketRepository,
    private readonly stationRepository: StationRepository,
    private readonly satelliteRepository: SatelliteRepository,
  ) { }

  async execute(
    authorizationHeader: string | undefined,
    data: CreatePacketDTO,
  ): Promise<CreatePacketResultDTO | null> {
    const credentials = parseAuthorization(authorizationHeader);

    if (!credentials) {
      return null;
    }

    const station = await this.stationRepository.findAuthByUuid(credentials.stationId);

    if (!station) {
      return null;
    }

    if (!isValidKey(credentials.key, station.ownerKeyHash)) {
      return null;
    }

    const satellite = await this.satelliteRepository.findOrCreateByNoradId(data.noradId);

    const createdPacket = await this.packetRepository.create(data, station.id, satellite.id);
    emitPacketCreated({
      ...createdPacket,
      createdAt: createdPacket.createdAt.toISOString(),
    });
    await this.stationRepository.updateLastSeen(station.uuid);

    return {
      success: true,
      message: 'Packet stored successfully',
    };
  }
}
