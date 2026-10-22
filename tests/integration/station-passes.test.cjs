require("ts-node/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

const databaseUrl = process.env.PASSES_TEST_DATABASE_URL;
test(
  "PostgreSQL: job exclusion, staged publication, snapshots, filtering and expired-pass cleanup",
  { skip: !databaseUrl },
  async () => {
    // Opt-in only. Run against a migrated disposable database, never the application database.
    process.env.DATABASE_URL = databaseUrl;
    const { prisma } = require("../../src/lib/prisma");
    const { JobQueue } = require("../../src/jobs/queue");
    const { createJobRegistry } = require("../../src/jobs/registry");
    const {
      PrismaPassRepository,
    } = require("../../src/modules/passes/repositories/PrismaPassRepository");
    const {
      PrismaStationPassJobRepository,
    } = require("../../src/modules/passes/repositories/PrismaStationPassJobRepository");
    const {
      PrismaSatelliteRepository,
    } = require("../../src/modules/satellites/repositories/PrismaSatelliteRepository");
    const {
      PrismaStationRepository,
    } = require("../../src/modules/stations/repositories/PrismaStationRepository");
    const {
      CreatePasses,
    } = require("../../src/modules/passes/use-cases/CreatePasses");
    const {
      ListPasses,
    } = require("../../src/modules/passes/use-cases/ListPasses");
    const {
      GetPassTrajectory,
    } = require("../../src/modules/passes/use-cases/GetPassTrajectory");
    const token = randomUUID();
    const start = new Date("2025-03-26T05:19:34.116Z");
    const jobs = new PrismaStationPassJobRepository(),
      passes = new PrismaPassRepository();
    const satellites = new PrismaSatelliteRepository(),
      stations = new PrismaStationRepository();
    const queue = new JobQueue(createJobRegistry());
    let user;
    const jobIds = [],
      satIds = [],
      upsertIds = [];
    try {
      user = await prisma.user.create({
        data: {
          name: "Pass integration",
          email: `passes-${token}@example.test`,
          pwd_encrypted: "test-only",
        },
      });
      const stationRow = await prisma.station.create({
        data: {
          uuid: token,
          name: "Test station",
          latitude: -33.497866,
          longitude: -70.615255,
          altitude: 622,
          owner_id: user.id,
          owner_key_hash: "test-only",
        },
      });
      const sat = await prisma.satellite.create({
        data: {
          norad_id: 28492,
          display_name: "HELIOS 2A",
          object_id: "2004-049A",
          epoch: start,
          mean_motion: 15.00555103,
          eccentricity: 0.000583,
          inclination: 98.3164,
          ra_of_asc_node: 103.8411,
          arg_of_pericenter: 20.5667,
          mean_anomaly: 339.5789,
          bstar: 0.00048021,
          mean_motion_dot: 0.00005995,
          mean_motion_ddot: 0,
        },
      });
      satIds.push(sat.id);
      const active = await prisma.satelliteUpsertJob.create({
        data: { status: "running" },
      });
      upsertIds.push(active.id);
      const queued = await prisma.stationPassJob.create({
        data: { window_hours: 72 },
      });
      jobIds.push(queued.id);
      assert.equal(await queue.claimNext(start), null);
      assert.equal(
        (await prisma.stationPassJob.findUnique({ where: { id: queued.id } }))
          .status,
        "queued",
      );
      await prisma.satelliteUpsertJob.update({
        where: { id: active.id },
        data: { status: "completed" },
      });
      const claimed = await queue.claimNext(start);
      assert.equal(claimed.kind, "passes");
      const claimedRecord = await prisma.stationPassJob.findUniqueOrThrow({
        where: { id: claimed.id },
      });
      const pendingUpsert = await prisma.satelliteUpsertJob.create({
        data: { status: "queued" },
      });
      upsertIds.push(pendingUpsert.id);
      assert.equal(await queue.claimNext(start), null);
      assert.equal(
        (
          await prisma.satelliteUpsertJob.findUnique({
            where: { id: pendingUpsert.id },
          })
        ).status,
        "queued",
      );
      // Remove this fixture's queued upsert before testing subsequent prediction generations.
      await prisma.satelliteUpsertJob.update({
        where: { id: pendingUpsert.id },
        data: { status: "completed" },
      });
      const station = await stations.findByUuid(token);
      const creator = new CreatePasses(passes);
      const generationId = await passes.createGeneration(queued.id, station);
      let result;
      try {
        result = await creator.execute(
          queued.id,
          generationId,
          station,
          (await satellites.findAll({ afterId: 0, limit: 100 })).data,
          claimedRecord.window_start,
          claimedRecord.window_end,
        );
      } finally {
        await creator.close();
      }
      assert.ok(result.generated > 0);
      assert.equal(
        await passes.findLatestGeneration(token),
        null,
        "staged passes must not be published",
      );
      await jobs.complete(queued.id);
      const listing = new ListPasses(stations, satellites, passes, () => start);
      const listed = await listing.execute({
        stationUuid: token,
        minElevation: 0,
      });
      assert.ok(listed.passes.length > 0);
      const filtered = await listing.execute({
        stationUuid: token,
        minElevation: 40,
        satelliteNoradId: 28492,
      });
      assert.deepEqual(
        filtered.passes,
        listed.passes.filter((p) => p.maxElevation >= 40),
      );
      const pass = listed.passes[0];
      assert.equal(pass.satelliteId, 28492);
      const trajectory = new GetPassTrajectory(passes);
      const before = await trajectory.execute(pass.passId, 10);
      assert.equal(before.points[0].time.getTime(), pass.aos.getTime());
      assert.equal(before.points.at(-1).time.getTime(), pass.los.getTime());
      await prisma.satellite.update({
        where: { id: sat.id },
        data: { inclination: 0, mean_anomaly: 0 },
      });
      assert.deepEqual(
        await trajectory.execute(pass.passId, 10),
        before,
        "must use immutable orbital snapshot",
      );
      const failed = await prisma.stationPassJob.create({
        data: {
          status: "running",
          window_hours: 72,
          window_start: start,
          window_end: claimedRecord.window_end,
        },
      });
      jobIds.push(failed.id);
      await passes.createGeneration(failed.id, station);
      await jobs.fail(failed.id, "test failure");
      assert.equal(
        await prisma.stationPassGeneration.count({
          where: { job_id: failed.id },
        }),
        0,
      );
      assert.equal(
        (await passes.findLatestGeneration(token)).id,
        (
          await prisma.stationPassGeneration.findFirst({
            where: { job_id: queued.id },
          })
        ).id,
      );
      const row = await prisma.satellitePass.findUnique({
        where: { id: pass.passId },
      });
      await assert.rejects(
        prisma.satellitePass.create({
          data: {
            ...row,
            id: randomUUID(),
            aos: new Date(row.aos.getTime() + 1),
            station_uuid: "missing-station",
          },
        }),
        (e) => e.code === "P2003",
      );
      assert.equal(
        await passes.deleteExpired(pass.los),
        0,
        "LOS equal to cutoff is retained",
      );
      assert.ok(
        (await passes.deleteExpired(new Date(pass.los.getTime() + 1))) >= 1,
      );
      assert.equal(await passes.findById(pass.passId), null);
      assert.ok(
        (await prisma.satellitePass.count({
          where: { generation_id: row.generation_id },
        })) > 0,
        "future passes retained",
      );
      await prisma.station.update({
        where: { id: stationRow.id },
        data: { latitude: 0 },
      });
      await assert.rejects(
        listing.execute({ stationUuid: token }),
        (e) => e.status === 503,
      );
    } finally {
      await prisma.stationPassJob.deleteMany({ where: { id: { in: jobIds } } });
      await prisma.satelliteUpsertJob.deleteMany({
        where: { id: { in: upsertIds } },
      });
      await prisma.satellite.deleteMany({ where: { id: { in: satIds } } });
      if (user) {
        await prisma.station.deleteMany({ where: { owner_id: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
      }
      await prisma.$disconnect();
    }
  },
);
