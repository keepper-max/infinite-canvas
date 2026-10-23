import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '../src/db/client.js';
import { PostgresPlatformRepository } from '../src/repository.js';
import { KnowledgeService } from '../src/knowledge-service.js';
import { appendKnowledgeLink, wikiSourceRanges } from '../src/knowledge-link-edit.js';

test('safe Wiki Link source ranges and append preserve Markdown', () => {
 const source='---\r\ntags: [人物]\r\n---\r\n\r\n> [!NOTE]\r\n> 原文\r\n\r\n![附件](../原图.png)\r\n\r\n```md\r\n[[代码]]\r\n```\r\n正文 [[甲|别名]]\r\n';
 const result=appendKnowledgeLink(source,'乙'); assert.ok(result.markdown.startsWith(source)); assert.equal(result.ordinal,1);
 const ranges=wikiSourceRanges(result.markdown);assert.equal(ranges.length,2);for(const r of ranges)assert.equal(result.markdown.slice(r.start!,r.end!),r.text);
 assert.throws(()=>appendKnowledgeLink('```md\n未关闭','乙'),{code:'KNOWLEDGE_LINK_REQUIRES_EDITOR'});
 assert.throws(()=>appendKnowledgeLink('正文','恶意]]标题'),{code:'KNOWLEDGE_LINK_TITLE_UNSAFE'});
 assert.equal(wikiSourceRanges('正文 &amp; [[甲]]')[0].start,null);
});

const connection=process.env.R11_TEST_DATABASE_URL;
test('R1.1 associations use real isolated PostgreSQL/CAS/receipts',{skip:!connection},async t=>{
 const u=new URL(connection!);assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'55461');assert.equal(u.pathname,'/r11_isolated');
 const {db,pool}=createDatabase(connection!),repo=new PostgresPlatformRepository(db),svc=new KnowledgeService(db);
 try {
 const owner=await repo.createUserWithWorkspace(`r11-${randomUUID()}@example.test`,'synthetic'),other=await repo.createUserWithWorkspace(`r11-${randomUUID()}@example.test`,'synthetic');
 const space=(await svc.createSpace(owner.user.id,'personal',null,randomUUID())).id;
 const create=(title:string,markdown='')=>svc.write(owner.user.id,space,{operationId:randomUUID(),action:'document.create',payload:{title,markdown,folderId:null}});
 const action=(source:any,target:any,kind='document.linkAdd',operationId=randomUUID())=>({operationId,action:kind,payload:{id:source.id,expectedRevision:source.revision,targetId:target.id}});
 const a=await create('来源','---\ntags: [原文]\n---\n\n> [!note]\n> 保留\n\n![原件](附件/图.png)\n'),b=await create('目标'),same1=await create('同名'),same2=await create('同名');
 let current=a;
 await t.test('preview is read-only; create + receipt replay + mismatch + duplicate',async()=>{
  const preview=await svc.previewLink(owner.user.id,space,a.id,b.id,'add');assert.equal((await svc.read(owner.user.id,space,a.id)).revision,1);assert.ok(preview.markdown.startsWith(a.markdown));
  const op=action(a,b),results=await Promise.all([svc.write(owner.user.id,space,op),svc.write(owner.user.id,space,op)]);assert.equal(results[0].id,results[1].id);assert.equal(Number(results[0].replayed)+Number(results[1].replayed),1);
  current=await svc.read(owner.user.id,space,a.id);assert.equal(current.revision,2);assert.equal(current.markdown,preview.markdown);assert.equal((await svc.receipt(owner.user.id,space,op.operationId)).revision,2);
  await assert.rejects(svc.write(owner.user.id,space,{...op,payload:{...op.payload,targetId:same1.id}}),{code:'KNOWLEDGE_OPERATION_MISMATCH'});
  const dup=await svc.write(owner.user.id,space,action(current,b));assert.equal(dup.alreadyLinked,true);assert.equal((await svc.history(owner.user.id,space,a.id)).length,2);
 });
 await t.test('same-name choice binds exact ID; removal retains later bindings',async()=>{
  current=await svc.write(owner.user.id,space,action(current,same2));assert.equal((await svc.relations(owner.user.id,space,a.id)).outgoing[1].target_id,same2.id);
  const preview=await svc.previewLink(owner.user.id,space,a.id,b.id,'remove');assert.equal(preview.requiresEditor,false);
  const before=current.markdown,range=('occurrences' in preview ? preview.occurrences : [])![0];
  current=await svc.write(owner.user.id,space,action(current,b,'document.linkRemove'));assert.equal(current.markdown,before.slice(0,range.start!)+before.slice(range.end!));
  const links=(await svc.relations(owner.user.id,space,a.id)).outgoing;assert.equal(links.length,1);assert.equal(links[0].target_id,same2.id);assert.notEqual(links[0].target_id,same1.id);
 });
 await t.test('existing ambiguous link disambiguates without duplicate Markdown',async()=>{
  const d=await create('待消歧','[[同名]]');const preview=await svc.previewLink(owner.user.id,space,d.id,same1.id,'add');assert.equal('existingReference' in preview && preview.existingReference,true);
  const saved=await svc.write(owner.user.id,space,action(d,same1));assert.equal(saved.markdown,d.markdown);assert.equal((await svc.relations(owner.user.id,space,d.id)).outgoing[0].target_id,same1.id);
 });
 await t.test('multiple references and non-exact offsets cannot be auto-removed',async()=>{
  for(const body of ['[[目标]] 和 [[目标|别名]]','&amp; [[目标]]']){const d=await create('不可自动删除',body);assert.equal((await svc.previewLink(owner.user.id,space,d.id,b.id,'remove')).requiresEditor,true);await assert.rejects(svc.write(owner.user.id,space,action(d,b,'document.linkRemove')),{code:'KNOWLEDGE_LINK_REQUIRES_EDITOR'});assert.equal((await svc.read(owner.user.id,space,d.id)).markdown,body);assert.equal((await svc.history(owner.user.id,space,d.id)).length,1);}
 });
 await t.test('two old-revision writers: one commit; other is explicit conflict',async()=>{
  const d=await create('并发');const results=await Promise.allSettled([svc.write(owner.user.id,space,action(d,b)),svc.write(owner.user.id,space,action(d,same1))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const rejected=results.find(r=>r.status==='rejected') as PromiseRejectedResult;assert.equal(rejected.reason.code,'KNOWLEDGE_REVISION_CONFLICT');assert.equal((await svc.history(owner.user.id,space,d.id)).length,2);
 });
 await t.test('authorization, cross-space target, revoked project membership',async()=>{
  await assert.rejects(svc.previewLink(other.user.id,space,a.id,b.id,'add'),{code:'KNOWLEDGE_NOT_FOUND'});
  const otherSpace=(await svc.createSpace(other.user.id,'personal',null,randomUUID())).id;await assert.rejects(svc.write(other.user.id,otherSpace,action(current,b)),{code:'KNOWLEDGE_NOT_FOUND'});
  const ps=(await svc.createSpace(owner.user.id,'project',owner.workspace.projectId,randomUUID())).id;
  const d=await svc.write(owner.user.id,ps,{operationId:randomUUID(),action:'document.create',payload:{title:'项目',markdown:'',folderId:null}});
  await assert.rejects(svc.previewLink(owner.user.id,ps,d.id,b.id,'add'),{code:'KNOWLEDGE_NOT_FOUND'});
  await pool.query('insert into project_members(project_id,user_id,role) values($1,$2,$3)',[owner.workspace.projectId,other.user.id,'viewer']);await assert.rejects(svc.write(other.user.id,ps,action(d,d)),{code:'PROJECT_READ_ONLY'});
  await pool.query('delete from project_members where project_id=$1 and user_id=$2',[owner.workspace.projectId,other.user.id]);await assert.rejects(svc.read(other.user.id,ps,d.id),{code:'KNOWLEDGE_NOT_FOUND'});
 });
 await t.test('audit failure rolls back Markdown, versions, links and receipt',async()=>{
  const op=action(current,b),name='r11_'+randomUUID().replaceAll('-','');await pool.query(`create function ${name}() returns trigger language plpgsql as $$begin if NEW.operation_id='${op.operationId}' then raise exception 'isolated failure';end if;return NEW;end$$`);await pool.query(`create trigger ${name} before insert on knowledge_audit for each row execute function ${name}()`);
  try{await assert.rejects(svc.write(owner.user.id,space,op));assert.equal((await svc.read(owner.user.id,space,a.id)).markdown,current.markdown);await assert.rejects(svc.receipt(owner.user.id,space,op.operationId),{code:'KNOWLEDGE_OPERATION_NOT_FOUND'});}finally{await pool.query(`drop trigger ${name} on knowledge_audit`);await pool.query(`drop function ${name}()`);}
 });
 } finally {await pool.end();}
});
