import { Router } from 'express';
import { PassController } from '../modules/passes/controllers/PassesController';
import { stationRepository } from '../modules/stations/repositories/StationRepository';
import { satelliteRepository } from '../modules/satellites/repositories/SatelliteRepository';

import { PrismaPassRepository } from '../modules/passes/repositories/PrismaPassRepository';

export const buildPassesRoutes = (): Router => {
  const router = Router();
  const controller = PassController.build(stationRepository, satelliteRepository, new PrismaPassRepository());
  router.get('/', controller.list);
  router.get('/trajectory', controller.trajectory);
  router.get('/:passId/trajectory', controller.trajectory);
  return router;
};
