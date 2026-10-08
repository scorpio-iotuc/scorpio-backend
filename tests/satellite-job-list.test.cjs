require('ts-node/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SatelliteController } = require('../src/modules/satellites/controllers/SatelliteController');

function fixture() {
  const calls = [];
  const records = [{ id: 'job-1', status: 'completed' }];
  const controller = new SatelliteController({}, {
    findAll: async query => { calls.push(query); return records; },
  });
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  return { controller, res, calls, records };
}

test('job list controller initializes use case and forwards pagination/status', async () => {
  const { controller, res, calls, records } = fixture();
  await controller.listJobs({query:{page:'2',limit:'10',status:'completed'}},res);
  assert.equal(res.code,200);
  assert.equal(res.body,records);
  assert.deepEqual(calls,[{page:2,limit:10,status:'completed',downloaded:undefined}]);
});

test('job list defaults to the first page', async () => {
  const {controller,res,calls}=fixture();
  await controller.listJobs({query:{}},res);
  assert.deepEqual(calls,[{page:1,limit:20,status:undefined,downloaded:undefined}]);
});

test('job list rejects invalid pagination and status before repository access', async () => {
  for (const query of [{page:'1.5'}, {page:'Infinity'}, {page:'0'}, {limit:'2.5'}, {limit:'101'}, {status:'unknown'}, {page:['1','2']}]) {
    const {controller,res,calls}=fixture();
    await controller.listJobs({query},res);
    assert.equal(res.code,400);
    assert.equal(calls.length,0);
  }
});


test('job list parses both downloaded boolean values', async () => {
  for (const value of ['true', 'false']) {
    const {controller,res,calls}=fixture();
    await controller.listJobs({query:{downloaded:value}},res);
    assert.equal(res.code,200);
    assert.equal(calls[0].downloaded,value === 'true');
  }
});

test('job list rejects invalid or repeated downloaded values', async () => {
  for (const value of ['', '0', '1', 'TRUE', 'yes', ['true', 'false'], {value:'true'}]) {
    const {controller,res,calls}=fixture();
    await controller.listJobs({query:{downloaded:value}},res);
    assert.equal(res.code,400);
    assert.equal(calls.length,0);
  }
});
