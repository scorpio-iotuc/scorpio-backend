-- CreateTable
CREATE TABLE "StationPassJob" (
    "id" TEXT NOT NULL,
    "status" "SatelliteUpsertJobStatus" NOT NULL DEFAULT 'queued',
    "schedule_key" TEXT,
    "window_hours" INTEGER NOT NULL DEFAULT 72,
    "window_start" TIMESTAMP(3),
    "window_end" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "error_message" TEXT,
    "generated" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StationPassJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StationPassGeneration" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "station_uuid" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "altitude" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StationPassGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SatellitePass" (
    "id" TEXT NOT NULL,
    "generation_id" TEXT NOT NULL,
    "station_uuid" TEXT NOT NULL,
    "satellite_id" INTEGER NOT NULL,
    "satellite_name" TEXT NOT NULL,
    "satellite_norad_id" INTEGER NOT NULL,
    "aos" TIMESTAMP(3) NOT NULL,
    "los" TIMESTAMP(3) NOT NULL,
    "max_elevation" DOUBLE PRECISION NOT NULL,
    "max_elevation_at" TIMESTAMP(3) NOT NULL,
    "orbital_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SatellitePass_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StationPassJob_schedule_key_key" ON "StationPassJob"("schedule_key");

-- CreateIndex
CREATE INDEX "StationPassJob_status_created_at_idx" ON "StationPassJob"("status", "created_at");

-- CreateIndex
CREATE INDEX "StationPassGeneration_station_uuid_created_at_idx" ON "StationPassGeneration"("station_uuid", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "StationPassGeneration_job_id_station_uuid_key" ON "StationPassGeneration"("job_id", "station_uuid");

-- CreateIndex
CREATE UNIQUE INDEX "StationPassGeneration_id_station_uuid_key" ON "StationPassGeneration"("id", "station_uuid");

-- CreateIndex
CREATE INDEX "SatellitePass_generation_id_station_uuid_aos_idx" ON "SatellitePass"("generation_id", "station_uuid", "aos");

-- CreateIndex
CREATE INDEX "SatellitePass_satellite_id_idx" ON "SatellitePass"("satellite_id");

-- CreateIndex
CREATE INDEX "SatellitePass_los_idx" ON "SatellitePass"("los");

-- CreateIndex
CREATE UNIQUE INDEX "SatellitePass_generation_id_satellite_id_aos_key" ON "SatellitePass"("generation_id", "satellite_id", "aos");

-- AddForeignKey
ALTER TABLE "StationPassGeneration" ADD CONSTRAINT "StationPassGeneration_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "StationPassJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StationPassGeneration" ADD CONSTRAINT "StationPassGeneration_station_uuid_fkey" FOREIGN KEY ("station_uuid") REFERENCES "Station"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SatellitePass" ADD CONSTRAINT "SatellitePass_generation_id_station_uuid_fkey" FOREIGN KEY ("generation_id", "station_uuid") REFERENCES "StationPassGeneration"("id", "station_uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SatellitePass" ADD CONSTRAINT "SatellitePass_station_uuid_fkey" FOREIGN KEY ("station_uuid") REFERENCES "Station"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SatellitePass" ADD CONSTRAINT "SatellitePass_satellite_id_fkey" FOREIGN KEY ("satellite_id") REFERENCES "Satellite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
