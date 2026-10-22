import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import {
  degreesToRadians,
  radiansToDegrees,
  propagate,
  gstime,
  eciToEcf,
  ecfToLookAngles,
} from "satellite.js";
import type { PassRepository } from "../repositories/PassRepository";
import { orbit } from "../helpers/orbit";
import { InvalidOrbitError } from "../errors/InvalidOrbitError";
import { PassesInputError } from "../errors/PassesInputError";

export class GetPassTrajectory {
  constructor(private readonly passes: PassRepository) {}

  async execute(passId: string, stepSeconds: number, stationUuid?: string) {
    const stored = await this.passes.findById(passId);
    if (
      !stored ||
      (stationUuid !== undefined && stationUuid !== stored.station.uuid)
    )
      return null;
    const { pass, station, satellite } = stored;
    const start = pass.aos.getTime();
    const end = pass.los.getTime();
    // Bound the payload even for long passes and small valid sampling intervals.
    if (Math.ceil((end - start) / (stepSeconds * 1000)) + 1 > 10_000) {
      throw new PassesInputError(
        "Trajectory exceeds 10000 points; increase stepSeconds",
        422,
      );
    }
    try {
      const record = orbit(satellite);
      const observer = {
        latitude: degreesToRadians(station.latitude),
        longitude: degreesToRadians(station.longitude),
        height: station.altitude / 1000,
      };
      const points: { time: Date; azimuth: number; elevation: number }[] = [];
      // Always include the exact stored AOS and LOS, even when duration is not a multiple of the step.
      for (
        let time = start;
        ;
        time = Math.min(time + stepSeconds * 1000, end)
      ) {
        const date = new Date(time);
        const state = propagate(record, date);
        if (!state?.position || record.error) throw new InvalidOrbitError();
        const angles = ecfToLookAngles(
          observer,
          eciToEcf(state.position, gstime(date)),
        );
        const azimuth = (radiansToDegrees(angles.azimuth) + 360) % 360;
        const elevation = radiansToDegrees(angles.elevation);
        if (!Number.isFinite(azimuth) || !Number.isFinite(elevation))
          throw new InvalidOrbitError();
        points.push({ time: date, azimuth, elevation });
        if (time === end) break;
        if (points.length % 1000 === 0) await yieldToEventLoop();
      }
      return { passId, points };
    } catch (error) {
      if (!(error instanceof InvalidOrbitError)) throw error;
      throw new PassesInputError(
        "Stored orbital data cannot be propagated",
        422,
      );
    }
  }
}
