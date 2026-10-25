import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const root='H:/CodexStorage/shoushou-r22',out='H:/CodexStorage/shoushou-r22-release/artifacts';
const f=JSON.parse(await readFile(root+'/private/ui-fixture.json','utf8')),admin=JSON.parse(await readFile(root+'/private/local-fixture.json','utf8'));
async function api(path,body,who=admin){const r=await fetch('http://127.0.0.1:3202'+path,{method:body?'PATCH':'GET',headers:{cookie:who.cookieName+'='+who.token,origin:'http://127.0.0.1:3202',...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const x=await r.json();assert.ok(r.ok,JSON.stringify(x));return x.data;}
const {settings}=await api('/api/native-agent/admin/models');
if(!settings.userModelSelectionEnabled){const{version,...policy}=settings;await api('/api/native-agent/admin/policy',{...policy,userModelSelectionEnabled:true,expectedVersion:version,operationId:randomUUID(),reason:'R22 isolated user model choice acceptance'});}
const {chromium}=createRequire('H:/CodexStorage/infinite-canvas-auth-upgrade/plugins/canvas/markdown/package.json')('playwright');
const b=await chromium.launch({headless:true,executablePath:'H:/CodexStorage/aishenhe-playwright/chromium-1234/chrome-win64/chrome.exe'});const checks=[],errors=[];
try{const c=await b.newContext({viewport:{width:1440,height:1000}});await c.addCookies([{name:f.cookieName,value:f.token,domain:'127.0.0.1',path:'/'}]);const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto('http://127.0.0.1:5202/canvas/'+f.projectId);await p.getByRole('main').getByRole('button',{name:'原生创作助手',exact:true}).click();const panel=p.getByRole('complementary',{name:'原生创作助手面板'}),budget=panel.getByLabel('积分费用预算');await budget.waitFor();await assert.doesNotReject(()=>budget.fill('123'));assert.equal(await budget.inputValue(),'123');assert.equal(await budget.getAttribute('aria-valuemax'),String(settings.maxBudgetCents));checks.push('integer points input preserves underlying budget units and platform cap');
const footer=panel.locator('footer');assert.ok(!(await footer.innerText()).match(/¥|人民币|（元）|已结算|待核验.*上限/));checks.push('footer removes duplicated usage summary and all yuan descriptions');
await panel.getByLabel('助手模型').click();await p.locator('.ant-select-dropdown:visible').getByText('豆包 Seed 2.1 Lite（隔离替身）',{exact:true}).click();checks.push('ordinary user can open and choose administrator-allowed verified model');await p.screenshot({path:out+'/points-model-preview.png'});assert.deepEqual(errors,[]);await writeFile(out+'/points-browser.json',JSON.stringify({checks,errors,realSupplierCost:0},null,2));console.log(JSON.stringify(checks));
}finally{await b.close();}

