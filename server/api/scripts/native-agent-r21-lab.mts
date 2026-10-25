/** Loopback-only R2 lab. Synthetic accounts and HTTP supplier; never production. */
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {serve} from '@hono/node-server';
import {createDatabase} from '../src/db/client.js';
import {applyMigrations} from '../src/db/migrate.js';
import {PostgresPlatformRepository} from '../src/repository.js';
import {KnowledgeService} from '../src/knowledge-service.js';
import {ModelGateway} from '../src/model-gateway.js';
import {CreditService} from '../src/credit-service.js';
import {BillingService} from '../src/billing-service.js';
import {S3ObjectStorage} from '../src/object-storage.js';
import {JobService} from '../src/job-service.js';
import {readConfig} from '../src/config.js';
import {PaidAgentModel} from '../src/native-agent/paid-model.js';
import {NativeAgentService} from '../src/native-agent/service.js';
import {NativeAgentPolicyService} from '../src/native-agent/policy.js';
import {createNativeAgentQueue,startNativeAgentWorker} from '../src/native-agent/queue.js';
import {hashSessionToken} from '../src/auth.js';
import {createApp} from '../src/app.js';
import {startFixture} from './native-agent-fixture.mjs';
const root='H:/CodexStorage/shoushou-r21',url='postgres://p25@127.0.0.1:55485/r21_isolated';
if(process.env.NODE_ENV==='production')throw Error('LAB_ONLY');
process.env.NATIVE_AGENT_ENABLED='true';process.env.NATIVE_AGENT_DEFAULT_ENABLED='true';process.env.KNOWLEDGE_DEFAULT_ENABLED='true';process.env.KNOWLEDGE_GENERATION_ENABLED='false';process.env.NATIVE_AGENT_PAID_ENABLED='true';
await mkdir(root+'/private',{recursive:true});await mkdir(root+'/migrations',{recursive:true});
const {db,pool}=createDatabase(url);
for(const file of await readdir('db/migrations'))if(file.endsWith('.sql'))await writeFile(root+'/migrations/'+file,/^005/.test(file)?(await readFile('db/migrations/'+file,'utf8')).replace(/\r\n/g,'\n'):execFileSync('git',['show','HEAD:server/api/db/migrations/'+file]));
await applyMigrations(pool,root+'/migrations');
const config=readConfig({DATABASE_URL:url,REDIS_URL:'redis://127.0.0.1:56385/3',OBJECT_STORAGE_ENDPOINT:'http://127.0.0.1:59000',OBJECT_STORAGE_BUCKET:'unused',OBJECT_STORAGE_ACCESS_KEY_ID:'synthetic',OBJECT_STORAGE_SECRET_ACCESS_KEY:'synthetic'}),knowledge=new KnowledgeService(db),repo=new PostgresPlatformRepository(db),gateway=new ModelGateway(pool),credits=new CreditService(pool),provider={baseUrl:'http://127.0.0.1:3301/v1',apiKey:'synthetic',catalogUrl:''},billing=new BillingService(pool,config.provider,credits),queue=createNativeAgentQueue(config.jobs.redisUrl),jobs=new JobService(pool,{add:async()=>{throw Error('NORMAL_QUEUE_FORBIDDEN')},remove:async()=>false},gateway,config.jobs,async()=>{},credits,billing),policy=new NativeAgentPolicyService(knowledge,pool,gateway,{volcengine_ark:provider}),paid=new PaidAgentModel(pool,gateway,jobs,credits,billing,new S3ObjectStorage(config.objectStorage),config.jobs,provider,undefined,policy),agent=new NativeAgentService(knowledge,pool,paid,queue.enqueue,jobs,[],policy);
if(process.argv.includes('--worker')){await startNativeAgentWorker(agent,config.jobs.redisUrl);console.log('R2 isolated durable worker ready');}
else{
 startFixture(3301);await gateway.refreshVolcengineArkCatalog();
 let f:any;try{f=JSON.parse(await readFile(root+'/private/local-fixture.json','utf8'));}catch{
 const a=await repo.createUserWithWorkspace('r2-admin-'+randomUUID()+'@example.test','synthetic'),u=await repo.createUserWithWorkspace('r2-user-'+randomUUID()+'@example.test','synthetic');
 await pool.query('update users set is_admin=true where id=$1',[a.user.id]);
 for(const v of [a,u])await credits.grant(a.user.id,v.user.id,{credits:10000,source:'promotion',note:'R2 isolated synthetic only',idempotencyKey:randomUUID()},randomUUID());
 f={ownerId:a.user.id,otherId:u.user.id,projectId:a.workspace.projectId,otherProjectId:u.workspace.projectId,token:randomUUID(),otherToken:randomUUID(),cookieName:'r21_session'};
 for(const [id,token]of [[f.ownerId,f.token],[f.otherId,f.otherToken]])await repo.createSession(id,hashSessionToken(token),new Date(Date.now()+86400000));await writeFile(root+'/private/local-fixture.json',JSON.stringify(f));}
 const app=createApp(repo,{cookieName:f.cookieName,cookieSecure:false,trustedOrigins:['http://127.0.0.1:3198','http://127.0.0.1:5198'],databaseUrl:url,adminEmails:[],sessionDays:1}as any,undefined,undefined,gateway,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,knowledge,undefined,agent);
 app.get('/__p25/login',async()=>{const preview=JSON.parse(await readFile(root+'/private/normal-ui-fixture.json','utf8'));return new Response(null,{status:302,headers:{'set-cookie':f.cookieName+'='+preview.token+'; Path=/; HttpOnly; SameSite=Lax',location:'/canvas/'+preview.projectId}});});
 app.get('/__p25/admin',()=>new Response(null,{status:302,headers:{'set-cookie':f.cookieName+'='+f.token+'; Path=/; HttpOnly; SameSite=Lax',location:'/admin/ai/agent-models'}}));
 serve({fetch:app.fetch,hostname:'127.0.0.1',port:3198});console.log('R2 isolated API 3198; no paid supplier');}
