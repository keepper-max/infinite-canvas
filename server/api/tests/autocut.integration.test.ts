import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { probeMedia, selectKeyframeTimes } from "../src/autocut/media.js";
import { createHash, randomUUID } from "node:crypto";
import { createDatabase } from "../src/db/client.js";
import { applyMigrations } from "../src/db/migrate.js";
import { AutoCutService } from "../src/autocut/service.js";
import { ManagedAutoCutModel } from "../src/autocut/model.js";
import { fixture } from "./fixtures/autocut.js";
import { JobService } from "../src/job-service.js";
import { CreditService } from "../src/credit-service.js";
import { BillingService } from "../src/billing-service.js";
import { readConfig } from "../src/config.js";
import { recoverAutoCutTasks } from "../src/autocut/maintenance.js";
import { AutoCutExecutor } from "../src/autocut/executor.js";
const databaseUrl = process.env.TEST_DATABASE_URL;
test(
  "AutoCut PostgreSQL: ownership, persistence, version conflicts, concurrency, retries and budget gate",
  { skip: !databaseUrl },
  async () => {
    const { pool } = createDatabase(databaseUrl!);
    try {
      await applyMigrations(pool);
      const actor = randomUUID(),
        other = randomUUID(),
        workspace = randomUUID();
      await pool.query(
        "insert into users(id,email,is_admin) values($1,$2,true),($3,$4,false)",
        [
          actor,
          `autocut-${actor}@example.test`,
          other,
          `autocut-${other}@example.test`,
        ],
      );
      await pool.query(
        "insert into projects(id,owner_id,name) values($1,$2,'AutoCut test')",
        [workspace, actor],
      );
      await pool.query(
        "insert into project_members(project_id,user_id,role) values($1,$2,'owner'),($1,$3,'editor')",
        [workspace, actor, other],
      );
      const { asset, info, t } = fixture();
      await pool.query(
        "insert into assets(id,project_id,kind,name,created_by) values($1,$2,'video','input.mp4',$3)",
        [asset.assetId, workspace, actor],
      );
      await pool.query(
        "insert into asset_versions(id,asset_id,version,storage_key,mime_type,bytes,sha256,source,created_by) values($1,$2,1,$3,'video/mp4',1,$4,'upload',$5)",
        [
          asset.id,
          asset.assetId,
          `test-source-${asset.id}`,
          "0".repeat(64),
          actor,
        ],
      );
      const queue = {
        add: async (_: string) => undefined,
        remove: async (_: string) => true,
      };
      const service = new AutoCutService(pool, queue, true, "test-timebucket-v2");
      const project = await service.create(workspace, actor, {
        name: "自动剪辑",
        assetVersionIds: [asset.id],
      });
      await assert.rejects(
        service.start(project.id, actor, {
          operationId: randomUUID(),
          expectedRevision: null,
          kind: "edit",
          scope: "subtitles",
          mode: "auto",
          prompt: "只改字幕",
          targetDurationMs: 3000,
          aspectRatio: "16:9",
          budgetCents: 100,
          confirmed: true,
        }),
        /先生成/,
      );
      assert.equal(
        (
          await pool.query(
            "select count(*)::int n from autocut_tasks where project_id=$1",
            [project.id],
          )
        ).rows[0].n,
        0,
      );
      await assert.rejects(service.get(project.id, other), /不存在或无权/);
      await assert.rejects(
        service.create(workspace, actor, {
          name: "错误引用",
          assetVersionIds: [randomUUID()],
        }),
        /素材不可用/,
      );
      await pool.query(
        "insert into autocut_analyses(asset_version_id,analyzer_version,document) values($1,'test-v1',$2)",
        [asset.id, info],
      );
      t.project_id = project.id;
      const saved = await service.save(project.id, actor, null, t);
      assert.notEqual(saved.revision_id, t.revision_id);
      assert.equal(
        (await service.get(project.id, actor)).timeline.revision_id,
        saved.revision_id,
      );
      await assert.rejects(
        service.save(project.id, actor, null, t),
        /刷新后重试/,
      );
      const input = {
        operationId: randomUUID(),
        expectedRevision: saved.revision_id,
        kind: "render",
        mode: "auto",
        prompt: "",
        targetDurationMs: 3000,
        aspectRatio: "16:9",
        budgetCents: 0,
        confirmed: true,
      };
      const highBudget = await service.start(project.id, actor, { ...input, operationId: randomUUID(), budgetCents: 10000 });
      assert.equal(highBudget.budget_cents, 10000);
      await service.cancel(project.id, highBudget.id, actor);
      const spare = await Promise.all([0,1,2].map(n => service.create(workspace, actor, {name:`admission-${n}`,assetVersionIds:[asset.id]})));
      const submit = { ...input, expectedRevision:null, kind:"edit" };
      const results = await Promise.allSettled(spare.map(p => service.start(p.id, actor, {...submit,operationId:randomUUID()})));
      assert.equal(results.filter(r => r.status==="fulfilled").length,2);
      assert.equal(results.filter(r => r.status==="rejected").length,1);
      const queued = results.flatMap(r => r.status==="fulfilled"?[r.value]:[]);
      const first = queued[0];
      assert.equal((await service.start(first.project_id,actor,{...submit,operationId:first.operation_id})).id,first.id);
      const priorSetting = (await pool.query("select value from platform_settings where key='autocut_admission'")).rows[0];
      try {
        await pool.query("insert into platform_settings(key,value) values('autocut_admission',$1) on conflict(key) do update set value=excluded.value",[{accepting:false}]);
        assert.equal(await service.acceptingTasks(),false);
        for (const q of queued) await service.cancel(q.project_id,q.id,actor);
        await assert.rejects(service.retry(first.project_id,first.id,actor),/暂停接收/);
        await assert.rejects(service.start(project.id,actor,{...input,operationId:randomUUID()}),/暂停接收/);
      } finally {
        await pool.query("insert into platform_settings(key,value) values('autocut_admission',$1) on conflict(key) do update set value=excluded.value",[priorSetting?.value || {accepting:true}]);
      }
      const load = [];
      for (let n=0;n<20;n++) {
        const p=await service.create(workspace,other,{name:`queue-load-${n}`,assetVersionIds:[asset.id]});
        const q=(await pool.query("insert into autocut_tasks(project_id,actor_id,operation_id,fingerprint,input,budget_cents) values($1,$2,$3,'fixture','{}',0) returning id",[p.id,other,randomUUID()])).rows[0];
        load.push({project:p.id,id:q.id});
      }
      await assert.rejects(service.start(project.id,actor,{...input,operationId:randomUUID()}),/待处理任务/);
      for (const q of load) await service.cancel(q.project,q.id,other);
      const task = await service.start(project.id, actor, input);
      assert.equal(task.input.plannerVersion, 3);
      assert.equal((await service.start(project.id, actor, input)).id, task.id);
      await assert.rejects(
        service.start(project.id, actor, { ...input, prompt: "changed" }),
        /操作编号/,
      );
      await assert.rejects(
        service.start(project.id, actor, {
          ...input,
          operationId: randomUUID(),
        }),
        /运行中的任务/,
      );
      await assert.rejects(
        service.save(project.id, actor, saved.revision_id, saved),
        /先停止/,
      );
      await service.cancel(project.id, task.id, actor);
      assert.equal(
        (await service.get(project.id, actor)).tasks[0].status,
        "cancelled",
      );
      await service.retry(project.id, task.id, actor);
      await pool.query(
        "update autocut_tasks set status='running' where id=$1",
        [task.id],
      );
      let called = false;
      const model = new ManagedAutoCutModel(
        pool,
        {
          create: async () => {
            called = true;
          },
        } as any,
        {
          modelId: "test",
          quoteCents: 12,
          maxOutputTokens: 2000,
          analysisVersion: "test-v1",
        },
      );
      await assert.rejects(
        model.complete(
          task.id,
          "test-call",
          "test",
          [],
          AbortSignal.timeout(1000),
        ),
        /预算不足/,
      );
      assert.equal(called, false);
      assert.equal(
        (
          await pool.query(
            "select count(*)::int as n from autocut_model_calls where task_id=$1",
            [task.id],
          )
        ).rows[0].n,
        0,
      );
      const lock = await pool.connect();
      await lock.query("select pg_advisory_lock(hashtextextended($1,0))", [
        `autocut:${task.id}`,
      ]);
      await recoverAutoCutTasks(
        pool,
        `H:/CodexStorage/autocut/poc/nonexistent-${randomUUID()}`,
      );
      assert.equal(
        (
          await pool.query("select status from autocut_tasks where id=$1", [
            task.id,
          ])
        ).rows[0].status,
        "running",
      );
      await lock.query("select pg_advisory_unlock(hashtextextended($1,0))", [
        `autocut:${task.id}`,
      ]);
      lock.release();
      await recoverAutoCutTasks(
        pool,
        `H:/CodexStorage/autocut/poc/nonexistent-${randomUUID()}`,
      );
      assert.equal(
        (
          await pool.query("select status from autocut_tasks where id=$1", [
            task.id,
          ])
        ).rows[0].status,
        "failed",
      );
      await pool.query("update autocut_tasks set status='failed' where id=$1", [
        task.id,
      ]);
      const restored = await service.restore(
        project.id,
        actor,
        saved.revision_id,
        saved.revision_id,
      );
      assert.notEqual(restored.revision_id, saved.revision_id);
      const config = readConfig({
        DATABASE_URL: databaseUrl!,
        OBJECT_STORAGE_ENDPOINT: "http://unused.test",
        OBJECT_STORAGE_BUCKET: "test",
        OBJECT_STORAGE_ACCESS_KEY_ID: randomUUID(),
        OBJECT_STORAGE_SECRET_ACCESS_KEY: randomUUID(),
      });
      const credits = new CreditService(pool);
      await credits.grant(
        actor,
        actor,
        {
          credits: 100,
          source: "promotion",
          note: "Isolated reservation test",
          idempotencyKey: randomUUID(),
        },
        randomUUID(),
      );
      const jobs = new JobService(
        pool,
        { add: async () => {}, remove: async () => true },
        {
          compile: async (input: unknown) => ({
            ...(input as object),
            providerId: "token360",
            upstreamModel: "fixture-text",
            upstreamParameters: {},
          }),
        } as any,
        config.jobs,
        undefined,
        credits,
        new BillingService(pool, config.provider, credits),
      );
      const jobInput = {
        modelId: "fixture-text",
        capability: "text" as const,
        mode: "chat" as const,
        nodeRevision: 0,
        prompt: "reservation test, no model execution",
        parameters: {},
        references: [],
        idempotencyKey: randomUUID(),
        trace: { workflowKind: "autocut" },
      };
      const held = await jobs.create(
        workspace,
        actor,
        jobInput,
        undefined,
        undefined,
        undefined,
        25,
      );
      assert.equal(held.creditsReserved, "25");
      const legacy = await jobs.create(workspace, actor, {
        ...jobInput,
        trace: undefined,
        idempotencyKey: randomUUID(),
      });
      assert.equal(legacy.creditsReserved, "1");
      await assert.rejects(
        jobs.create(
          workspace,
          actor,
          { ...jobInput, idempotencyKey: randomUUID() },
          undefined,
          undefined,
          undefined,
          1000,
        ),
        /积分余额不足/,
      );
      const oldProtocol = await service.start(project.id, actor, {
        ...input,
        operationId: randomUUID(),
        expectedRevision: restored.revision_id,
        kind: "edit",
        budgetCents: 100,
      });
      await pool.query(
        "update autocut_tasks set input=jsonb_set(input,'{plannerVersion}','2'::jsonb) where id=$1",
        [oldProtocol.id],
      );
      let downloaded = false,
        invoked = false;
      const executor = new AutoCutExecutor(
        pool,
        service,
        {
          openDownload: async () => {
            downloaded = true;
            throw Error("must not download");
          },
        } as any,
        {
          complete: async () => {
            invoked = true;
            throw Error("must not charge");
          },
        },
        "unused",
        "test-v1",
        {} as any,
      );
      await executor.execute(oldProtocol.id);
      assert.equal(
        (
          await pool.query("select error_code from autocut_tasks where id=$1", [
            oldProtocol.id,
          ])
        ).rows[0].error_code,
        "AUTOCUT_PLANNER_VERSION_CHANGED",
      );
      assert.equal(downloaded, false);
      assert.equal(invoked, false);
      assert.equal(
        (
          await pool.query(
            "select count(*)::int n from autocut_model_calls where task_id=$1",
            [oldProtocol.id],
          )
        ).rows[0].n,
        0,
      );
      await service.archive(project.id, actor);
      assert.ok(
        !(await service.list(workspace, actor)).some(
          (p) => p.id === project.id,
        ),
      );
      assert.equal(
        (
          await pool.query(
            "select count(*)::int n from asset_links where metadata->>'autocutProjectId'=$1",
            [project.id],
          )
        ).rows[0].n,
        0,
      );
      await pool.query(
        "update project_members set role='viewer' where project_id=$1 and user_id=$2",
        [workspace, actor],
      );
      await assert.rejects(
        service.save(project.id, actor, restored.revision_id, restored),
        /查看权限/,
      );
      await pool.query("update projects set deleted_at=now() where id=$1", [
        workspace,
      ]);
      await assert.rejects(service.get(project.id, actor), /无权访问/);
    } finally {
      await pool.end();
    }
  },
);


const samplingVersion = "fixture-timebucket-v2";
async function cacheFixture(pool: any) {
  await applyMigrations(pool);
  const actor = randomUUID(), workspace = randomUUID();
  await pool.query("insert into users(id,email,is_admin)values($1,$2,true)",[actor,`bucket-${actor}@example.test`]);
  await pool.query("insert into projects(id,owner_id,name)values($1,$2,'Timebucket QA')",[workspace,actor]);
  await pool.query("insert into project_members(project_id,user_id,role)values($1,$2,'owner')",[workspace,actor]);
  const {asset,t}=fixture();
  const source=await readFile(join(process.env.AUTOCUT_TEST_ROOT || "H:/CodexStorage/autocut/poc","video.mp4"));
  const ffmpeg=process.env.FFMPEG_PATH || "ffmpeg";
  const info=await probeMedia(ffmpeg,join(process.env.AUTOCUT_TEST_ROOT || "H:/CodexStorage/autocut/poc","video.mp4"),AbortSignal.timeout(30000));
  asset.storageKey=`qa-${asset.id}`;asset.bytes=source.length;asset.sha256=createHash("sha256").update(source).digest("hex");
  await pool.query("insert into assets(id,project_id,kind,name,created_by)values($1,$2,'video','fixture.mp4',$3)",[asset.assetId,workspace,actor]);
  await pool.query("insert into asset_versions(id,asset_id,version,storage_key,mime_type,bytes,sha256,source,created_by,width,height,duration_ms)values($1,$2,1,$3,'video/mp4',$4,$5,'upload',$6,$7,$8,$9)",[asset.id,asset.assetId,asset.storageKey,asset.bytes,asset.sha256,actor,info.width,info.height,info.durationMs]);
  const queue={add:async()=>{},remove:async()=>true};
  const service=new AutoCutService(pool,queue,true,samplingVersion);
  const project=await service.create(workspace,actor,{name:"Cache fixture",assetVersionIds:[asset.id]});
  t.project_id=project.id;
  const root=process.env.AUTOCUT_TEST_TEMP_ROOT || "H:/CodexStorage/autocut/timebucket-v11";
  await mkdir(root,{recursive:true});const temp=await mkdtemp(join(root,"executor-"));
  const outputs=new Map<string,Uint8Array>();let downloads=0;
  const storage={openDownload:async()=>{downloads++;return{bytes:source.length,body:new ReadableStream({start(c){c.enqueue(source);c.close()}})}},put:async(key:string,body:Uint8Array)=>{outputs.set(key,body)},delete:async()=>{}};
  const quota={reserve:async()=>{},release:async()=>{}};
  return {actor,workspace,asset,info,t,project,service,queue,source,ffmpeg,temp,storage,quota,outputs,downloads:()=>downloads};
}
const editInput = () => ({operationId:randomUUID(),expectedRevision:null,kind:"edit",mode:"auto",prompt:"fixture only",targetDurationMs:2000,aspectRatio:"16:9",budgetCents:100,confirmed:true});

test("Timebucket PostgreSQL cache isolation: reuse preprocess facts, never relabel legacy analysis or resubmit on version mismatch",
 {skip:!databaseUrl || !process.env.AUTOCUT_MEDIA_TEST},async()=>{
 const {pool}=createDatabase(databaseUrl!);
 try {
  const f=await cacheFixture(pool);
  const pre={...f.info,scenes:Array.from({length:21},(_,i)=>({start:Math.floor(i*f.info.durationMs/21),end:Math.floor((i+1)*f.info.durationMs/21)}))};
  const legacy={...pre,candidates:[{start:0,end:1000,summary:"legacy",evidence:"fixture",confidence:1}]};
  for(const [version,doc]of[["preprocess-v1",pre],["legacy-v1",legacy]])await pool.query("insert into autocut_analyses(asset_version_id,analyzer_version,document)values($1,$2,$3)",[f.asset.id,version,doc]);
  const before=(await pool.query("select * from autocut_analyses where asset_version_id=$1 order by analyzer_version",[f.asset.id])).rows;
  const seen:{key:string;times:number[];images:number}[]=[];
  const model={complete:async(_task:string,key:string,prompt:string,images:string[])=>{const input=JSON.parse(prompt);seen.push({key,times:input.keyframeTimes||[],images:images.length});return key==='plan-v3'?{clips:[{asset_index:0,source_in:0,source_out:2000}]}:{candidates:[{start:0,end:1000,summary:"new",evidence:"fixture",confidence:1}]}}};
  let asrCalls=0;
  const executor=new AutoCutExecutor(pool,f.service,f.storage as any,model,f.ffmpeg,samplingVersion,f.quota as any,{transcribe:async()=>{asrCalls++;throw Error('Cached ASR must be reused')}},f.temp);
  const old=await f.service.start(f.project.id,f.actor,editInput());
  await pool.query("update autocut_tasks set input=input-'analysisVersion'where id=$1",[old.id]);
  await executor.execute(old.id);
  assert.equal((await pool.query("select error_code from autocut_tasks where id=$1",[old.id])).rows[0].error_code,"AUTOCUT_ANALYSIS_VERSION_CHANGED");
  assert.equal(f.downloads(),0);assert.equal(seen.length,0);
  const input=editInput(),task=await f.service.start(f.project.id,f.actor,input);
  assert.equal(task.input.analysisVersion,samplingVersion);
  await executor.execute(task.id);
  const status=(await pool.query("select status,error_code from autocut_tasks where id=$1",[task.id])).rows[0];assert.equal(status.status,"completed",JSON.stringify(status));
  assert.equal(seen[0].images,20);assert.deepEqual(seen[0].times,selectKeyframeTimes(pre));assert.equal(asrCalls,0);
  assert.equal(seen.filter(x=>x.key.startsWith('analysis-')).length,1);
  assert.equal((await f.service.analyses(f.project,samplingVersion))[f.asset.id].candidates[0].summary,'new');
  assert.deepEqual((await f.service.analyses(f.project,'legacy-v1'))[f.asset.id],legacy);
  assert.deepEqual((await pool.query("select * from autocut_analyses where asset_version_id=$1 and analyzer_version<>$2 order by analyzer_version",[f.asset.id,samplingVersion])).rows,before);
  const nextService=new AutoCutService(pool,f.queue,true,'next-timebucket-v2');
  assert.equal((await nextService.start(f.project.id,f.actor,input)).id,task.id,'Request idempotency is independent of deployment version');
  const other=await f.service.create(f.workspace,f.actor,{name:'Cache reuse',assetVersionIds:[f.asset.id]});
  const reuse=await f.service.start(other.id,f.actor,editInput());await executor.execute(reuse.id);
  assert.equal((await pool.query("select status from autocut_tasks where id=$1",[reuse.id])).rows[0].status,'completed');
  assert.equal(seen.filter(x=>x.key.startsWith('analysis-')).length,1);
  const mismatchProject=await f.service.create(f.workspace,f.actor,{name:'Mismatch',assetVersionIds:[f.asset.id]});
  const mismatch=await f.service.start(mismatchProject.id,f.actor,editInput()),count=seen.length,downloads=f.downloads();
  const wrongWorker=new AutoCutExecutor(pool,f.service,f.storage as any,model,f.ffmpeg,'wrong-timebucket-v2',f.quota as any,undefined,f.temp);
  await wrongWorker.execute(mismatch.id);
  assert.equal((await pool.query("select error_code from autocut_tasks where id=$1",[mismatch.id])).rows[0].error_code,'AUTOCUT_ANALYSIS_VERSION_CHANGED');
  assert.equal(seen.length,count);assert.equal(f.downloads(),downloads);
  assert.equal((await pool.query("select count(*)::int n from autocut_model_calls where task_id=any($1::uuid[])",[[old.id,task.id,reuse.id,mismatch.id]])).rows[0].n,0);
 }finally{await pool.end()}
});

test("Historical immutable timelines without analysisVersion remain readable, restorable and renderable without ASR or models",
 {skip:!databaseUrl || !process.env.AUTOCUT_MEDIA_TEST},async()=>{
 const {pool}=createDatabase(databaseUrl!);
 try{
  const f=await cacheFixture(pool);
  const legacy={...f.info,candidates:[{start:0,end:1000,summary:'old decision',evidence:'fixture',confidence:1}]};
  await pool.query("insert into autocut_analyses(asset_version_id,analyzer_version,document)values($1,'legacy-v1',$2)",[f.asset.id,legacy]);
  const saved=await f.service.save(f.project.id,f.actor,null,f.t);
  await pool.query("insert into autocut_analyses(asset_version_id,analyzer_version,document)values($1,$2,$3)",[f.asset.id,samplingVersion,{...legacy,candidates:[{...legacy.candidates[0],summary:'different new decision'}]}]);
  const detail=await f.service.get(f.project.id,f.actor);assert.deepEqual(detail.timeline,saved);assert.deepEqual(detail.analyses[f.asset.id].candidates,[]);
  const restored=await f.service.restore(f.project.id,f.actor,saved.revision_id,saved.revision_id);
  assert.deepEqual({...restored,revision_id:saved.revision_id},saved);
  const task=await f.service.start(f.project.id,f.actor,{...editInput(),kind:'render',expectedRevision:restored.revision_id,budgetCents:0,confirmed:false});
  await pool.query("update autocut_tasks set input=input-'analysisVersion'where id=$1",[task.id]);
  let models=0,asr=0;
  const executor=new AutoCutExecutor(pool,f.service,f.storage as any,{complete:async()=>{models++;throw Error('Must not invoke model')}},f.ffmpeg,samplingVersion,f.quota as any,{transcribe:async()=>{asr++;throw Error('Must not invoke ASR')}},f.temp);
  await executor.execute(task.id);
  const result=(await pool.query("select status,error_code,output_asset_version_id from autocut_tasks where id=$1",[task.id])).rows[0];assert.equal(result.status,'completed',JSON.stringify(result));assert.ok(result.output_asset_version_id);
  assert.equal(models,0);assert.equal(asr,0);assert.ok([...f.outputs.values()].some(b=>Buffer.from(b).subarray(0,32).includes(Buffer.from('ftyp'))));
  const compiled=await f.service.start(f.project.id,f.actor,{...editInput(),expectedRevision:restored.revision_id});
  await pool.query("update autocut_tasks set output_revision_id=$2,input=input-'analysisVersion'where id=$1",[compiled.id,restored.revision_id]);
  await executor.execute(compiled.id);
  assert.equal((await pool.query("select status from autocut_tasks where id=$1",[compiled.id])).rows[0].status,'completed');
  assert.equal(models,0);assert.equal(asr,0);
  assert.deepEqual((await pool.query("select document from autocut_revisions where id=$1",[saved.revision_id])).rows[0].document,saved);
  assert.deepEqual((await f.service.analyses(f.project,'legacy-v1'))[f.asset.id],legacy);
  assert.equal((await f.service.get(f.project.id,f.actor)).tasks.find(t=>t.id===task.id).output_asset_version_id,result.output_asset_version_id);
 }finally{await pool.end()}
});


test("Bound released job parsing failure leaves persisted billing and ledger facts unchanged on repeated reads",
 {skip:!databaseUrl || !process.env.AUTOCUT_MEDIA_TEST},async()=>{
 const {pool}=createDatabase(databaseUrl!);
 try{
  const f=await cacheFixture(pool),task=await f.service.start(f.project.id,f.actor,editInput());
  await pool.query("update autocut_tasks set status='running',reserved_cents=25 where id=$1",[task.id]);
  const job=(await pool.query("insert into generation_jobs(project_id,created_by,provider,model_id,mode,capability,status,billing_status,credit_delivery_status)values($1,$2,'token360','fixture','chat','text','completed','settled','released')returning id",[f.workspace,f.actor])).rows[0];
  await pool.query("insert into generation_usage(job_id,project_id,user_id,billing_request_id,provider,model_id,capability,status,billed,total_amount,currency,exchange_rate,markup,points_per_cny,credit_status,credit_points)values($1,$2,$3,$4,'token360','fixture','text','settled',true,0.1,'CNY',1,1.2,100,'charged',12)",[job.id,f.workspace,f.actor,randomUUID()]);
  await pool.query("insert into job_artifacts(job_id,project_id,metadata,mime_type)values($1,$2,$3,'text/plain')",[job.id,f.workspace,{text:'说明 {invalid} {"clips":[]}'}]);
  await pool.query("insert into autocut_model_calls(task_id,call_key,generation_job_id,quote_cents)values($1,'parse-fixture',$2,25)",[task.id,job.id]);
  const snapshot=async()=>({job:(await pool.query('select * from generation_jobs where id=$1',[job.id])).rows,usage:(await pool.query('select * from generation_usage where job_id=$1',[job.id])).rows,calls:(await pool.query('select * from autocut_model_calls where task_id=$1',[task.id])).rows,ledger:(await pool.query('select * from credit_ledger where account_id in(select id from credit_accounts where user_id=$1)',[f.actor])).rows,jobCount:(await pool.query('select count(*)::int n from generation_jobs where project_id=$1',[f.workspace])).rows[0].n});
  const before=await snapshot();let submissions=0;
  const jobs={create:async()=>{submissions++;throw Error('No resubmission')},get:async(id:string)=>{const j=(await pool.query('select * from generation_jobs where id=$1',[id])).rows[0];return{status:j.status,billingStatus:j.billing_status,creditDeliveryStatus:j.credit_delivery_status,artifacts:(await pool.query('select metadata from job_artifacts where job_id=$1',[id])).rows.map(r=>r.metadata)}}};
  const model=new ManagedAutoCutModel(pool,jobs as any,{modelId:'fixture',quoteCents:25,maxOutputTokens:4096,analysisVersion:samplingVersion});
  for(let i=0;i<2;i++)await assert.rejects(model.complete(task.id,'parse-fixture','',[],AbortSignal.timeout(5000)),(e:any)=>e.code==='AUTOCUT_MODEL_INVALID_JSON');
  assert.equal(submissions,0);assert.deepEqual(await snapshot(),before);
 }finally{await pool.end()}
});
