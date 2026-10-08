import type { UpsertSatelliteDTO } from "../../../modules/satellites/dto/UpsertSatelliteDTO";

export const requiredColumns = [
  "NORAD_CAT_ID",
  "OBJECT_NAME",
  "OBJECT_ID",
  "EPOCH",
  "MEAN_MOTION",
  "ECCENTRICITY",
  "INCLINATION",
  "RA_OF_ASC_NODE",
  "ARG_OF_PERICENTER",
  "MEAN_ANOMALY",
  "BSTAR",
  "MEAN_MOTION_DOT",
  "MEAN_MOTION_DDOT",
];

export function mapRow(row: Record<string, string>): UpsertSatelliteDTO {
  const number = (field: string): number | null => {
    const text = row[field]?.trim();
    if (!text) return null;
    const value = Number(text);
    if (!Number.isFinite(value)) throw new Error(`Invalid ${field}`);
    return value;
  };
  const noradId = number("NORAD_CAT_ID");
  if (noradId === null || !Number.isSafeInteger(noradId) || noradId <= 0) {
    throw new Error("Invalid NORAD_CAT_ID");
  }
  const displayName = row.OBJECT_NAME?.trim();
  if (!displayName) throw new Error("Missing OBJECT_NAME");
  const text = row.EPOCH?.trim();
  // CelesTrak epochs are UTC, even when no timezone suffix is supplied.
  const epoch = text
    ? new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(text) ? text : `${text}Z`)
    : null;
  if (epoch && Number.isNaN(epoch.getTime())) throw new Error("Invalid EPOCH");
  return {
    noradId,
    displayName,
    objectId: row.OBJECT_ID?.trim() || null,
    epoch,
    meanMotion: number("MEAN_MOTION"),
    eccentricity: number("ECCENTRICITY"),
    inclination: number("INCLINATION"),
    raOfAscNode: number("RA_OF_ASC_NODE"),
    argOfPericenter: number("ARG_OF_PERICENTER"),
    meanAnomaly: number("MEAN_ANOMALY"),
    bstar: number("BSTAR"),
    meanMotionDot: number("MEAN_MOTION_DOT"),
    meanMotionDdot: number("MEAN_MOTION_DDOT"),
    // CSV contains orbital elements, not TLE lines. Repository preserves existing TLEs.
    tle1: null,
    tle2: null,
    tleUpdatedAt: null,
  };
}
