import type { JobInterface } from "./JobInterface";
import type NotifyClientInterface from "./notify/NotifyClientInterface";
import { SatelliteUpsertJob } from "./upsert-satellite/SatelliteUpsertJob";
import { CreateStationPassesJob } from "./create-station-passes/CreateStationPassesJob";
import { PrismaSatelliteUpsertJobRepository } from "../modules/satellites/repositories/PrismaSatelliteUpsertJobRepository";
import { PrismaSatelliteRepository } from "../modules/satellites/repositories/PrismaSatelliteRepository";
import { PrismaStationRepository } from "../modules/stations/repositories/PrismaStationRepository";
import { PrismaPassRepository } from "../modules/passes/repositories/PrismaPassRepository";
import { PrismaStationPassJobRepository } from "../modules/passes/repositories/PrismaStationPassJobRepository";
import { UpsertSatellites } from "../modules/satellites/use-cases/UpsertSatellites";
import { CreatePasses } from "../modules/passes/use-cases/CreatePasses";
import { FetchCelesTrakClient } from "./upsert-satellite/clients/CelesTrakClient";
import { executeSatelliteJob } from "./upsert-satellite/execute-job";
import { executeStationPassJob } from "./create-station-passes/execute-job";

/** Register new JobInterface implementations here; the coordinator/queue need no changes. */
export function createJobRegistry(
  notifications?: NotifyClientInterface,
  env: NodeJS.ProcessEnv = process.env,
): JobInterface[] {
  const satellites = new PrismaSatelliteRepository();
  const satelliteJobs = new PrismaSatelliteUpsertJobRepository();
  const passJobs = new PrismaStationPassJobRepository();
  const passes = new PrismaPassRepository();
  const stations = new PrismaStationRepository();

  // On equal queue timestamps, refresh orbital elements before predicting passes.
  return [
    new SatelliteUpsertJob(
      (id) =>
        executeSatelliteJob(
          id,
          satelliteJobs,
          new UpsertSatellites(satellites),
          new FetchCelesTrakClient(),
          notifications,
        ),
      env.UPSERT_SATELLITES_TRIGGER_TIME ?? "00:00",
      env.RUN_ON_START === "true",
    ),
    new CreateStationPassesJob(
      (job) =>
        executeStationPassJob(
          job,
          passJobs,
          stations,
          passes,
          satellites,
          new CreatePasses(passes),
          notifications,
        ),
      Number(env.STATION_PASSES_WINDOW_HOURS ?? 72),
    ),
  ];
}
