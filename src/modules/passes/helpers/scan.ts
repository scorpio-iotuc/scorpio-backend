import { createHash } from "node:crypto";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import type { Satellite } from "../../satellites/entities/Satellite";
import type { Pass } from "../entities/Pass";

// Step size for scanning the satellite's elevation over the station, in milliseconds.
const STEP_MS = 10_000;
// Precision for determining the times of acquisition of signal (AOS) and loss of signal (LOS), in milliseconds.
const PRECISION_MS = 100;

/**
 * Scans for passes of a satellite over a station between a start and end time, with a minimum elevation requirement.
 *
 * @param satellite Satellite to predict passes for
 * @param stationUuid Station UUID to predict passes for
 * @param start Start time in milliseconds since epoch
 * @param end  End time in milliseconds since epoch
 * @param minElevation Minimum elevation in degrees for a pass to be considered valid
 * @param elevation  Function that returns the elevation in degrees of the satellite at a given time in milliseconds since epoch
 * @param extension Extension time in milliseconds to continue scanning beyond the end time
 * @returns Promise that resolves to an array of Pass objects
 *
 * This function scans for passes of a satellite over a station between a start and end time,
 * with a minimum elevation requirement. It uses a binary search to find the times of
 * acquisition of signal (AOS) and loss of signal (LOS) for each pass, and refines the maximum
 * elevation time to ensure accurate pass data. The function yields to the event loop periodically
 *  to avoid blocking the main thread during long computations.
 */
export async function scan(
  satellite: Satellite,
  stationUuid: string,
  start: number,
  end: number,
  minElevation: number,
  elevation: (time: number) => number,
  extension: number,
): Promise<Pass[]> {
  const passes: Pass[] = [];
  // Function to find the time when the satellite crosses the horizon (elevation = 0) using binary search
  const crossing = (left: number, right: number, rising: boolean): number => {
    while (right - left > PRECISION_MS) {
      const middle = (left + right) / 2;
      if (elevation(middle) >= 0 === rising) right = middle;
      else left = middle;
    }
    return Math.round((left + right) / 2);
  };

  let previousTime = start;
  let previousElevation = elevation(start);
  let aos: number | undefined;
  let peakTime = start;
  let peakElevation = -Infinity;
  let iterations = 0;
  // Only rising crossings in [start, end) begin a pass. Continue an open pass
  // beyond end to find its real LOS, bounded by one orbital period (max 24 h).
  while (
    previousTime < end ||
    (aos !== undefined && previousTime < end + extension)
  ) {
    const time = Math.min(
      previousTime + STEP_MS,
      previousTime < end ? end : end + extension,
    );
    const current = elevation(time);
    if (aos === undefined && previousElevation < 0 && current >= 0) {
      const rise = crossing(previousTime, time, true);
      if (rise < end) {
        aos = rise;
        peakTime = time;
        peakElevation = current;
      }
    }
    if (aos !== undefined) {
      if (current > peakElevation) {
        peakElevation = current;
        peakTime = time;
      }
      if (previousElevation >= 0 && current < 0) {
        const los = crossing(previousTime, time, false);
        // Refine around the highest sampled point, rather than assuming the
        // maximum is the midpoint of AOS and LOS.
        let left = Math.max(aos, peakTime - STEP_MS);
        let right = Math.min(los, peakTime + STEP_MS);
        while (right - left > PRECISION_MS) {
          const first = left + (right - left) / 3;
          const second = right - (right - left) / 3;
          if (elevation(first) < elevation(second)) left = first;
          else right = second;
        }
        const maximumAt = Math.round((left + right) / 2);
        const maximum = elevation(maximumAt);
        if (maximum >= minElevation) {
          // We create a unique pass ID by hashing the station UUID,
          // satellite NORAD ID, and AOS time.
          const passId = createHash("sha256")
            .update(
              `${stationUuid}:${satellite.noradId}:${Math.round(aos / 1000)}`,
            )
            .digest("hex")
            .slice(0, 24);
          passes.push({
            passId,
            satelliteId: satellite.noradId,
            satelliteName: satellite.displayName,
            aos: new Date(aos),
            los: new Date(los),
            maxElevation: Math.round(maximum * 100) / 100,
            maxElevationAt: new Date(maximumAt),
          });
        }
        aos = undefined;
        peakElevation = -Infinity;
      }
    }
    previousTime = time;
    previousElevation = current;
    if (++iterations % 2000 === 0) await yieldToEventLoop();
  }
  return passes;
}
