require('ts-node/register');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JobQueue}=require('../src/jobs/queue');
const {executeStationPassJob}=require('../src/jobs/create-station-passes/execute-job');

function queueFixture() {
  const satellites=[],passes=[],events=[];
  const model=(rows,kind)=>({
    findUnique:async({where})=>rows.find(r=>r.schedule_key===where.schedule_key)??null,
    findFirst:async({where})=>rows.filter(r=>r.status===where.status).sort((a,b)=>(a.created??a.created_at)-(b.created??b.created_at))[0]??null,
    create:async({data})=>{const r={id:`${kind}-${rows.length}`,created:new Date('2026-10-21T12:00:00Z'),created_at:new Date('2026-10-21T12:00:00Z'),...data};rows.push(r);return r;},
    updateMany:async({where,data})=>{let count=0;for(const row of rows){if((!where.id||row.id===where.id)&&row.status===where.status){Object.assign(row,data);count++;}}return {count};},
  });
  const db={satelliteUpsertJob:model(satellites,'satellite'),stationPassJob:model(passes,'passes'),
    stationPassGeneration:{deleteMany:async query=>{events.push(query);return {count:0};}}};
  db.$transaction=async fn=>fn(db);
  return {queue:new JobQueue(db),satellites,passes,events};
}

test('pass schedule queues once per UTC day at noon, including while upsert is running',async()=>{
  const {queue,satellites,passes}=queueFixture();
  satellites.push({id:'active',status:'running',schedule_key:'2026-10-21',created:new Date('2026-10-21T00:00:00Z')});
  await queue.schedule(new Date('2026-10-21T11:59:59Z'),'00:00',72);assert.equal(passes.length,0);
  const created=await queue.schedule(new Date('2026-10-21T12:00:00Z'),'00:00',72);
  assert.equal(created.length,1);assert.equal(passes[0].status,'queued');
  assert.equal(await queue.claimNext(new Date('2026-10-21T12:05:00Z')),null);
  assert.equal(passes[0].status,'queued');
  await queue.schedule(new Date('2026-10-21T23:00:00Z'),'00:00',72);assert.equal(passes.length,1);
  satellites[0].status='completed';
  const next=await queue.claimNext(new Date('2026-10-21T15:00:00Z'));
  assert.equal(next.kind,'passes');assert.equal(passes[0].status,'running');
  assert.equal(next.job.window_start.toISOString(),'2026-10-21T15:00:00.000Z');
  assert.equal(next.job.window_end.toISOString(),'2026-10-24T15:00:00.000Z');
});

test('running prediction blocks upsert and another pass job, preserving queued status',async()=>{
  const {queue,satellites,passes}=queueFixture();
  passes.push({id:'active',status:'running'},{id:'waiting',status:'queued'});
  satellites.push({id:'satellite',status:'queued'});
  assert.equal(await queue.claimNext(new Date()),null);
  assert.equal(passes[1].status,'queued');assert.equal(satellites[0].status,'queued');
});

test('oldest queued job wins across types; recovery fails only running jobs and removes staging',async()=>{
  const {queue,satellites,passes,events}=queueFixture();
  satellites.push({id:'s',status:'queued',created:new Date('2026-10-21T13:00:00Z')});
  passes.push({id:'p',status:'queued',created_at:new Date('2026-10-21T12:00:00Z'),window_hours:72});
  assert.equal((await queue.claimNext(new Date())).kind,'passes');
  assert.equal(await queue.recover(),1);
  assert.equal(passes[0].status,'failed');assert.equal(satellites[0].status,'queued');
  assert.equal(events.length,1);
});

function executionFixture({failure=false,notifyFailure=false,stationCount=1}={}) {
  const events=[];
  const now=new Date('2026-10-21T12:00:00Z');
  const job={id:'job',window_hours:72,window_start:now,window_end:new Date('2026-10-24T12:00:00Z')};
  const jobs={progress:async(id,generated,skipped)=>events.push(['progress',generated,skipped]),
    complete:async()=>events.push(['completed']),fail:async()=>events.push(['failed'])};
  const stations={findAll:async({page,limit})=>{
    events.push(['page',page]);return Array.from({length:Math.max(0,Math.min(limit,stationCount-(page-1)*limit))},(_,i)=>({uuid:`station-${(page-1)*limit+i}`}));
  }};
  const passes={deleteExpired:async date=>{assert.equal(date,now);events.push(['cleanup']);return 2;}};
  const create={execute:async()=>{events.push(['predict']);if(failure)throw new Error('prediction failed');return {generated:2,skipped:1};}};
  const notifications={notify:async message=>{events.push(['notify',message]);if(notifyFailure)throw new Error('Discord unavailable');},
    alert:async message=>events.push(['alert',message])};
  return {events,job,run:()=>executeStationPassJob(job,jobs,stations,passes,create,notifications,()=>now)};
}

test('worker cleans expired passes and publishes only after every station page; notifications follow persisted state',async()=>{
  const {events,run}=executionFixture({stationCount:101});await run();
  assert.equal(events[0][0],'notify');assert.match(events[0][1],/status=running/);
  assert.equal(events[1][0],'cleanup');
  assert.equal(events.filter(e=>e[0]==='predict').length,101);
  assert.deepEqual(events.filter(e=>e[0]==='page'),[['page',1],['page',2]]);
  assert.deepEqual(events.filter(e=>e[0]==='progress').at(-1),['progress',202,101]);
  assert.deepEqual(events.slice(-3).map(e=>e[0]),['cleanup','completed','notify']);
  assert.match(events.at(-1)[1],/status=completed/);
});

test('failure persists failed status before alerting and never publishes partial results',async()=>{
  const {events,run}=executionFixture({failure:true});await run();
  assert.ok(!events.some(e=>e[0]==='completed'));
  assert.deepEqual(events.slice(-2).map(e=>e[0]),['failed','alert']);
});

test('notification failure cannot fail a successful pass job',async()=>{
  const {events,run}=executionFixture({notifyFailure:true});await run();
  assert.ok(events.some(e=>e[0]==='completed'));assert.ok(!events.some(e=>e[0]==='failed'));
});

test('job refuses to publish when runtime has exhausted next-24h coverage',async()=>{
  const {events,job,run}=executionFixture();job.window_end=new Date('2026-10-22T11:59:59Z');await run();
  assert.ok(events.some(e=>e[0]==='failed'));assert.ok(!events.some(e=>e[0]==='completed'));
});

test('wait logs are emitted once per blocking-job transition, not once per poll',async(t)=>{
  const out=t.mock.method(console,'log',()=>{});
  const {queue,passes}=queueFixture();
  passes.push({id:'waiting-pass',status:'queued',created_at:new Date()});
  const active={id:'upsert-1',kind:'satellite'};
  await queue.reportWaiting(active);
  await queue.reportWaiting(active);
  let messages=out.mock.calls.map(c=>c.arguments[0]).filter(s=>s.includes('Job waiting'));
  assert.equal(messages.length,1);
  assert.match(messages[0],/waiting-pass/);assert.match(messages[0],/upsert-1/);
  await queue.reportWaiting({id:'upsert-2',kind:'satellite'});
  assert.equal(out.mock.calls.filter(c=>c.arguments[0].includes('Job waiting')).length,2);
  await queue.reportWaiting(null);
  await queue.reportWaiting(active);
  assert.equal(out.mock.calls.filter(c=>c.arguments[0].includes('Job waiting')).length,3);
});
