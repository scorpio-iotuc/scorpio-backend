import {
  degreesToRadians,
  radiansToDegrees,
  ecfToLookAngles,
  eciToEcf,
  gstime,
  propagate,
} from "satellite.js";
import type { Satellite } from "../../satellites/entities/Satellite";
import type { Station } from "../../stations/entities/Station";
import type { Pass } from "../entities/Pass";
import { orbit } from "./orbit";
import { scan } from "./scan";
import { InvalidOrbitError } from "../errors/InvalidOrbitError";

/**
 * Predicts passes of a satellite over a station between a start and end time, with a minimum elevation requirement.
 *
 * @param satellite satellite to predict passes for
 * @param station station to predict passes for
 * @param start start time in milliseconds since epoch
 * @param end end time in milliseconds since epoch
 * @param minElevation minimum elevation in degrees for a pass to be considered valid
 * @returns  Promise that resolves to an array of Pass objects
 *
 */
export async function predict(
  satellite: Satellite,
  station: Station,
  start: number,
  end: number,
  minElevation: number,
): Promise<Pass[]> {
  // First we compute the satellite's orbit from its orbital elements or TLE strings.
  // This is necessary to propagate the satellite's position over time and determine when
  // it will be visible from the station.
  const record = orbit(satellite);
  // Secondly, we define the observer's location based on the station's coordinates.
  const observer = {
    latitude: degreesToRadians(station.latitude),
    longitude: degreesToRadians(station.longitude),
    height: station.altitude / 1000, // Station altitude is metres; satellite.js uses kilometres.
  };
  // Finally, we define a function that computes the satellite's elevation over the station at a given time.
  const elevation = (time: number): number => {
    const date = new Date(time);
    const state = propagate(record, date);
    if (!state?.position || record.error) throw new InvalidOrbitError();
    const result = radiansToDegrees(
      ecfToLookAngles(observer, eciToEcf(state.position, gstime(date)))
        .elevation,
    );
    if (!Number.isFinite(result)) throw new InvalidOrbitError();
    return result;
  };
  // We then call the scan function to find the passes of the satellite over the station between
  //  the start and end times, with the specified minimum elevation requirement.
  return scan(
    satellite,
    station.uuid,
    start,
    end,
    minElevation,
    elevation,
    Math.min(((2 * Math.PI) / record.no) * 60_000, 24 * 3_600_000),
  );
}
