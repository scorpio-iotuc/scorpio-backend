import { Prisma } from '../../../generated/prisma/client';
import { prisma } from '../../../lib/prisma';
import type { SatelliteUpsertJobResponseDTO } from '../dto/SatelliteUpsertJobResponseDTO';
import type { SatelliteUpsertJobRepository } from './SatelliteUpsertJobRepository';

export class PrismaSatelliteUpsertJobRepository implements SatelliteUpsertJobRepository {
  async createRunning(): Promise<SatelliteUpsertJobResponseDTO | null> {
    try {
      return await prisma.satelliteUpsertJob.create({ data: {} });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return null;
      }
      throw error;
    }
  }

  async findLatest(): Promise<SatelliteUpsertJobResponseDTO | null> {
    return prisma.satelliteUpsertJob.findFirst({ orderBy: [{ created: 'desc' }, { id: 'desc' }] });
  }

  async markDownloaded(id: string): Promise<void> {
    await prisma.satelliteUpsertJob.update({ where: { id }, data: { downloaded: true } });
  }

  async complete(id: string): Promise<void> {
    await prisma.satelliteUpsertJob.update({
      where: { id }, data: { status: 'completed', finished_at: new Date(), error_message: null },
    });
  }

  async fail(id: string, message: string): Promise<void> {
    await prisma.satelliteUpsertJob.update({
      where: { id }, data: { status: 'failed', finished_at: new Date(), error_message: message },
    });
  }
}
