require("ts-node/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { JobQueue } = require("../src/jobs/queue");

function fixture() {
  const tx = {};
  let inTransaction = false;
  const db = {
    $transaction: async (fn) => {
      assert.equal(inTransaction, false);
      inTransaction = true;
      try {
        return await fn(tx);
      } finally {
        inTransaction = false;
      }
    },
  };
  const job = (kind) => {
    const rows = [];
    let scheduled = false;
    return {
      kind,
      name: `Test ${kind}`,
      rows,
      schedule: async (context, now) => {
        assert.equal(context, db);
        if (scheduled) return null;
        scheduled = true;
        const row = { id: kind, createdAt: now, status: "queued" };
        rows.push(row);
        return row;
      },
      hasRunning: async (context) => {
        assert.equal(context, tx);
        return rows.some((r) => r.status === "running");
      },
      peekQueued: async () => rows.find((r) => r.status === "queued") ?? null,
      claim: async (context, id) => {
        assert.equal(context, tx);
        const row = rows.find((r) => r.id === id && r.status === "queued");
        if (!row) return false;
        row.status = "running";
        return true;
      },
      execute: async (context, id) => {
        assert.equal(context, db);
        assert.equal(inTransaction, false, "execution must start after commit");
        const row = rows.find((r) => r.id === id);
        assert.equal(row.status, "running");
        row.status = "completed";
      },
      recover: async (context) => {
        assert.equal(context, tx);
        const running = rows.filter((r) => r.status === "running");
        running.forEach((r) => (r.status = "failed"));
        return running.length;
      },
    };
  };
  return { db, job };
}

test("an additional job participates in scheduling, exclusion, ordering and execution without queue changes", async () => {
  const { db, job } = fixture();
  const first = job("first"),
    second = job("second"),
    third = job("third");
  const queue = new JobQueue([first, second, third], db);
  const now = new Date("2026-10-22T12:00:00Z");
  first.rows.push({ id: "active", createdAt: now, status: "running" });
  assert.equal((await queue.schedule(now)).length, 3);
  assert.deepEqual(await queue.schedule(now), []);
  assert.equal(await queue.claimNext(now), null);
  assert.equal(third.rows[0].status, "queued");
  first.rows[0].status = "completed";
  third.rows[0].createdAt = new Date(now.getTime() - 1000);
  const next = await queue.claimNext(now);
  assert.equal(next.kind, "third");
  assert.equal(next.id, "third");
  assert.equal(
    await queue.claimNext(now),
    null,
    "third job blocks all other jobs",
  );
  await next.execute();
  assert.equal(third.rows[0].status, "completed");
  const tied = await queue.claimNext(now);
  assert.equal(tied.kind, "first", "registration order breaks timestamp ties");
  await tied.execute();
  assert.equal((await queue.claimNext(now)).kind, "second");
});

test("recovery reaches every registered job and preserves queued jobs", async () => {
  const { db, job } = fixture();
  const jobs = ["one", "two", "three"].map(job);
  for (const handler of jobs)
    handler.rows.push({ status: "running" }, { status: "queued" });
  const queue = new JobQueue(jobs, db);
  assert.equal(await queue.recover(), 3);
  for (const handler of jobs)
    assert.deepEqual(
      handler.rows.map((r) => r.status),
      ["failed", "queued"],
    );
});

test("optional startup hooks enqueue through the same interface", async () => {
  const { db, job } = fixture();
  const one = job("one"),
    two = job("two");
  two.onStartup = two.schedule;
  const queue = new JobQueue([one, two], db);
  assert.deepEqual(await queue.onStartup(new Date()), [
    { id: "two", name: "Test two" },
  ]);
  assert.equal(one.rows.length, 0);
});

test("failed conditional claim cannot execute a stale queue candidate", async () => {
  const { db, job } = fixture();
  const handler = job("stale");
  const queue = new JobQueue([handler], db);
  await queue.schedule(new Date());
  handler.claim = async () => false;
  assert.equal(await queue.claimNext(new Date()), null);
});

test("execution errors propagate to the coordinator for persistence failure recovery", async () => {
  const { db, job } = fixture();
  const handler = job("broken");
  handler.execute = async () => {
    throw new Error("Cannot persist job status");
  };
  const queue = new JobQueue([handler], db);
  await queue.schedule(new Date());
  const next = await queue.claimNext(new Date());
  await assert.rejects(next.execute(), /Cannot persist job status/);
  assert.equal(await queue.claimNext(new Date()), null);
  assert.equal(await queue.recover(), 1);
});

test("duplicate kinds are rejected and an empty registry is idle", async () => {
  const { db, job } = fixture();
  assert.throws(
    () => new JobQueue([job("same"), job("same")], db),
    /unique kind/,
  );
  const queue = new JobQueue([], db);
  assert.deepEqual(await queue.schedule(new Date()), []);
  assert.equal(await queue.claimNext(new Date()), null);
  assert.equal(await queue.recover(), 0);
});
