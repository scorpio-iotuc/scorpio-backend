import { Prisma, type Satellite as PrismaSatellite } from '../../../generated/prisma/client';
import { prisma } from '../../../lib/prisma';
import { ListSatellitesDTO } from '../dto/ListSatellitesDTO';
import { ListSatellitesResponseDTO } from '../dto/ListSatellitesResponseDTO';
import { UpsertSatelliteDTO } from '../dto/UpsertSatelliteDTO';
import { UpsertSatellitesResultDTO } from '../dto/UpsertSatellitesResultDTO';
import { Satellite } from '../entities/Satellite';
import { SatelliteRepository } from './SatelliteRepository';

const UPDATE_BATCH_SIZE = 500;

const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
};

const toDomainSatellite = (satellite: PrismaSatellite): Satellite => ({
  id: satellite.id,
  noradId: satellite.norad_id,
  displayName: satellite.display_name,
  objectId: satellite.object_id,
  epoch: satellite.epoch,
  meanMotion: satellite.mean_motion,
  eccentricity: satellite.eccentricity,
  inclination: satellite.inclination,
  raOfAscNode: satellite.ra_of_asc_node,
  argOfPericenter: satellite.arg_of_pericenter,
  meanAnomaly: satellite.mean_anomaly,
  bstar: satellite.bstar,
  meanMotionDot: satellite.mean_motion_dot,
  meanMotionDdot: satellite.mean_motion_ddot,
  tle1: satellite.tle1,
  tle2: satellite.tle2,
  tleUpdatedAt: satellite.tle_updated_at,
  createdAt: satellite.created_at,
  updatedAt: satellite.updated_at,
});

const toPrismaSatellite = (satellite: UpsertSatelliteDTO) => ({
  norad_id: satellite.noradId,
  display_name: satellite.displayName,
  object_id: satellite.objectId,
  epoch: satellite.epoch,
  mean_motion: satellite.meanMotion,
  eccentricity: satellite.eccentricity,
  inclination: satellite.inclination,
  ra_of_asc_node: satellite.raOfAscNode,
  arg_of_pericenter: satellite.argOfPericenter,
  mean_anomaly: satellite.meanAnomaly,
  bstar: satellite.bstar,
  mean_motion_dot: satellite.meanMotionDot,
  mean_motion_ddot: satellite.meanMotionDdot,
  tle1: satellite.tle1,
  tle2: satellite.tle2,
  tle_updated_at: satellite.tleUpdatedAt,
});

export class PrismaSatelliteRepository implements SatelliteRepository {
  async findAll(query: ListSatellitesDTO): Promise<ListSatellitesResponseDTO> {
    const limit = query.limit ?? 20;
    const page = query.page ?? 1;
    const skip = (page - 1) * limit;
    const displayName = query.displayName ?? undefined;
    const noradId = query.noradId ?? undefined;

    const [total, satellites] = await prisma.$transaction([
      prisma.satellite.count({
        where: {
          display_name: {
            contains: displayName,
            mode: "insensitive",
          },
          norad_id: noradId,
        }
      }),
      prisma.satellite.findMany({
        orderBy: { display_name: 'asc' },
        skip,
        take: limit,
        where: {
          display_name: {
            contains: displayName,
            mode: "insensitive",
          },
          norad_id: noradId,
        }
      }),
    ]);

    return {
      data: satellites.map(toDomainSatellite),
      pagination: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  async findOrCreateByNoradId(noradId: number): Promise<Satellite> {
    const satellite = await prisma.satellite.upsert({
      where: { norad_id: noradId },
      create: {
        norad_id: noradId,
        display_name: `NORAD ${noradId}`,
      },
      update: {},
    });

    return toDomainSatellite(satellite);
  }

  async upsertMany(satellites: UpsertSatelliteDTO[]): Promise<UpsertSatellitesResultDTO> {
    if (satellites.length === 0) {
      return { downloaded: 0, created: 0, updated: 0 };
    }

    const noradIds = satellites.map((satellite) => satellite.noradId);

    const existingSatellites = await prisma.satellite.findMany({
      where: {
        norad_id: {
          in: noradIds,
        },
      },
      select: {
        norad_id: true,
      },
    });

    const existingNoradIds = new Set(existingSatellites.map((satellite: { norad_id: number }) => satellite.norad_id));

    const satellitesToCreate = satellites.filter((satellite) => !existingNoradIds.has(satellite.noradId));
    const satellitesToUpdate = satellites.filter((satellite) => existingNoradIds.has(satellite.noradId));

    for (const batch of chunk(satellitesToCreate, UPDATE_BATCH_SIZE)) {
      await prisma.satellite.createMany({
        data: batch.map(toPrismaSatellite),
        skipDuplicates: true,
      });
    }

    if (satellitesToUpdate.length > 0) {
      for (const satellitesBatch of chunk(satellitesToUpdate, UPDATE_BATCH_SIZE)) {
        const values = satellitesBatch.map(
          (satellite) =>
            Prisma.sql`(${satellite.noradId}::integer, ${satellite.displayName}::text, ${satellite.objectId}::text, ${satellite.epoch}::timestamp(3), ${satellite.meanMotion}::double precision, ${satellite.eccentricity}::double precision, ${satellite.inclination}::double precision, ${satellite.raOfAscNode}::double precision, ${satellite.argOfPericenter}::double precision, ${satellite.meanAnomaly}::double precision, ${satellite.bstar}::double precision, ${satellite.meanMotionDot}::double precision, ${satellite.meanMotionDdot}::double precision, ${satellite.tle1}::text, ${satellite.tle2}::text, ${satellite.tleUpdatedAt}::timestamp(3))`,
        );

        await prisma.$executeRaw`
          UPDATE "Satellite" AS satellite
          SET
            "display_name" = data."display_name",
            "object_id" = data."object_id",
            "epoch" = data."epoch",
            "mean_motion" = data."mean_motion",
            "eccentricity" = data."eccentricity",
            "inclination" = data."inclination",
            "ra_of_asc_node" = data."ra_of_asc_node",
            "arg_of_pericenter" = data."arg_of_pericenter",
            "mean_anomaly" = data."mean_anomaly",
            "bstar" = data."bstar",
            "mean_motion_dot" = data."mean_motion_dot",
            "mean_motion_ddot" = data."mean_motion_ddot",
            "tle1" = COALESCE(data."tle1", satellite."tle1"),
            "tle2" = COALESCE(data."tle2", satellite."tle2"),
            "tle_updated_at" = COALESCE(data."tle_updated_at", satellite."tle_updated_at"),
            "updated_at" = NOW()
          FROM (VALUES ${Prisma.join(values)}) AS data("norad_id", "display_name", "object_id", "epoch", "mean_motion", "eccentricity", "inclination", "ra_of_asc_node", "arg_of_pericenter", "mean_anomaly", "bstar", "mean_motion_dot", "mean_motion_ddot", "tle1", "tle2", "tle_updated_at")
          WHERE satellite."norad_id" = data."norad_id"::integer
        `;
      }
    }

    return {
      downloaded: satellites.length,
      created: satellitesToCreate.length,
      updated: satellitesToUpdate.length,
    };
  }
}
