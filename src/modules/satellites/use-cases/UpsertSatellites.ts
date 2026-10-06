import { UpsertSatellitesResultDTO } from '../dto/UpsertSatellitesResultDTO';
import { SatelliteRepository } from '../repositories/SatelliteRepository';
import { CelesTrakClient } from '../services/CelesTrakClient';

interface CelesTrakSatelliteRecord {
  NORAD_CAT_ID: number | string;
  OBJECT_NAME: string;
  OBJECT_ID?: string | null;
  EPOCH?: string | null;
  MEAN_MOTION?: number | string | null;
  ECCENTRICITY?: number | string | null;
  INCLINATION?: number | string | null;
  RA_OF_ASC_NODE?: number | string | null;
  ARG_OF_PERICENTER?: number | string | null;
  MEAN_ANOMALY?: number | string | null;
  BSTAR?: number | string | null;
  MEAN_MOTION_DOT?: number | string | null;
  MEAN_MOTION_DDOT?: number | string | null;
  TLE_LINE1?: string | null;
  TLE_LINE2?: string | null;
}

interface ParsedSatellite {
  noradId: number;
  displayName: string;
  objectId: string | null;
  epoch: Date | null;
  meanMotion: number | null;
  eccentricity: number | null;
  inclination: number | null;
  raOfAscNode: number | null;
  argOfPericenter: number | null;
  meanAnomaly: number | null;
  bstar: number | null;
  meanMotionDot: number | null;
  meanMotionDdot: number | null;
  tle1: string | null;
  tle2: string | null;
  tleUpdatedAt: Date | null;
}

const toNullableNumber = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);

  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid numeric value received from CelesTrak: ${value}`);
  }

  return parsed;
};

const toNullableDate = (value: string | null | undefined): Date | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date value received from CelesTrak: ${value}`);
  }

  return parsed;
};

const parseNoradId = (value: number | string): number => {
  const parsed = Number(value);

  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid NORAD_CAT_ID received from CelesTrak: ${value}`);
  }

  return parsed;
};

const parseCelesTrakJsonResponse = (body: string): ParsedSatellite[] => {
  const parsedBody: unknown = JSON.parse(body);

  if (!Array.isArray(parsedBody)) {
    throw new Error('Unexpected CelesTrak JSON response format.');
  }

  return parsedBody.map((entry) => {
    const satellite = entry as CelesTrakSatelliteRecord;

    if (satellite.NORAD_CAT_ID === undefined || satellite.OBJECT_NAME === undefined) {
      throw new Error('Unexpected CelesTrak JSON satellite record.');
    }

    return {
      noradId: parseNoradId(satellite.NORAD_CAT_ID),
      displayName: String(satellite.OBJECT_NAME),
      objectId: satellite.OBJECT_ID ?? null,
      epoch: toNullableDate(satellite.EPOCH ?? null),
      meanMotion: toNullableNumber(satellite.MEAN_MOTION ?? null),
      eccentricity: toNullableNumber(satellite.ECCENTRICITY ?? null),
      inclination: toNullableNumber(satellite.INCLINATION ?? null),
      raOfAscNode: toNullableNumber(satellite.RA_OF_ASC_NODE ?? null),
      argOfPericenter: toNullableNumber(satellite.ARG_OF_PERICENTER ?? null),
      meanAnomaly: toNullableNumber(satellite.MEAN_ANOMALY ?? null),
      bstar: toNullableNumber(satellite.BSTAR ?? null),
      meanMotionDot: toNullableNumber(satellite.MEAN_MOTION_DOT ?? null),
      meanMotionDdot: toNullableNumber(satellite.MEAN_MOTION_DDOT ?? null),
      tle1: satellite.TLE_LINE1 ?? null,
      tle2: satellite.TLE_LINE2 ?? null,
      tleUpdatedAt: satellite.TLE_LINE1 && satellite.TLE_LINE2 ? new Date() : null,
    };
  });
};

const toUpsertSatelliteDTO = (satellite: ParsedSatellite): ParsedSatellite => ({
  noradId: satellite.noradId,
  displayName: satellite.displayName,
  objectId: satellite.objectId,
  epoch: satellite.epoch,
  meanMotion: satellite.meanMotion,
  eccentricity: satellite.eccentricity,
  inclination: satellite.inclination,
  raOfAscNode: satellite.raOfAscNode,
  argOfPericenter: satellite.argOfPericenter,
  meanAnomaly: satellite.meanAnomaly,
  bstar: satellite.bstar,
  meanMotionDot: satellite.meanMotionDot,
  meanMotionDdot: satellite.meanMotionDdot,
  tle1: satellite.tle1,
  tle2: satellite.tle2,
  tleUpdatedAt: satellite.tleUpdatedAt,
});

export class UpsertSatellites {
  constructor(
    private readonly satelliteRepository: SatelliteRepository,
    private readonly celestrakClient: CelesTrakClient,
  ) {}

  async upsertSatellites(onDownloaded?: () => Promise<void>): Promise<UpsertSatellitesResultDTO> {
    const startedAt = Date.now();

    console.log('[Satellites][UPSERT] Downloading active satellites from CelesTrak');

    try {
      const responseBody = await this.celestrakClient.downloadActiveSatellites();
      await onDownloaded?.();
      const parsedSatellites = parseCelesTrakJsonResponse(responseBody);
      const result = await this.satelliteRepository.upsertMany(parsedSatellites.map(toUpsertSatelliteDTO));

      const elapsedMs = Date.now() - startedAt;

      console.log('[Satellites][UPSERT] Synchronization completed', {
        downloaded: result.downloaded,
        created: result.created,
        updated: result.updated,
        processingTimeMs: elapsedMs,
      });

      return result;
    } catch (error) {
      console.error('[Satellites][UPSERT] Failed to synchronize satellites', error);

      const message = error instanceof Error ? error.message : 'Unexpected error. check the logs for more details';
      throw new Error(`Failed to synchronize satellites from CelesTrak: ${message}`);
    }
  }

  async execute(onDownloaded?: () => Promise<void>): Promise<UpsertSatellitesResultDTO> {
    return this.upsertSatellites(onDownloaded);
  }
}
