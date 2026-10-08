require('ts-node/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RunJobSatelliteUpsert } = require('../src/modules/satellites/use-cases/RunJobSatelliteUpsert');
const { executeSatelliteJob } = require('../src/jobs/execute-satellite-job');
const { scheduleKey } = require('../src/jobs/schedule');
const { GetSatelliteUpsertJob } = require('../src/modules/satellites/use-cases/GetSatelliteUpsertJob');

function fixture() {
  const job = { id: 'job-1', status: 'running', downloaded: false };
  const events = [];
  const jobs = {
    createQueued: async () => job,
    findLatest: async () => job,
    markDownloaded: async () => { job.downloaded = true; events.push('downloaded'); },
    complete: async () => { job.status = 'completed'; events.push('completed'); },
    fail: async (_id, message) => { job.status = 'failed'; job.error_message = message; events.push('failed'); },
  };
  return { job, jobs, events };
}

test('API enqueues without running the import', async () => {
  const { job, jobs, events } = fixture();
  job.status = 'queued';
  const runner = new RunJobSatelliteUpsert(jobs);
  assert.equal(await runner.execute(), job);
  await new Promise(setImmediate);
  assert.equal(job.status, 'queued');
  assert.deepEqual(events, []);
});

test('does not launch synchronization when an active job exists', async () => {
  const { jobs } = fixture();
  jobs.createQueued = async () => null;
  let calls = 0;
  const runner = new RunJobSatelliteUpsert(jobs);
  assert.equal(await runner.execute(), null);
  await new Promise(setImmediate);
  assert.equal(calls, 0);
});

test('records download failure without claiming download succeeded', async () => {
  const { job, jobs } = fixture();
  await executeSatelliteJob(job.id, jobs, { execute: async () => { throw new Error('download failed'); } });
  assert.equal(job.status, 'failed');
  assert.equal(job.downloaded, false);
});

test('retains downloaded flag when persistence fails afterwards', async () => {
  const { job, jobs } = fixture();
  await executeSatelliteJob(job.id, jobs, {
    execute: async (onDownloaded) => { await onDownloaded(); throw new Error('database failed'); },
  });
  assert.equal(job.status, 'failed');
  assert.equal(job.downloaded, true);
});

test('GET use case returns the latest record or null without starting work', async () => {
  const { job, jobs } = fixture();
  const get = new GetSatelliteUpsertJob(jobs);
  assert.equal(await get.execute(), job);
  jobs.findLatest = async () => null;
  assert.equal(await get.execute(), null);
});

test('worker records download before completion', async () => {
  const { job, jobs, events } = fixture();
  await executeSatelliteJob(job.id, jobs, { execute: async (downloaded) => downloaded() });
  assert.deepEqual(events, ['downloaded', 'completed']);
  assert.equal(job.status, 'completed');
});

test('UTC schedule handles boundary, catch-up, and rejects malformed times', () => {
  assert.equal(scheduleKey(new Date('2026-10-08T01:59:59Z'), '02:00'), null);
  assert.equal(scheduleKey(new Date('2026-10-08T02:00:00Z'), '02:00'), '2026-10-08');
  assert.equal(scheduleKey(new Date('2026-10-08T23:59:00Z'), '02:00'), '2026-10-08');
  assert.equal(scheduleKey(new Date('2026-10-09T00:00:00Z'), '02:00'), null);
  for (const value of ['24:00', '12:60', 'bad']) {
    assert.throws(() => scheduleKey(new Date(), value), /HH:MM/);
  }
});
