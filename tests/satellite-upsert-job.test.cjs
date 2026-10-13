require('ts-node/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RunJobSatelliteUpsert } = require('../src/modules/satellites/use-cases/RunJobSatelliteUpsert');
const { executeSatelliteJob } = require('../src/jobs/upsert-satellite/execute-job');
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
  await executeSatelliteJob(job.id, jobs, { execute: async () => {} }, { streamActiveSatellites: async () => { throw new Error('download failed'); } });
  assert.equal(job.status, 'failed');
  assert.equal(job.downloaded, false);
});

test('retains downloaded flag when persistence fails afterwards', async () => {
  const { job, jobs } = fixture();
  await executeSatelliteJob(job.id, jobs, {
    execute: async () => { throw new Error('database failed'); },
  }, { streamActiveSatellites: async (save, downloaded) => { await downloaded(); await save([]); } });
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
  await executeSatelliteJob(job.id, jobs, { execute: async () => {} }, { streamActiveSatellites: async (_save, downloaded) => downloaded() });
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


test('notifies running and completed only after their corresponding transitions', async () => {
  const { job, jobs, events } = fixture();
  const notifications = {
    notify: async (message) => { events.push(message.includes('status=running') ? 'running-notice' : 'completed-notice'); },
    alert: async () => assert.fail('unexpected alert'),
  };
  await executeSatelliteJob(job.id, jobs, { execute: async () => {} }, {
    streamActiveSatellites: async (_save, downloaded) => downloaded(),
  }, notifications);
  assert.deepEqual(events, ['running-notice', 'downloaded', 'completed', 'completed-notice']);
});

test('alerts with the failure message after persisting failed status', async () => {
  const { job, jobs } = fixture();
  const alerts = [];
  await executeSatelliteJob(job.id, jobs, { execute: async () => {} }, {
    streamActiveSatellites: async () => { throw new Error('download unavailable'); },
  }, {
    notify: async () => {},
    alert: async (message) => { assert.equal(job.status, 'failed'); alerts.push(message); },
  });
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /job-1.*status=failed.*download unavailable/);
});

test('notification failures cannot fail a successful import or escape a failed import', async () => {
  for (const failImport of [false, true]) {
    const { job, jobs } = fixture();
    const notifications = {
      notify: async () => { throw new Error('Discord down'); },
      alert: async () => { throw new Error('Discord down'); },
    };
    await executeSatelliteJob(job.id, jobs, { execute: async () => {} }, {
      streamActiveSatellites: async () => { if (failImport) throw new Error('Import down'); },
    }, notifications);
    assert.equal(job.status, failImport ? 'failed' : 'completed');
  }
});

test('long failure messages are truncated for Discord delivery', async () => {
  const { job, jobs } = fixture();
  await executeSatelliteJob(job.id, jobs, { execute: async () => {} }, {
    streamActiveSatellites: async () => { throw new Error('x'.repeat(3000)); },
  }, {
    notify: async () => {},
    alert: async (message) => { assert.equal(message.length, 1900); assert.ok(message.endsWith('...')); },
  });
});
