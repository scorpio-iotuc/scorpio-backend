require('ts-node/register');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {CreatePasses}=require('../src/modules/passes/use-cases/CreatePasses');
const {predict}=require('../src/modules/passes/helpers/predict');
const station={uuid:'station',latitude:-33.497866,longitude:-70.615255,altitude:622};
const satellite={id:1,noradId:25544,displayName:'ISS',
  tle1:'1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992',
  tle2:'2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442'};
const task={satellite,station,start:Date.parse('2019-06-05T12:00:00Z'),end:Date.parse('2019-06-06T12:00:00Z')};

test('Piscina uses four actual threads, matches serial predictions, preserves dates and skips bad orbits',async()=>{
  const create=new CreatePasses({});
  const pool=create.pool;
  try{
    const results=await Promise.all(Array.from({length:4},()=>pool.run(task)));
    assert.equal(pool.client.pool.threads.length,4);
    const serial=await predict(satellite,station,task.start,task.end,0);
    assert.ok(serial.length>0);
    for(const result of results){assert.deepEqual(result.passes,serial);assert.equal(result.skipped,false);assert.ok(result.passes[0].aos instanceof Date);}
    assert.deepEqual(await pool.run({...task,satellite:{id:2,noradId:2}}),{passes:[],skipped:true});
    await assert.rejects(pool.run({...task,station:null}));
  }finally{await create.close();}
  assert.equal(pool.client.pool,undefined);
});
