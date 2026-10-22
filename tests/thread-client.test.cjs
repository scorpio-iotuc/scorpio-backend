require("ts-node/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { ThreadClient } = require("../src/lib/thread-client/main");
const options = {
  provider: "piscina",
  workerFile: path.join(__dirname, "fixtures/thread-client-worker.cjs"),
  threads: 2,
  maxQueuedTasks: 10,
};

test("generic thread client executes unrelated tasks, preserves data and propagates worker errors", async () => {
  const client = new ThreadClient(options);
  try {
    const date = new Date("2026-10-22T12:00:00Z");
    assert.deepEqual(
      await client.run({ value: { date, numbers: [1, 2, 3] } }),
      { value: { date, numbers: [1, 2, 3] }, isMainThread: false },
    );
    await assert.rejects(client.run({ fail: true }), /Task failed/);
    assert.deepEqual(await client.run({ value: "still usable" }), {
      value: "still usable",
      isMainThread: false,
    });
  } finally {
    await client.destroy();
  }
  await client.destroy();
  await assert.rejects(client.run({ value: "after shutdown" }), /destroyed/);
});

test("destroying an unused client is safe and prevents creating threads later", async () => {
  const client = new ThreadClient(options);
  await Promise.all([client.destroy(), client.destroy()]);
  await assert.rejects(client.run({ value: 1 }), /destroyed/);
});

test("provider and configuration validation fail before spawning workers", () => {
  for (const provider of ["unsupported", "toString", "__proto__"]) {
    assert.throws(
      () => new ThreadClient({ ...options, provider }),
      /Unsupported thread provider/,
    );
  }
  for (const invalid of [
    { threads: 0 },
    { threads: 1.5 },
    { maxQueuedTasks: -1 },
    { heapLimitMb: 0 },
    { workerFile: "" },
  ]) {
    assert.throws(
      () => new ThreadClient({ ...options, ...invalid }),
      /Invalid thread client configuration/,
    );
  }
});
