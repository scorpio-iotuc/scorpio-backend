require('ts-node/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RunJobSatelliteUpsert } = require('../src/modules/satellites/use-cases/RunJobSatelliteUpsert');
const { GetSatelliteUpsertJob } = require('../src/modules/satellites/use-cases/GetSatelliteUpsertJob');

function fixture() {
  const job = { id: 'job-1', status: 'running', downloaded: false };
  const events = [];
  const jobs = {
    createRunning: async () => job,
    findLatest: async () => job,
    markDownloaded: async () => { job.downloaded = true; events.push('downloaded'); },
    complete: async () => { job.status = 'completed'; events.push('completed'); },
    fail: async (_id, message) => { job.status = 'failed'; job.error_message = message; events.push('failed'); },
  };
  return { job, jobs, events };
}

test('accepts before synchronization finishes and records completion afterwards', async () => {
  const { job, jobs, events } = fixture();
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const runner = new RunJobSatelliteUpsert(jobs, {
    execute: async (onDownloaded) => { await pending; await onDownloaded(); },
  });
  assert.equal(await runner.execute(), job);
  await new Promise(setImmediate);
  assert.equal(job.status, 'running');
  assert.deepEqual(events, []);
  finish();
  await new Promise(setImmediate);
  assert.deepEqual(events, ['downloaded', 'completed']);
});

test('does not launch synchronization when an active job exists', async () => {
  const { jobs } = fixture();
  jobs.createRunning = async () => null;
  let calls = 0;
  const runner = new RunJobSatelliteUpsert(jobs, { execute: async () => { calls++; } });
  assert.equal(await runner.execute(), null);
  await new Promise(setImmediate);
  assert.equal(calls, 0);
});

test('records download failure without claiming download succeeded', async () => {
  const { job, jobs } = fixture();
  const runner = new RunJobSatelliteUpsert(jobs, { execute: async () => { throw new Error('download failed'); } });
  await runner.runJobSatelliteUpsert(job.id);
  assert.equal(job.status, 'failed');
  assert.equal(job.downloaded, false);
});

test('retains downloaded flag when persistence fails afterwards', async () => {
  const { job, jobs } = fixture();
  const runner = new RunJobSatelliteUpsert(jobs, {
    execute: async (onDownloaded) => { await onDownloaded(); throw new Error('database failed'); },
  });
  await runner.runJobSatelliteUpsert(job.id);
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
