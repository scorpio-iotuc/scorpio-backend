import { json2satrec, twoline2satrec, type SatRec } from "satellite.js";
import type { Satellite } from "../../satellites/entities/Satellite";
import { InvalidOrbitError } from "../errors/InvalidOrbitError";

/**
 * This function computes the satellite's orbit from its orbital elements or TLE strings.
 * @param satellite satellite to predict passes for
 * @returns SatRec object representing the satellite's orbit
 */
export function orbit(satellite: Satellite): SatRec {
  const fields = [
    satellite.meanMotion,
    satellite.eccentricity,
    satellite.inclination,
    satellite.raOfAscNode,
    satellite.argOfPericenter,
    satellite.meanAnomaly,
    satellite.bstar,
    satellite.meanMotionDot,
    satellite.meanMotionDdot,
  ];
  // Satellite records can be created from either a complete set of orbital elements or a valid TLE pair.
  let record: SatRec;
  // CSV updates preserve old TLE strings, so prefer the current complete elements.
  if (
    satellite.epoch &&
    Number.isFinite(satellite.epoch.getTime()) &&
    fields.every((value) => typeof value === "number" && Number.isFinite(value))
  ) {
    record = json2satrec({
      OBJECT_NAME: satellite.displayName,
      OBJECT_ID: satellite.objectId ?? "",
      NORAD_CAT_ID: satellite.noradId,
      EPOCH: satellite.epoch.toISOString(),
      MEAN_MOTION: satellite.meanMotion!,
      ECCENTRICITY: satellite.eccentricity!,
      INCLINATION: satellite.inclination!,
      RA_OF_ASC_NODE: satellite.raOfAscNode!,
      ARG_OF_PERICENTER: satellite.argOfPericenter!,
      MEAN_ANOMALY: satellite.meanAnomaly!,
      BSTAR: satellite.bstar!,
      MEAN_MOTION_DOT: satellite.meanMotionDot!,
      MEAN_MOTION_DDOT: satellite.meanMotionDdot!,
      ELEMENT_SET_NO: 0,
    });
  } else if (
    satellite.tle1?.startsWith("1 ") &&
    satellite.tle2?.startsWith("2 ") &&
    satellite.tle1.length >= 63 &&
    satellite.tle2.length >= 63
  ) {
    record = twoline2satrec(satellite.tle1, satellite.tle2);
    if (
      satellite.tle1.slice(2, 7) !== satellite.tle2.slice(2, 7) ||
      Number(record.satnum) !== satellite.noradId
    )
      throw new InvalidOrbitError();
  } else {
    throw new InvalidOrbitError();
  }
  if (
    record.error ||
    ![
      record.no,
      record.ecco,
      record.inclo,
      record.nodeo,
      record.argpo,
      record.mo,
      record.bstar,
      record.jdsatepoch,
    ].every(Number.isFinite) ||
    record.no <= 0 ||
    record.ecco < 0 ||
    record.ecco >= 1 ||
    record.inclo < 0 ||
    record.inclo > Math.PI
  ) {
    throw new InvalidOrbitError();
  }
  return record;
}
