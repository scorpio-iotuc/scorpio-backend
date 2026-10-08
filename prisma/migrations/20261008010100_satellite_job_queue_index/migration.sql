ALTER TABLE "SatelliteUpsertJob" ALTER COLUMN "status" SET DEFAULT 'queued';
ALTER TABLE "SatelliteUpsertJob" ADD COLUMN "schedule_key" TEXT;
CREATE UNIQUE INDEX "SatelliteUpsertJob_schedule_key_key" ON "SatelliteUpsertJob" ("schedule_key");
DROP INDEX "SatelliteUpsertJob_one_running_idx";
CREATE UNIQUE INDEX "SatelliteUpsertJob_one_active_idx" ON "SatelliteUpsertJob" ((1)) WHERE status IN ('queued', 'running');
