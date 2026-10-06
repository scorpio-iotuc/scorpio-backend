import { Request, Response } from 'express';
import { CreateStationDTO } from '../dto/CreateStationDTO';
import { ListStationsDTO } from '../dto/ListStationsDTO';
import { UpdateStationDTO } from '../dto/UpdateStationDTO';
import { StationRepository } from '../repositories/StationRepository';
import { CreateStation } from '../use-cases/CreateStation';
import { DeleteStation } from '../use-cases/DeleteStation';
import { ListStations } from '../use-cases/ListStations';
import { RegenerateStationKey } from '../use-cases/RegenerateStationKey';
import { UpdateStation } from '../use-cases/UpdateStation';
import { PacketRepository } from '../../packets/repositories/PacketRepository';

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const isOptional = (value: unknown, check: (v: unknown) => boolean): boolean => value === undefined || check(value);

const isValidDecoderConfig = (value: unknown): boolean =>
  value === null ||
  (Array.isArray(value) && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255));

export class StationController {
  private readonly createStation: CreateStation;
  private readonly listStations: ListStations;
  private readonly updateStation: UpdateStation;
  private readonly deleteStation: DeleteStation;
  private readonly regenerateStationKey: RegenerateStationKey;

  constructor(
    private readonly stationRepository: StationRepository,
    private readonly packetRepository: PacketRepository,
  ) {
    this.createStation = new CreateStation(this.stationRepository);
    this.listStations = new ListStations(this.stationRepository);
    this.updateStation = new UpdateStation(this.stationRepository);
    this.deleteStation = new DeleteStation(this.stationRepository, this.packetRepository);
    this.regenerateStationKey = new RegenerateStationKey(this.stationRepository);
  }

  public static build(stationRepository: StationRepository, packetRepository: PacketRepository): StationController {
    return new StationController(stationRepository, packetRepository);
  }

  create = async (req: Request, res: Response): Promise<Response> => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(404).json({message: 'Forbidden credentials'});
      }
      const userId = user.id; // Owner id
      if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({
          message: 'Invalid request body.',
        });
      }
      const body = req.body as Record<string, unknown>;
      if (
        typeof body.name !== 'string' ||
        !isFiniteNumber(body.latitude) ||
        !isFiniteNumber(body.longitude) ||
        !isFiniteNumber(body.altitude)
      ) {
        return res.status(400).json({ message: 'Invalid request body.' });
      }
      const payload: CreateStationDTO = {
        name: body.name,
        latitude: body.latitude,
        longitude: body.longitude,
        altitude: body.altitude,
        ownerId: userId,
      };
      const stationCredentials = await this.createStation.execute(payload);
      if (!stationCredentials) {
        return res.status(404).json({ message: 'Owner user not found' });
      }
      return res.status(201).json(stationCredentials);
    } catch (error) {
      console.error('[Stations][CREATE] Failed to create station', error);
      return res.status(500).json({ message: 'Unexpected error. check the logs for more details' });
    }
  };

  list = async (req: Request, res: Response): Promise<Response> => {
    const ownerIdRaw = req.query.ownerId;
    const pageRaw = req.query.page;
    const limitRaw = req.query.limit;

    const ownerId = ownerIdRaw === undefined ? undefined : Number(ownerIdRaw);
    const page = pageRaw === undefined ? 1 : Number(pageRaw);
    const limit = limitRaw === undefined ? 100 : Number(limitRaw);

    if (ownerIdRaw !== undefined && (typeof ownerIdRaw !== 'string' || Number.isNaN(ownerId))) {
      return res.status(400).json({ message: 'Invalid owner id' });
    }

    if (typeof pageRaw !== 'undefined' && (typeof pageRaw !== 'string' || Number.isNaN(page))) {
      return res.status(400).json({ message: 'Invalid page' });
    }

    if (typeof limitRaw !== 'undefined' && (typeof limitRaw !== 'string' || Number.isNaN(limit))) {
      return res.status(400).json({ message: 'Invalid limit' });
    }

    if (page < 1) {
      return res.status(400).json({ message: 'Page must be greater than or equal to 1' });
    }

    if (limit < 1 || limit > 100) {
      return res.status(400).json({ message: 'Limit must be between 1 and 100' });
    }

    const query: ListStationsDTO = {
      ownerId,
      page,
      limit,
    };

    const stations = await this.listStations.execute(query);

    return res.status(200).json(stations);
  };

  update = async (req: Request, res: Response): Promise<Response> => {
    const user = req.user;
    if (!user) {
      return res.status(404).json({message: 'Forbidden credentials'});
    }
    
    const uuid = String(req.params.uuid);

    if (!uuid) {
      return res.status(400).json({ message: 'Invalid station uuid' });
    }

    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ message: 'Invalid request body.' });
    }

    const body = req.body as Record<string, unknown>;
    if (
      !isOptional(body.name, (v) => typeof v === 'string') ||
      !isOptional(body.latitude, isFiniteNumber) ||
      !isOptional(body.longitude, isFiniteNumber) ||
      !isOptional(body.altitude, isFiniteNumber) ||
      !isOptional(body.decoderConfig, isValidDecoderConfig)
    ) {
      return res.status(400).json({ message: 'Invalid request body.' });
    }
    const payload: UpdateStationDTO = {
      name: body.name as string | undefined,
      latitude: body.latitude as number | undefined,
      longitude: body.longitude as number | undefined,
      altitude: body.altitude as number | undefined,
      decoderConfig: body.decoderConfig as number[] | null | undefined,
    };

    const updatedStation = await this.updateStation.execute(uuid, payload, user);

    if (!updatedStation) {
      return res.status(404).json({ message: 'Station not found or the user is not the owner' });
    }

    return res.status(200).json(updatedStation);
  };

  delete = async (req: Request, res: Response): Promise<Response> => {
    const user = req.user
    if (!user) {
      return res.status(404).json({message: 'Forbidden credentials'});
    }
    const uuid = String(req.params.uuid);

    if (!uuid) {
      return res.status(400).json({ message: 'Invalid station uuid' });
    }

    const deleted = await this.deleteStation.execute(uuid, user);

    if (!deleted) {
      return res.status(404).json({ message: 'Station not found' });
    }

    return res.status(204).send();
  };

  regenerateKey = async (req: Request, res: Response): Promise<Response> => {
    const user = req.user
    if (!user) {
      return res.status(404).json({message: 'Forbidden credentials'});
    } 
    const uuid = String(req.params.uuid);

    if (!uuid) {
      return res.status(400).json({ message: 'Invalid station uuid' });
    }

    const stationCredentials = await this.regenerateStationKey.execute(uuid, user);

    if (!stationCredentials) {
      return res.status(404).json({ message: 'Station not found' });
    }

    return res.status(200).json(stationCredentials);
  };
}