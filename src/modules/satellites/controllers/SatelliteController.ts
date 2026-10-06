import { Request, Response } from 'express';
import { ListSatellitesDTO } from '../dto/ListSatellitesDTO';
import { SatelliteRepository } from '../repositories/SatelliteRepository';
import { CelesTrakClient } from '../services/CelesTrakClient';
import { ListSatellites } from '../use-cases/ListSatellites';
import { UpsertSatellites } from '../use-cases/UpsertSatellites';
import { SatelliteUpsertJobRepository } from '../repositories/SatelliteUpsertJobRepository';
import { GetSatelliteUpsertJob } from '../use-cases/GetSatelliteUpsertJob';
import { RunJobSatelliteUpsert } from '../use-cases/RunJobSatelliteUpsert';


export class SatelliteController {
  private readonly listSatellites: ListSatellites;
  private readonly runJobSatelliteUpsert: RunJobSatelliteUpsert;
  private readonly getSatelliteUpsertJob: GetSatelliteUpsertJob;

  constructor(
    satelliteRepository: SatelliteRepository,
    celestrakClient: CelesTrakClient,
    jobRepository: SatelliteUpsertJobRepository,
  ) {
    this.listSatellites = new ListSatellites(satelliteRepository);
    this.runJobSatelliteUpsert = new RunJobSatelliteUpsert(
      jobRepository, new UpsertSatellites(satelliteRepository, celestrakClient),
    );
    this.getSatelliteUpsertJob = new GetSatelliteUpsertJob(jobRepository);
  }

  public static build(
    satelliteRepository: SatelliteRepository,
    celestrakClient: CelesTrakClient,
    jobRepository: SatelliteUpsertJobRepository,
  ): SatelliteController {
    return new SatelliteController(satelliteRepository, celestrakClient, jobRepository);
  }

  list = async (req: Request, res: Response): Promise<Response> => {
    const pageRaw = req.query.page;
    const limitRaw = req.query.limit;
    const noradIdRaw = req.query.noradId;
    const displayNameRaw = req.query.displayName;

    const page = pageRaw === undefined ? 1 : Number(pageRaw);
    const limit = limitRaw === undefined ? 20 : Number(limitRaw);
    const noradId = noradIdRaw === undefined ? undefined : Number(noradIdRaw);
    const displayName = typeof displayNameRaw === 'string' ? displayNameRaw : undefined;

    if (typeof pageRaw !== 'undefined' && (typeof pageRaw !== 'string' || Number.isNaN(page))) {
      return res.status(400).json({ message: 'Invalid page' });
    }

    if (typeof limitRaw !== 'undefined' && (typeof limitRaw !== 'string' || Number.isNaN(limit))) {
      return res.status(400).json({ message: 'Invalid limit' });
    }

    if (typeof noradIdRaw !== 'undefined' && (typeof noradIdRaw !== 'string' || Number.isNaN(noradId))) {
      return res.status(400).json({ message: 'Invalid noraId' });
    }

    if (page < 1) {
      return res.status(400).json({ message: 'Page must be greater than or equal to 1' });
    }

    if (limit < 1 || limit > 100) {
      return res.status(400).json({ message: 'Limit must be between 1 and 100' });
    }

    const query: ListSatellitesDTO = { page, limit, noradId, displayName };
    const satellites = await this.listSatellites.listSatellites(query);

    return res.status(200).json(satellites);
  };

  upsert = async (_req: Request, res: Response): Promise<Response> => {
    const job = await this.runJobSatelliteUpsert.execute();
    if (!job) {
      return res.status(409).json({ message: 'A satellite update is already running.' });
    }
    return res.status(202).json(job);
  };

  getUpsert = async (_req: Request, res: Response): Promise<Response> => {
    const job = await this.getSatelliteUpsertJob.execute();
    res.setHeader('Cache-Control', 'no-store');
    if (!job) return res.status(404).json({ message: 'No satellite update has been started.' });
    return res.status(200).json(job);
  };
}
