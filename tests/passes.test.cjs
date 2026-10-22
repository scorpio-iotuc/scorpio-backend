require("ts-node/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ListPasses } = require("../src/modules/passes/use-cases/ListPasses");
const {
  CreatePasses,
} = require("../src/modules/passes/use-cases/CreatePasses");
const {
  GetPassTrajectory,
} = require("../src/modules/passes/use-cases/GetPassTrajectory");
const {
  PassController,
} = require("../src/modules/passes/controllers/PassesController");
const { orbit } = require("../src/modules/passes/helpers/orbit");
const { predict } = require("../src/modules/passes/helpers/predict");
const { scan } = require("../src/modules/passes/helpers/scan");
const {
  InvalidOrbitError,
} = require("../src/modules/passes/errors/InvalidOrbitError");
const satelliteJs = require("satellite.js");
const start = new Date("2025-03-26T05:19:34.116Z");
const end = new Date(start.getTime() + 72 * 3600_000);
const station = {
  uuid: "station-uuid",
  latitude: -33.497866,
  longitude: -70.615255,
  altitude: 622,
};
const satellite = {
  id: 12,
  noradId: 28492,
  displayName: "HELIOS 2A",
  objectId: "2004-049A",
  epoch: start,
  meanMotion: 15.00555103,
  eccentricity: 0.000583,
  inclination: 98.3164,
  raOfAscNode: 103.8411,
  argOfPericenter: 20.5667,
  meanAnomaly: 339.5789,
  bstar: 0.00048021,
  meanMotionDot: 0.00005995,
  meanMotionDdot: 0,
  tle1: null,
  tle2: null,
};
function fixture() {
  const calls = [];
  const stations = {
    findByUuid: async (uuid) => {
      calls.push(["station", uuid]);
      return uuid === station.uuid ? station : null;
    },
  };
  const satellites = {
    findByNoradId: async (id) => {
      calls.push(["satellite", id]);
      return id === satellite.noradId ? satellite : null;
    },
  };
  const passes = {
    findLatestGeneration: async () => ({
      ...station,
      id: "generation",
      windowStart: start,
      windowEnd: end,
    }),
    findAll: async (query) => {
      calls.push(["passes", query]);
      return {
        passes: [],
        pagination: {
          page: query.page,
          limit: query.limit,
          total: 0,
          totalPages: 0,
        },
      };
    },
  };
  return {
    calls,
    passes,
    usecase: new ListPasses(stations, satellites, passes, () => start),
    controller: new PassController(stations, satellites, passes),
  };
}
const response = () => ({
  status(code) {
    this.code = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test("controller rejects malformed inputs before calling the use case", async () => {
  for (const query of [
    {},
    { stationUuid: "" },
    { stationUuid: ["x"] },
    ...["", "Infinity", "NaN", "0", "-1", "169"].map((hours) => ({
      stationUuid: station.uuid,
      hours,
    })),
    ...["", "-1", "91", "Infinity", ["10"]].map((minElevation) => ({
      stationUuid: station.uuid,
      minElevation,
    })),
    ...["", "1.5", "0", "-2", "Infinity", "2147483648", ["1"]].map(
      (noradid) => ({ stationUuid: station.uuid, noradid }),
    ),
    { stationUuid: station.uuid, noradid: "1", satelliteNoradId: "1" },
  ]) {
    const { controller, calls } = fixture();
    controller.listPasses.execute = async () => {
      assert.fail("Invalid input reached use case");
    };
    const res = response();
    await controller.list({ query }, res);
    assert.equal(res.code, 400, JSON.stringify(query));
    assert.equal(calls.length, 0);
  }
});

test("controller preserves defaults and NORAD alias and serializes the persisted result", async () => {
  for (const key of ["noradid", "satelliteNoradId"]) {
    const { controller } = fixture();
    const result = { stationUuid: station.uuid, windowHours: 24, passes: [] };
    controller.listPasses.execute = async (query) => {
      assert.deepEqual(query, {
        stationUuid: station.uuid,
        hours: 24,
        minElevation: 10,
        satelliteNoradId: 28492,
        satelliteDisplayName: undefined,
        page: 1,
        limit: 20,
      });
      return result;
    };
    const res = response();
    await controller.list(
      { query: { stationUuid: station.uuid, [key]: "28492" } },
      res,
    );
    assert.equal(res.code, 200);
    assert.equal(res.body, result);
  }
});

test("controller rejects invalid satelliteDisplayName before calling the use case", async () => {
  for (const satelliteDisplayName of [
    "", "   ", "\t\n", ["HELIOS"], ["HELIOS", "ISS"],
    { contains: "HELIOS" }, null, 28492,
  ]) {
    const { controller, calls } = fixture();
    controller.listPasses.execute = async () => {
      assert.fail("Invalid satelliteDisplayName reached use case");
    };
    const res = response();
    await controller.list(
      { query: { stationUuid: station.uuid, satelliteDisplayName } },
      res,
    );
    assert.equal(res.code, 400, JSON.stringify(satelliteDisplayName));
    assert.equal(res.body.message, "satelliteDisplayName must be a non-empty string");
    assert.equal(calls.length, 0);
  }
});

test("controller and use case forward satelliteDisplayName with pagination and optional NORAD", async () => {
  for (const satelliteDisplayName of ["HELIOS 2A", "eLiOs"]) {
    for (const noradid of [undefined, "28492"]) {
      const { controller, usecase, calls } = fixture();
      controller.listPasses = usecase;
      const res = response();
      await controller.list({ query: {
        stationUuid: station.uuid, satelliteDisplayName, noradid,
        hours: "12", minElevation: "25", page: "2", limit: "5",
      } }, res);
      assert.equal(res.code, 200);
      assert.deepEqual(calls.at(-1), ["passes", {
        stationUuid: station.uuid,
        generationId: "generation",
        satelliteDisplayName,
        satelliteNoradId: noradid === undefined ? undefined : 28492,
        start,
        end: new Date(start.getTime() + 12 * 3600_000),
        minElevation: 25,
        page: 2,
        limit: 5,
      }]);
      assert.equal(calls.filter(call => call[0] === "satellite").length,
        noradid === undefined ? 0 : 1);
      assert.deepEqual(res.body.pagination, { page: 2, limit: 5, total: 0, totalPages: 0 });
    }
  }
});

test("unknown station/satellite returns 404", async () => {
  for (const query of [
    { stationUuid: "unknown" },
    { stationUuid: station.uuid, noradid: "999" },
  ]) {
    const { controller } = fixture();
    const res = response();
    await controller.list({ query }, res);
    assert.equal(res.code, 404);
  }
});

test("ListPasses reads persisted predictions with all filters, without loading the catalogue", async () => {
  const { usecase, calls } = fixture();
  const result = await usecase.execute({
    stationUuid: station.uuid,
    hours: 12,
    minElevation: 25,
    satelliteNoradId: 28492,
    satelliteDisplayName: "helios",
  });
  assert.deepEqual(result, {
    stationUuid: station.uuid,
    windowHours: 12,
    passes: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
  });
  assert.deepEqual(calls.at(-1), [
    "passes",
    {
      page: 1,
      limit: 20,
      generationId: "generation",
      stationUuid: station.uuid,
      start,
      end: new Date(start.getTime() + 12 * 3600_000),
      minElevation: 25,
      satelliteNoradId: 28492,
      satelliteDisplayName: "helios",
    },
  ]);
});

test("missing, changed-station and insufficient prediction coverage are not reported as empty success", async () => {
  for (const generation of [
    null,
    { ...station, id: "g", latitude: 0, windowStart: start, windowEnd: end },
    {
      ...station,
      id: "g",
      windowStart: start,
      windowEnd: new Date(start.getTime() + 3600_000),
    },
  ]) {
    const { usecase, passes, calls } = fixture();
    passes.findLatestGeneration = async () => generation;
    await assert.rejects(
      usecase.execute({ stationUuid: station.uuid }),
      (error) => error.status === 503,
    );
    assert.ok(!calls.some((c) => c[0] === "passes"));
  }
});

test("CreatePasses waits for every task and bulk persistence before returning", async () => {
  let finishTask, finishWrite, writing;
  const blockedTask = new Promise((resolve) => (finishTask = resolve));
  const blockedWrite = new Promise((resolve) => (finishWrite = resolve));
  const writeStarted = new Promise((resolve) => (writing = resolve));
  let writes = 0,
    finished = false;
  const pool = {
    run: async (task) =>
      task.satellite.id === 1 ? blockedTask : { passes: [], skipped: true },
    destroy: async () => {},
  };
  const passes = {
    createBatch: async (g, uuid, rows) => {
      writes++;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].satellite.id, 1);
      writing();
      await blockedWrite;
      return 3;
    },
  };
  const create = new CreatePasses(passes, pool);
  const pending = create
    .execute(
      "job",
      "g",
      station,
      [
        { ...satellite, id: 1 },
        { ...satellite, id: 2 },
      ],
      start,
      end,
    )
    .then((r) => {
      finished = true;
      return r;
    });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes, 0);
  finishTask({ passes: [{}], skipped: false });
  await writeStarted;
  assert.equal(finished, false);
  finishWrite();
  assert.deepEqual(await pending, { generated: 3, skipped: 1 });
});

test("CreatePasses drains outstanding tasks on worker failure without writing partial results", async () => {
  let finish;
  const pendingTask = new Promise((resolve) => (finish = resolve));
  let rejected = false;
  const pool = {
    run: async (task) => {
      if (task.satellite.id === 1) throw new Error("worker failed");
      return pendingTask;
    },
    destroy: async () => {},
  };
  const create = new CreatePasses(
    { createBatch: async () => assert.fail("partial write") },
    pool,
  );
  const pending = create.execute(
    "job",
    "g",
    station,
    [
      { ...satellite, id: 1 },
      { ...satellite, id: 2 },
    ],
    start,
    end,
  );
  const checked = assert.rejects(pending, /worker failed/).then(() => {
    rejected = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(rejected, false);
  finish({ passes: [], skipped: false });
  await checked;
});

test("scan refines actual crossings and peak, including LOS beyond the window", async () => {
  const zero = start.getTime(),
    aos = zero + 12345,
    los = zero + 98765,
    peak = zero + 40123;
  const elevation = (t) =>
    t < peak
      ? ((t - aos) / (peak - aos)) * 60
      : ((los - t) / (los - peak)) * 60;
  const rows = await scan(
    satellite,
    station.uuid,
    zero,
    zero + 60000,
    10,
    elevation,
    120000,
  );
  assert.equal(rows.length, 1);
  assert.ok(Math.abs(rows[0].aos.getTime() - aos) < 100);
  assert.ok(Math.abs(rows[0].los.getTime() - los) < 100);
  assert.ok(Math.abs(rows[0].maxElevationAt.getTime() - peak) < 100);
  assert.deepEqual(
    await scan(
      satellite,
      station.uuid,
      zero,
      zero + 60000,
      70,
      elevation,
      120000,
    ),
    [],
  );
  for (const value of [-10, 30])
    assert.deepEqual(
      await scan(
        satellite,
        station.uuid,
        zero,
        zero + 60000,
        0,
        () => value,
        120000,
      ),
      [],
    );
});

test("real orbital elements and TLE fallback produce horizon crossings", async () => {
  const rows = await predict(
    satellite,
    station,
    start.getTime(),
    start.getTime() + 24 * 3600_000,
    10,
  );
  assert.ok(rows.length > 0);
  const record = orbit(satellite);
  const observer = {
    latitude: satelliteJs.degreesToRadians(station.latitude),
    longitude: satelliteJs.degreesToRadians(station.longitude),
    height: 0.622,
  };
  for (const pass of rows) {
    assert.ok(pass.aos < pass.maxElevationAt && pass.maxElevationAt < pass.los);
    for (const date of [pass.aos, pass.los]) {
      const position = satelliteJs.propagate(record, date).position;
      const angle = satelliteJs.radiansToDegrees(
        satelliteJs.ecfToLookAngles(
          observer,
          satelliteJs.eciToEcf(position, satelliteJs.gstime(date)),
        ).elevation,
      );
      assert.ok(Math.abs(angle) < 0.02);
    }
  }
  const tle = {
    noradId: 25544,
    displayName: "ISS",
    tle1: "1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992",
    tle2: "2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442",
  };
  assert.ok(
    (
      await predict(
        tle,
        station,
        Date.parse("2019-06-05T12:00:00Z"),
        Date.parse("2019-06-06T12:00:00Z"),
        10,
      )
    ).length > 0,
  );
  assert.throws(() => orbit({ ...tle, noradId: 1 }));
});

test("trajectory uses the stored snapshot and includes exact AOS/LOS with non-divisible steps", async () => {
  const [pass] = await predict(
    satellite,
    station,
    start.getTime(),
    start.getTime() + 24 * 3600_000,
    10,
  );
  pass.passId = "stored-id";
  const usecase = new GetPassTrajectory({
    findById: async () => ({ pass, station, satellite }),
  });
  const result = await usecase.execute("stored-id", 13, station.uuid);
  assert.equal(result.passId, "stored-id");
  assert.deepEqual(result.points[0].time, pass.aos);
  assert.deepEqual(result.points.at(-1).time, pass.los);
  assert.ok(
    result.points.every(
      (p) => p.azimuth >= 0 && p.azimuth < 360 && Number.isFinite(p.elevation),
    ),
  );
  assert.equal(await usecase.execute("stored-id", 10, "other-station"), null);
});

test("trajectory controller rejects missing passId, malformed steps and duplicate station values", async () => {
  for (const query of [
    {},
    { passId: "p", stepSeconds: "0" },
    { passId: "p", stepSeconds: "Infinity" },
    { passId: "p", stepSeconds: ["10"] },
    { passId: "p", stepSeconds: "1.5" },
    { passId: "p", stationUuid: ["x"] },
  ]) {
    const { controller } = fixture();
    controller.getTrajectory.execute = async () =>
      assert.fail("Invalid input reached use case");
    const res = response();
    await controller.trajectory({ query, params: {} }, res);
    assert.equal(res.code, 400);
  }
});

test("request logs include correlation, validation status and unexpected failures without request secrets", async (t) => {
  const info = t.mock.method(console, "log", () => {});
  const warn = t.mock.method(console, "warn", () => {});
  const errors = t.mock.method(console, "error", () => {});
  const { controller } = fixture();
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await controller.list(
    { query: {}, headers: { authorization: "secret-token" } },
    res,
  );
  assert.equal(res.statusCode, 400);
  const started = info.mock.calls[0].arguments[0],
    rejected = warn.mock.calls[0].arguments[0];
  const id = started.match(/requestId: '([^']+)'/)[1];
  assert.ok(rejected.includes(id));
  assert.match(rejected, /status: 400/);
  assert.match(rejected, /elapsedMs:/);
  controller.listPasses.execute = async () => {
    throw new Error("database unavailable");
  };
  await assert.rejects(
    controller.list({ query: { stationUuid: "station-uuid" } }, res),
    /database unavailable/,
  );
  assert.match(errors.mock.calls[0].arguments[0], /Request failed/);
  assert.match(errors.mock.calls[0].arguments[0], /status: 500/);
  assert.ok(
    ![...info.mock.calls, ...warn.mock.calls, ...errors.mock.calls].some((c) =>
      c.arguments[0].includes("secret-token"),
    ),
  );
});

test("controller rejects invalid pagination before use case execution", async () => {
  for (const query of [
    { page: "0" },
    { page: "-1" },
    { page: "1.5" },
    { page: "Infinity" },
    { page: "" },
    { page: ["1", "2"] },
    { page: "9007199254740992" },
    { page: "2147483647", limit: "100" },
    { limit: "0" },
    { limit: "101" },
    { limit: "2.5" },
    { limit: "" },
    { limit: { value: "10" } },
  ]) {
    const { controller } = fixture();
    controller.listPasses.execute = async () =>
      assert.fail("invalid pagination reached use case");
    const res = response();
    await controller.list(
      { query: { stationUuid: station.uuid, ...query } },
      res,
    );
    assert.equal(res.code, 400, JSON.stringify(query));
  }
});

test("controller and use case forward page/limit and return pagination metadata", async () => {
  const { controller, usecase, calls } = fixture();
  controller.listPasses = usecase;
  const res = response();
  await controller.list(
    { query: { stationUuid: station.uuid, page: "3", limit: "5" } },
    res,
  );
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.pagination, {
    page: 3,
    limit: 5,
    total: 0,
    totalPages: 0,
  });
  assert.equal(calls.at(-1)[1].page, 3);
  assert.equal(calls.at(-1)[1].limit, 5);
  assert.equal(calls.at(-1)[1].satelliteDisplayName, undefined);
});

test("repository applies optional case-insensitive name filtering to count and page before global AOS pagination", async (t) => {
  const prismaModule = require("../src/lib/prisma");
  const original = prismaModule.prisma;
  const {
    PrismaPassRepository,
  } = require("../src/modules/passes/repositories/PrismaPassRepository");
  let countQuery, rowsQuery;
  prismaModule.prisma = {
    satellitePass: {
      count: (query) => {
        countQuery = query;
        return Promise.resolve(35);
      },
      findMany: (query) => {
        rowsQuery = query;
        return Promise.resolve([]);
      },
    },
    $transaction: async (queries, options) => {
      assert.equal(options.isolationLevel, "RepeatableRead");
      return Promise.all(queries);
    },
  };
  t.after(() => {
    prismaModule.prisma = original;
  });
  const query = {
    generationId: "g",
    stationUuid: station.uuid,
    start,
    end,
    minElevation: 20,
    satelliteNoradId: 28492,
    page: 5,
    limit: 10,
  };
  for (const satelliteDisplayName of [undefined, "eLiOs"]) {
    const result = await new PrismaPassRepository().findAll({ ...query, satelliteDisplayName });
    assert.deepEqual(result, {
      passes: [],
      pagination: { page: 5, limit: 10, total: 35, totalPages: 4 },
    });
    assert.deepEqual(rowsQuery.where, countQuery.where);
    assert.deepEqual(rowsQuery.where, {
      generation_id: "g",
      station_uuid: station.uuid,
      generation: { job: { status: "completed" } },
      aos: { gte: start, lt: end },
      max_elevation: { gte: 20 },
      satellite_norad_id: 28492,
      satellite_name: { contains: satelliteDisplayName, mode: "insensitive" },
    });
    assert.deepEqual(rowsQuery.orderBy, [
      { aos: "asc" },
      { satellite_norad_id: "asc" },
      { id: "asc" },
    ]);
    assert.equal(rowsQuery.skip, 40);
    assert.equal(rowsQuery.take, 10);
  }
});

test("bulk repository combines satellites into bounded writes and awaits database backpressure", async (t) => {
  const module = require("../src/lib/prisma");
  const original = module.prisma;
  const {
    PrismaPassRepository,
  } = require("../src/modules/passes/repositories/PrismaPassRepository");
  let release, writing;
  const blocked = new Promise((r) => (release = r)),
    entered = new Promise((r) => (writing = r));
  const calls = [];
  module.prisma = {
    satellitePass: {
      createMany: async ({ data }) => {
        calls.push(data);
        if (calls.length === 1) {
          writing();
          await blocked;
        }
        return { count: data.length };
      },
    },
  };
  t.after(() => {
    module.prisma = original;
  });
  const pass = {
    aos: start,
    los: end,
    maxElevation: 10,
    maxElevationAt: start,
  };
  const pending = new PrismaPassRepository().createBatch("g", station.uuid, [
    { satellite, passes: Array(300).fill(pass) },
    {
      satellite: { ...satellite, id: 13, noradId: 28493 },
      passes: Array(300).fill(pass),
    },
  ]);
  await entered;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 500);
  assert.equal(calls[0][299].satellite_id, 12);
  assert.equal(calls[0][300].satellite_id, 13);
  release();
  assert.equal(await pending, 600);
  assert.equal(calls[1].length, 100);
  assert.equal(calls[1][0].orbital_snapshot.noradId, 28493);
});
