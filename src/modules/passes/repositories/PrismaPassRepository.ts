import { prisma } from "../../../lib/prisma";
import type { Prisma, SatellitePass } from "../../../generated/prisma/client";
import type { Satellite } from "../../satellites/entities/Satellite";
import type { Station } from "../../stations/entities/Station";
import type { Pass } from "../entities/Pass";
import type { PassRepository, StoredPass } from "./PassRepository";

const toPass = (row: SatellitePass): Pass => ({
  passId: row.id,
  satelliteId: row.satellite_norad_id,
  satelliteName: row.satellite_name,
  aos: row.aos,
  los: row.los,
  maxElevation: row.max_elevation,
  maxElevationAt: row.max_elevation_at,
});

export class PrismaPassRepository implements PassRepository {
  async createGeneration(jobId: string, station: Station): Promise<string> {
    const generation = await prisma.stationPassGeneration.create({
      data: {
        job_id: jobId,
        station_uuid: station.uuid,
        latitude: station.latitude,
        longitude: station.longitude,
        altitude: station.altitude,
      },
    });
    return generation.id;
  }

  async createMany(
    generationId: string,
    stationUuid: string,
    satellite: Satellite,
    passes: Pass[],
  ): Promise<number> {
    return this.createBatch(generationId, stationUuid, [{ satellite, passes }]);
  }

  async createBatch(
    generationId: string,
    stationUuid: string,
    predictions: { satellite: Satellite; passes: Pass[] }[],
  ): Promise<number> {
    let count = 0;
    let rows: Prisma.SatellitePassCreateManyInput[] = [];
    const flush = async () => {
      if (!rows.length) return;
      const result = await prisma.satellitePass.createMany({
        data: rows,
        skipDuplicates: true,
      });
      count += result.count;
      rows = [];
    };
    for (const { satellite, passes } of predictions) {
      // Snapshot the actual orbital input: later CSV imports must not change this pass's trajectory.
      const snapshot = JSON.parse(
        JSON.stringify(satellite),
      ) as Prisma.InputJsonObject;
      for (const pass of passes) {
        rows.push({
          generation_id: generationId,
          station_uuid: stationUuid,
          satellite_id: satellite.id,
          satellite_name: satellite.displayName,
          satellite_norad_id: satellite.noradId,
          aos: pass.aos,
          los: pass.los,
          max_elevation: pass.maxElevation,
          max_elevation_at: pass.maxElevationAt,
          orbital_snapshot: snapshot,
        });
        if (rows.length === 500) await flush();
      }
    }
    await flush();
    return count;
  }

  async deleteExpired(now: Date): Promise<number> {
    return (
      await prisma.satellitePass.deleteMany({ where: { los: { lt: now } } })
    ).count;
  }

  async findLatestGeneration(stationUuid: string) {
    const row = await prisma.stationPassGeneration.findFirst({
      where: { station_uuid: stationUuid, job: { status: "completed" } },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      include: { job: true },
    });
    if (!row?.job.window_start || !row.job.window_end) return null;
    return {
      id: row.id,
      stationUuid: row.station_uuid,
      latitude: row.latitude,
      longitude: row.longitude,
      altitude: row.altitude,
      windowStart: row.job.window_start,
      windowEnd: row.job.window_end,
    };
  }

  async findAll(
    query: Parameters<PassRepository["findAll"]>[0],
  ): ReturnType<PassRepository["findAll"]> {
    const where: Prisma.SatellitePassWhereInput = {
      generation_id: query.generationId,
      station_uuid: query.stationUuid,
      generation: { job: { status: "completed" } },
      aos: { gte: query.start, lt: query.end },
      max_elevation: { gte: query.minElevation },
      satellite_norad_id: query.satelliteNoradId,
      satellite_name: {
        contains: query.satelliteDisplayName,
        mode: "insensitive",
      }
    };
    // Count and page share one snapshot. Filter and globally sort passes before pagination.
    const [total, rows] = await prisma.$transaction(
      [
        prisma.satellitePass.count({ where }),
        prisma.satellitePass.findMany({
          where,
          orderBy: [
            { aos: "asc" },
            { satellite_norad_id: "asc" },
            { id: "asc" },
          ],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
      ],
      { isolationLevel: "RepeatableRead", timeout: 15_000 },
    );
    return {
      passes: rows.map(toPass),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async findById(id: string): Promise<StoredPass | null> {
    const row = await prisma.satellitePass.findFirst({
      where: {
        id,
        generation: { job: { status: "completed" } },
      },
      include: { generation: true },
    });
    if (!row) return null;
    const input = row.orbital_snapshot as unknown as Record<string, unknown>;
    const satellite = {
      ...input,
      epoch: input.epoch ? new Date(input.epoch as string) : null,
      tleUpdatedAt: input.tleUpdatedAt
        ? new Date(input.tleUpdatedAt as string)
        : null,
      createdAt: new Date(input.createdAt as string),
      updatedAt: new Date(input.updatedAt as string),
    } as Satellite;
    return {
      pass: toPass(row),
      satellite,
      station: {
        uuid: row.station_uuid,
        latitude: row.generation.latitude,
        longitude: row.generation.longitude,
        altitude: row.generation.altitude,
      },
    };
  }
}
