require('ts-node/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { importCsv, FetchCelesTrakClient } = require('../src/jobs/upsert-satellite/clients/CelesTrakClient');
const { requiredColumns, mapRow } = require('../src/jobs/upsert-satellite/clients/map-row');
const { UpsertSatellites } = require('../src/modules/satellites/use-cases/UpsertSatellites');
const header = requiredColumns.join(',') + '\r\n';
const record = (id) => `${id},"GPS, \"\"test\"\"",2000-040A,2026-09-16T04:02:29.626080,2.00558423,.01181404,54.8385,211.5512,303.8515,151.4150,0,.23E-6,-.6E-7\r\n`;

test('parses split CSV chunks and quotes; saves 100/100/5 rows sequentially', async () => {
  const csv = '\ufeff' + header + Array.from({length: 205}, (_, i) => record(i+1)).join('');
  const bytes = Buffer.from(csv);
  const source = Readable.from((function* () { for(let i=0;i<bytes.length;i+=7) yield bytes.subarray(i,i+7); })());
  const sizes = []; let first; let active=0; let downloaded=false;
  await importCsv(source, async batch => {
    assert.equal(++active,1); first ??= batch[0]; sizes.push(batch.length);
    await new Promise(setImmediate); active--;
  }, async () => { downloaded=true; });
  assert.deepEqual(sizes,[100,100,5]); assert.equal(downloaded,true);
  assert.equal(first.displayName,'GPS, "test"');
  assert.equal(first.epoch.toISOString(),'2026-09-16T04:02:29.626Z');
  assert.equal(first.meanMotionDot,2.3e-7); assert.equal(first.tle1,null);
});

test('a blocked database write stops consumption before the full catalog is read', async () => {
  let produced=0, writes=0, release, entered;
  const gate = new Promise(r=>release=r);
  const started = new Promise(r=>entered=r);
  const source = Readable.from((async function* () {
    yield header;
    for(let i=1;i<=5000;i++) { produced++; yield record(i); }
  })(), { highWaterMark: 1 });
  const done = importCsv(source, async () => { writes++; if(writes===1) { entered(); await gate; } }, async()=>{});
  await started;
  await new Promise(r=>setTimeout(r,30));
  assert.equal(writes,1); assert.ok(produced<5000, `Read entire catalog: ${produced}`);
  release(); await done; assert.equal(writes,50);
});

test('write failure cancels input without marking download complete', async () => {
  const source = Readable.from(header + Array.from({length: 201}, (_,i)=>record(i+1)).join(''));
  let downloaded=false;
  await assert.rejects(importCsv(source, async()=>{throw new Error('db failed');}, async()=>{downloaded=true;}), /db failed/);
  assert.equal(source.destroyed,true); assert.equal(downloaded,false);
});

test('rejects missing headers, empty catalogs, malformed CSV and invalid fields', async () => {
  for(const csv of ['<html>error</html>', header, header+'1,"unclosed']) {
    await assert.rejects(importCsv(Readable.from(csv), async()=>{}, async()=>{}));
  }
  for(const overrides of [{NORAD_CAT_ID:'1.5'}, {NORAD_CAT_ID:''}, {MEAN_MOTION:'Infinity'}, {EPOCH:'bad'}]) {
    assert.throws(()=>mapRow({NORAD_CAT_ID:'1',OBJECT_NAME:'GPS',...overrides}));
  }
});

test('aborting a stream fails the import', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(importCsv(Readable.from(header+record(1)), async()=>{},async()=>{},controller.signal), /abort/i);
});

test('client requests CSV and cancels unsuccessful HTTP responses', async () => {
  let cancelled=false;
  const client = new FetchCelesTrakClient(async url => {
    assert.match(url,/FORMAT=CSV/);
    return {ok:false,status:503,body:{cancel:async()=>{cancelled=true;}}};
  });
  await assert.rejects(client.streamActiveSatellites(async()=>{},async()=>{}), /503/);
  assert.equal(cancelled,true);
});

test('upsert use case only passes a batch to its repository', async () => {
  const batch=[{noradId:1}]; const result={downloaded:1,created:1,updated:0};
  const useCase=new UpsertSatellites({upsertMany:async input=>{assert.equal(input,batch);return result;}});
  assert.equal(await useCase.execute(batch),result);
});
