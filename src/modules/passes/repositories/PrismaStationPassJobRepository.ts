import { prisma } from "../../../lib/prisma";
import type { StationPassJobRepository } from "./StationPassJobRepository";

export class PrismaStationPassJobRepository implements StationPassJobRepository {
  async progress(
    id: string,
    generated: number,
    skipped: number,
  ): Promise<void> {
    await prisma.stationPassJob.update({
      where: { id },
      data: { generated, skipped },
    });
  }
  async complete(id: string): Promise<void> {
    // A single status change publishes all station generations atomically.
    await prisma.stationPassJob.update({
      where: { id },
      data: {
        status: "completed",
        finished_at: new Date(),
        error_message: null,
      },
    });
  }
  async fail(id: string, message: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.stationPassJob.update({
        where: { id },
        data: {
          status: "failed",
          finished_at: new Date(),
          error_message: message,
        },
      });
      // Remove unpublished results; the previous completed generation remains readable.
      await tx.stationPassGeneration.deleteMany({ where: { job_id: id } });
    });
  }
}
