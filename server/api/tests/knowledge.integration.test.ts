import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createDatabase} from '../src/db/client.js';
import {applyMigrations} from '../src/db/migrate.js';
import {PostgresPlatformRepository} from './knowledge-fixture.js';
import {KnowledgeService} from '../src/knowledge-service.js';
import {knowledgeIndex} from '../src/knowledge-index.js';
import {createApp} from '../src/app.js';
import {hashSessionToken} from '../src/auth.js';
import type {ApiConfig} from '../src/config.js';
const connection=process.env.P1_TEST_DATABASE_URL;
test('P1 native knowledge real PostgreSQL and formal HTTP handlers',{skip:!connection},async t=>{
 const url=new URL(connection!);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55451');assert.ok(['/p1_isolated','/p2_isolated','/r2_business'].includes(url.pathname));
 const {db,pool}=createDatabase(connection!),service=new KnowledgeService(db),repo=new PostgresPlatformRepository(db),passed:string[]=[];
 const run=async(name:string,fn:()=>Promise<void>)=>t.test(name,async()=>{await fn();passed.push(name)});
 try{
 await applyMigrations(pool);await applyMigrations(pool);
 const owner=await repo.createUserWithWorkspace(`kp-owner-${randomUUID()}@example.test`,'synthetic'),other=await repo.createUserWithWorkspace(`kp-other-${randomUUID()}@example.test`,'synthetic');
 const space=(await service.createSpace(owner.user.id,'personal',null,randomUUID())).id;
 const create=(title:string,markdown='',folderId:string|null=null)=>service.write(owner.user.id,space,{operationId:randomUUID(),action:'document.create',payload:{title,markdown,folderId}});
 const save=(d:any,patch:Record<string,unknown>={})=>service.write(owner.user.id,space,{operationId:randomUUID(),action:'document.save',payload:{id:d.id,expectedRevision:d.revision,title:d.title,markdown:d.markdown,folderId:d.folderId,...patch}});
 await run('personal/project ownership, active identity and cross-user isolation',async()=>{
  const personal=(await service.spaces(owner.user.id)).find(s=>s.id===space);assert.equal(personal!.kind,'personal');
  assert.equal((await service.createSpace(owner.user.id,'personal',null,randomUUID())).id,space);
  await assert.rejects(service.list(other.user.id,space,{page:1,pageSize:20}),{code:'KNOWLEDGE_NOT_FOUND'});
  const p=(await repo.createProjectForUser(owner.user.id,{name:'知识权限'})).projectId,projectSpace=(await service.createSpace(owner.user.id,'project',p,randomUUID())).id;
  await pool.query('insert into project_members(project_id,user_id,role) values($1,$2,$3)',[p,other.user.id,'viewer']);
  assert.equal((await service.list(other.user.id,projectSpace,{page:1,pageSize:20})).total,0);
  for(const role of ['viewer','unknown-role']){await pool.query('update project_members set role=$3 where project_id=$1 and user_id=$2',[p,other.user.id,role]);await assert.rejects(service.write(other.user.id,projectSpace,{operationId:randomUUID(),action:'document.create',payload:{title:'越权',markdown:'',folderId:null}}),{code:'PROJECT_READ_ONLY'});}
  await pool.query('update project_members set role=$3 where project_id=$1 and user_id=$2',[p,other.user.id,'editor']);
  const projectDoc=await service.write(other.user.id,projectSpace,{operationId:randomUUID(),action:'document.create',payload:{title:'项目文档',markdown:'独立内容',folderId:null}});
  await pool.query('delete from project_members where project_id=$1 and user_id=$2',[p,other.user.id]);await assert.rejects(service.read(other.user.id,projectSpace,projectDoc.id),{code:'KNOWLEDGE_NOT_FOUND'});
  await repo.deleteProjectForUser(p,owner.user.id);await assert.rejects(service.list(owner.user.id,projectSpace,{page:1,pageSize:20}),{code:'KNOWLEDGE_NOT_FOUND'});assert.equal((await service.list(owner.user.id,space,{page:1,pageSize:20})).total,0);
  await pool.query("update users set account_status='disabled' where id=$1",[other.user.id]);await assert.rejects(service.spaces(other.user.id),{code:'UNAUTHENTICATED'});await pool.query("update users set account_status='active' where id=$1",[other.user.id]);
 });
 await run('folders rename, move, reject cycles/nonempty/cross-space parents',async()=>{
  const f=await service.folderWrite(owner.user.id,space,{operationId:randomUUID(),action:'folder.create',payload:{name:'人物',parentId:null}});
  const child=await service.folderWrite(owner.user.id,space,{operationId:randomUUID(),action:'folder.create',payload:{name:'配角',parentId:f.id}});
  await assert.rejects(service.folderWrite(owner.user.id,space,{operationId:randomUUID(),action:'folder.save',payload:{id:f.id,name:'循环',parentId:child.id,expectedRevision:1}}),{code:'KNOWLEDGE_FOLDER_CYCLE'});
  await assert.rejects(service.folderWrite(owner.user.id,space,{operationId:randomUUID(),action:'folder.delete',payload:{id:f.id,expectedRevision:1}}),{code:'KNOWLEDGE_FOLDER_NOT_EMPTY'});
  const moved=await service.folderWrite(owner.user.id,space,{operationId:randomUUID(),action:'folder.save',payload:{id:child.id,name:'线索',parentId:null,expectedRevision:1}});assert.equal(moved.revision,2);
  const document=await create('文件夹里的文档','正文',f.id);assert.equal((await service.list(owner.user.id,space,{folderId:f.id,page:1,pageSize:20})).total,1);
  await save(document,{folderId:child.id});assert.equal((await service.list(owner.user.id,space,{folderId:f.id,page:1,pageSize:20})).total,0);
  const own=(await service.createSpace(other.user.id,'personal',null,randomUUID())).id;
  await assert.rejects(service.folderWrite(other.user.id,own,{operationId:randomUUID(),action:'folder.create',payload:{name:'非法',parentId:f.id}}),{code:'KNOWLEDGE_FOLDER_INVALID'});
  await service.folderWrite(owner.user.id,space,{operationId:randomUUID(),action:'folder.delete',payload:{id:f.id,expectedRevision:1}});
 });
 await run('fixed P0 Markdown corpus imports/edits without touching authoritative bytes',async()=>{
  const root=process.env.P1_FIXTURES!;for(const name of (await readdir(root)).filter(x=>x.endsWith('.md'))){const markdown=await readFile(resolve(root,name),'utf8'),d=await create('语料 '+name,markdown);assert.equal(d.contentHash,createHash('sha256').update(markdown).digest('hex'));assert.equal((await service.read(owner.user.id,space,d.id)).markdown,markdown);const next=await save(d,{title:'重命名 '+name});assert.equal(next.markdown,markdown);const restored=await service.version(owner.user.id,space,d.id,1);assert.equal(restored.markdown,markdown);}
  const index=knowledgeIndex('---\ntags: [人物, AI]\n---\n\n#雾港 [[林岚|她]]\n\n`[[代码假链接]]`\n\n```md\n[[代码块]] #不索引\n```');assert.deepEqual(index.links,[{target:'林岚',alias:'她'}]);assert.ok(index.tags.includes('人物'));assert.ok(!index.tags.includes('不索引'));
 });
 await run('Wiki/backlinks preserve IDs over rename, deletion and restoration; disambiguate duplicates',async()=>{
  let person=await create('林岚','人物'),source=await create('档案','[[林岚|她]] [[不存在]]');
  let rel=await service.relations(owner.user.id,space,source.id);assert.equal(rel.outgoing[0].target_id,person.id);assert.equal(rel.outgoing[1].status,'missing');assert.equal((await service.relations(owner.user.id,space,person.id)).backlinks[0].id,source.id);
  person=await save(person,{title:'林岚的新名字'});assert.equal((await service.read(owner.user.id,space,source.id)).markdown,'[[林岚|她]] [[不存在]]');assert.equal((await service.relations(owner.user.id,space,source.id)).outgoing[0].target_id,person.id);
  const duplicate=await create('林岚','同名角色');const ambiguous=await create('重名引用','[[林岚]]');assert.equal((await service.relations(owner.user.id,space,ambiguous.id)).outgoing[0].status,'ambiguous');assert.equal((await service.relations(owner.user.id,space,source.id)).outgoing[0].target_id,person.id);
  const bound=await service.write(owner.user.id,space,{operationId:randomUUID(),action:'document.resolveLink',payload:{id:ambiguous.id,expectedRevision:1,ordinal:0,targetId:duplicate.id}});assert.equal(bound.markdown,'[[林岚]]');assert.equal(bound.revision,2);assert.equal((await service.relations(owner.user.id,space,ambiguous.id)).outgoing[0].target_id,duplicate.id);
  person=await service.write(owner.user.id,space,{operationId:randomUUID(),action:'document.delete',payload:{id:person.id,expectedRevision:person.revision}});assert.equal((await service.relations(owner.user.id,space,source.id)).outgoing[0].target_id,null);
  person=await service.write(owner.user.id,space,{operationId:randomUUID(),action:'document.restore',payload:{id:person.id,expectedRevision:person.revision,version:1}});assert.equal((await service.relations(owner.user.id,space,source.id)).outgoing[0].target_id,person.id);assert.equal(person.revision,4);
 });
 await run('CAS two writers, stable operation IDs and receipt before retry',async()=>{
  const d=await create('并发文档','原始');const input={operationId:randomUUID(),action:'document.save',payload:{id:d.id,expectedRevision:d.revision,title:d.title,markdown:'甲',folderId:null}};
  const retries=await Promise.all([service.write(owner.user.id,space,input),service.write(owner.user.id,space,input)]);assert.equal(Number(retries[0].replayed)+Number(retries[1].replayed),1);assert.equal((await service.receipt(owner.user.id,space,input.operationId)).revision,2);
  await assert.rejects(service.write(owner.user.id,space,{...input,payload:{...input.payload,markdown:'换内容'}}),{code:'KNOWLEDGE_OPERATION_MISMATCH'});
  const current=await service.read(owner.user.id,space,d.id),race=await Promise.allSettled([save(current,{markdown:'乙'}),save(current,{markdown:'丙'})]);assert.equal(race.filter(v=>v.status==='fulfilled').length,1);assert.equal((await service.history(owner.user.id,space,d.id)).length,3);
 });
 await run('manual Markdown re-import deduplicates identical source without overwriting changed content',async()=>{
  const input={title:'重复导入 '+randomUUID(),markdown:'---\ntags: [保真]\n---\n\n未知扩展 ==原文==',folderId:null};
  const first=await service.write(owner.user.id,space,{operationId:randomUUID(),action:'document.import',payload:input});
  const second=await service.write(owner.user.id,space,{operationId:randomUUID(),action:'document.import',payload:input});
  assert.equal(second.id,first.id);assert.equal(second.importedExisting,true);assert.equal(second.revision,1);
  const changed=await service.write(owner.user.id,space,{operationId:randomUUID(),action:'document.import',payload:{...input,markdown:input.markdown+'\n新内容'}});assert.notEqual(changed.id,first.id);assert.equal((await service.read(owner.user.id,space,first.id)).markdown,input.markdown);
 });
 await run('audit failure rolls back document, tags, links, version and receipt together',async()=>{
  const operationId=randomUUID(),name='kp_'+randomUUID().replaceAll('-','');
  await pool.query(`create function ${name}() returns trigger language plpgsql as $$begin if NEW.operation_id='${operationId}' then raise exception 'injected knowledge audit failure'; end if;return NEW;end$$`);
  await pool.query(`create trigger ${name} before insert on knowledge_audit for each row execute function ${name}()`);
  const before=(await pool.query('select count(*)::int n from knowledge_documents where space_id=$1',[space])).rows[0].n;
  try{await assert.rejects(service.write(owner.user.id,space,{operationId,action:'document.create',payload:{title:'应回滚',markdown:'#标签 [[林岚]]',folderId:null}}));assert.equal((await pool.query('select count(*)::int n from knowledge_documents where space_id=$1',[space])).rows[0].n,before);await assert.rejects(service.receipt(owner.user.id,space,operationId),{code:'KNOWLEDGE_OPERATION_NOT_FOUND'});}finally{await pool.query(`drop trigger ${name} on knowledge_audit`);await pool.query(`drop function ${name}()`);}
 });
 await run('Chinese two/three-character names, terms, mixed search, tags, literal wildcards and pagination',async()=>{
  await create('沈知远 AI 人物','量子纠缠与机器学习。 #研究');await create('百分号','原文 100%_完成');
  for(const q of ['沈知远','林岚','量子纠缠','AI','研究'])assert.ok((await service.list(owner.user.id,space,{q,page:1,pageSize:20})).total>0,q);
  assert.ok((await service.list(owner.user.id,space,{tag:'研究',page:1,pageSize:20})).total>0);assert.equal((await service.list(owner.user.id,space,{q:'100%_',page:1,pageSize:20})).total,1);
  const a=await service.list(owner.user.id,space,{page:1,pageSize:2}),b=await service.list(owner.user.id,space,{page:2,pageSize:2});assert.equal(a.items.length,2);assert.ok(a.items.every(x=>!b.items.some(y=>y.id===x.id)));
 });
 await run('formal Hono routes use existing login, reject other user and expose operation receipt',async()=>{
  const token=randomUUID();await repo.createSession(owner.user.id,hashSessionToken(token),new Date(Date.now()+3600000));
  const app=createApp(repo,{cookieName:'kp_test',cookieSecure:false,trustedOrigins:[]} as unknown as ApiConfig,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,service);
  const path=`/api/knowledge/${space}/actions`,input={operationId:randomUUID(),action:'document.create',payload:{title:'HTTP文档',markdown:'正文',folderId:null}};
  assert.equal((await app.request(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)})).status,401);
  const response=await app.request(path,{method:'POST',headers:{cookie:`kp_test=${token}`,'content-type':'application/json'},body:JSON.stringify(input)});assert.equal(response.status,200,await response.clone().text());const body=await response.json();assert.equal(body.data.persisted,true);
  const receipt=await app.request(`/api/knowledge/${space}/operations/${input.operationId}`,{headers:{cookie:`kp_test=${token}`}});assert.equal(receipt.status,200);
 });
 await run('500 linked documents and long Markdown stay out of canvas state',async()=>{
  const scale=(await service.createSpace(other.user.id,'personal',null,randomUUID())).id,start=Date.now();
  const created=[];
  for(let n=1;n<=500;n++)created.push(await service.write(other.user.id,scale,{operationId:randomUUID(),action:'document.create',payload:{title:'人物'+n,markdown:'[[人物'+(n+1)+']] 中文 AI',folderId:null}}));
  assert.equal((await service.relations(other.user.id,scale,created[0].id)).outgoing[0].target_id,created[1].id);
  const first=(await service.list(other.user.id,scale,{q:'人物1',page:1,pageSize:20}));assert.ok(first.total>1);assert.ok(first.items.length<=20);
  const long='# 长文\n\n'+('林岚与沈知远在雾港研究 AI 与量子纠缠。\n\n'.repeat(3000));const document=await service.write(other.user.id,scale,{operationId:randomUUID(),action:'document.create',payload:{title:'长文',markdown:long,folderId:null}});assert.equal((await service.read(other.user.id,scale,document.id)).markdown,long);
  assert.equal((await pool.query('select count(*)::int n from canvas_nodes n where to_jsonb(n)::text like $1',['%'+document.id+'%'])).rows[0].n,0);
  await writeFile(resolve(process.env.P1_ARTIFACT_DIR!,'knowledge-scale.json'),JSON.stringify({documents:501,longCharacters:long.length,elapsedMs:Date.now()-start,productionGuarantee:false},null,2));
 });
 await writeFile(resolve(process.env.P1_ARTIFACT_DIR!,'knowledge-results.json'),JSON.stringify({passed,failures:[],realPostgres:true},null,2));
 }finally{await pool.end()}
});
