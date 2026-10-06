CREATE TYPE "SatelliteUpsertJobStatus" AS ENUM ('running', 'completed', 'failed');

CREATE TABLE "SatelliteUpsertJob" (
    "id" TEXT NOT NULL,
    "status" "SatelliteUpsertJobStatus" NOT NULL DEFAULT 'running',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "downloaded" BOOLEAN NOT NULL DEFAULT false,
    "created" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated" TIMESTAMP(3) NOT NULL,
    "error_message" TEXT,
    CONSTRAINT "SatelliteUpsertJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SatelliteUpsertJob_created_idx" ON "SatelliteUpsertJob"("created");
-- Enforce one active synchronization, including across API instances.
CREATE UNIQUE INDEX "SatelliteUpsertJob_one_running_idx"
ON "SatelliteUpsertJob" ("status") WHERE "status" = 'running';
