import { Router } from 'express';
import { SatelliteController } from '../modules/satellites/controllers/SatelliteController';
import { satelliteRepository } from '../modules/satellites/repositories/SatelliteRepository';
import { FetchCelesTrakClient } from '../modules/satellites/services/CelesTrakClient';
import { authMiddleware, requireAdmin } from '../middlewares/AuthMiddleware';
import { PrismaSatelliteUpsertJobRepository } from '../modules/satellites/repositories/PrismaSatelliteUpsertJobRepository';

export const buildSatellitesRoutes = (): Router => {
  const router = Router();
  const satelliteController = SatelliteController.build(
    satelliteRepository, new FetchCelesTrakClient(), new PrismaSatelliteUpsertJobRepository(),
  );

  router.get('/', satelliteController.list);
  router.get('/upsert', authMiddleware, requireAdmin, satelliteController.getUpsert);
  router.post('/upsert', authMiddleware, requireAdmin, satelliteController.upsert);

  return router;
};

export default buildSatellitesRoutes;
